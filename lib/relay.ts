// Logic chung của relay blob đọc một lần: hằng số, kiểm khóa master, trợ giúp SQL.
// Không bao giờ in nội dung blob hay giá trị biến môi trường ra log.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "./db";

// 4 MiB — phải thấp hơn giới hạn thân yêu cầu ~4.5 MB của Vercel.
export const MAX_BODY_BYTES = 4194304;
// Khóa chưa đọc tự chết sau 15 phút.
export const UNREAD_TTL_SECONDS = 900;
// Từ lần đọc đầu, khóa còn sống thêm 60 giây rồi chết (410).
export const READ_WINDOW_SECONDS = 60;
// key do randomBytes(32).toString("hex") sinh ra.
export const RELAY_KEY_REGEX = /^[0-9a-f]{64}$/;

export type Db = ReturnType<typeof sql>;

// Hash khóa master đọc từ public.relay_config (dự phòng khi thiếu env), kèm hạn hết cache.
let masterHashCache: { hash: string | null; expires: number } | null = null;
// Hàng có: cache 30 giây. Không có hàng: cache 5 giây để serverless không dập DB.
const MASTER_HASH_TTL_PRESENT_MS = 30_000;
const MASTER_HASH_TTL_ABSENT_MS = 5_000;

// Đọc master_sha256 (id = 1); không bao giờ log giá trị hash. Lỗi DB hoặc không có hàng
// đều coi như "chưa cấu hình" (fail closed); lỗi KHÔNG được cache để lần sau thử lại.
async function lookupMasterHash(): Promise<string | null> {
  const now = Date.now();
  if (masterHashCache && masterHashCache.expires > now) return masterHashCache.hash;
  try {
    const db = sql();
    const rows = await db`select master_sha256 from public.relay_config where id = 1`;
    const row = rows[0];
    const hash =
      row && typeof row.master_sha256 === "string" && row.master_sha256.length > 0
        ? (row.master_sha256 as string)
        : null;
    masterHashCache = {
      hash,
      expires: now + (hash ? MASTER_HASH_TTL_PRESENT_MS : MASTER_HASH_TTL_ABSENT_MS),
    };
    return hash;
  } catch {
    return null;
  }
}

// So sánh thời gian hằng; timingSafeEqual chỉ nhận hai bộ đệm cùng độ dài,
// nên khác độ dài trả false ngay (độ dài khóa master không phải bí mật cần giấu).
function bytesEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// Env đặt thì env thắng; thiếu env thì nhìn vào hàng relay_config trong DB.
export async function relayMasterConfigured(): Promise<boolean> {
  if (process.env.RELAY_MASTER_KEY) return true;
  return (await lookupMasterHash()) !== null;
}

// Env đặt: so bytes candidate với env như cũ. Thiếu env: so SHA-256 hex của candidate
// với master_sha256 trong DB trên hai bộ đệm 32 byte. Không có hàng/lỗi DB ⇒ false.
export async function masterKeyMatches(candidate: string | null): Promise<boolean> {
  if (candidate === null) return false;
  const secret = process.env.RELAY_MASTER_KEY;
  if (secret) {
    return bytesEqual(Buffer.from(candidate, "utf8"), Buffer.from(secret, "utf8"));
  }
  const stored = await lookupMasterHash();
  if (!stored) return false;
  const expected = Buffer.from(stored, "hex");
  const actual = createHash("sha256").update(candidate, "utf8").digest();
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function newKey(): string {
  return randomBytes(32).toString("hex");
}

// Dọn opportunistic trước khi chèn: giải phóng nội dung blob đã quá hạn,
// xóa hẳn hàng đã chết quá 1 giờ. Không bao giờ xóa blob còn sống.
export async function cleanExpiredBlobs(db: Db): Promise<void> {
  await db`update public.relay_blob set content = ''::bytea where expires_at < now() and size > 0`;
  await db`delete from public.relay_blob where expires_at < now() - interval '1 hour'`;
}

// Đọc nguyên tử bằng MỘT câu UPDATE: đóng dấu read_at đúng lần đầu
// (cột read_at vế phải là giá trị TRƯỚC khi sửa), chỉ mở cửa 60 giây ở lần đọc đầu.
// Hết hạn rồi thì không trả hàng nào.
export async function readBlobAtomically(db: Db, key: string) {
  return db`
    update public.relay_blob set
      read_at = coalesce(read_at, now()),
      expires_at = case when read_at is null then now() + interval '60 seconds' else expires_at end
    where key = ${key} and expires_at > now()
    returning content, mime, size, read_at, expires_at
  `;
}

export async function blobExists(db: Db, key: string): Promise<boolean> {
  const rows = await db`select 1 from public.relay_blob where key = ${key} limit 1`;
  return rows.length > 0;
}

// Xóa nội dung blob đã chết (giải phóng bộ nhớ, giữ hàng làm chứng 410).
export async function wipeBlobContent(db: Db, key: string): Promise<void> {
  await db`update public.relay_blob set content = ''::bytea where key = ${key}`;
}
