// Hủy đăng ký (unsubscribe) — cơ chế chuẩn mực của Modern Email Core:
// mỗi email theo dõi mang một link hủy riêng /unsubscribe?id=<uuid của email>.
// Người nhận bấm link -> trang xác nhận -> POST mới ghi vào NHẬT KÝ
// public.unsubscribes trên Supabase (chỉ thêm, KHÔNG BAO GIỜ xóa).
// Một cầu nối bất đồng bộ (agent bridge) đọc nhật ký này và đẩy vào lõi thư
// (POST /v1/unsubscribe) để các lần gửi sau tự động bỏ qua địa chỉ đó;
// dòng nhật ký được đánh dấu applied_at sau khi lõi đã nhận.
import { sql } from "./db";

let unsubTableReady: Promise<void> | undefined;

export function ensureUnsubTable(): Promise<void> {
  unsubTableReady ??= (async () => {
    const db = sql();
    await db.unsafe(`
      create table if not exists public.unsubscribes (
        id bigint generated always as identity primary key,
        email text not null,
        source_uuid uuid,
        ip text,
        user_agent text,
        created_at timestamptz not null default now(),
        applied_at timestamptz
      );
      create index if not exists unsubscribes_created_idx
        on public.unsubscribes (created_at);
      alter table public.unsubscribes enable row level security;
      revoke all on public.unsubscribes from anon, authenticated;
    `);
  })();
  return unsubTableReady;
}

export interface UnsubRow {
  id: number;
  email: string;
  source_uuid: string | null;
  created_at: string;
}

export async function findRecipientByUuid(
  uuid: string,
): Promise<string | null> {
  const db = sql();
  const rows = await db`
    select recipient from public.tracked_emails where id = ${uuid} limit 1
  `;
  return rows.length > 0 ? (rows[0].recipient as string) : null;
}

export async function hasUnsubscribed(uuid: string): Promise<boolean> {
  const db = sql();
  const rows = await db`
    select id from public.unsubscribes where source_uuid = ${uuid} limit 1
  `;
  return rows.length > 0;
}

export async function recordUnsubscribe(
  email: string,
  uuid: string,
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  const db = sql();
  await db`
    insert into public.unsubscribes (email, source_uuid, ip, user_agent)
    values (${email}, ${uuid}, ${ip}, ${userAgent})
  `;
}

export async function pendingUnsubscribes(): Promise<UnsubRow[]> {
  const db = sql();
  const rows = await db`
    select id, email, source_uuid, created_at
    from public.unsubscribes
    where applied_at is null
    order by created_at asc
    limit 200
  `;
  return rows as unknown as UnsubRow[];
}

export async function markUnsubscribesApplied(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = sql();
  await db`
    update public.unsubscribes
    set applied_at = now()
    where id in ${db(ids)} and applied_at is null
  `;
}

// Che bớt email khi hiển thị trên trang xác nhận (chỉ để người nhận
// nhận ra đúng hộp thư của mình, không lộ đầy đủ khi ai đó mở link hộ).
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) return email;
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}
