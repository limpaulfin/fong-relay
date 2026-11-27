#!/usr/bin/env node
// Đưa SHA-256 hex của khóa master vào public.relay_config (id = 1) — dự phòng cho env
// RELAY_MASTER_KEY khi thiếu (xem lib/relay.ts). Ghép đúng cách xử lý TLS/URL của lib/db.ts:
// bỏ mọi tham số truy vấn của URL, kiểm chứng chỉ (rejectUnauthorized) với CA gốc Supabase.
// KHÔNG bao giờ in khóa gốc hay hash ra output: thành công chỉ in đúng một từ "ok".
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const ROOT = new URL("..", import.meta.url).pathname;

// Đọc .env.local theo cách thô (chỉ dùng trong máy cục bộ; không in giá trị).
function envFromDotenv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = { ...envFromDotenv(`${ROOT}.env.local`), ...process.env };

const masterKey = env.RELAY_MASTER_KEY;
if (!masterKey) {
  console.error("RELAY_MASTER_KEY chưa được cấu hình trong .env.local");
  process.exit(2);
}

const raw = env.DATABASE_URL || env.POSTGRES_URL;
if (!raw) {
  console.error("DATABASE_URL (hoặc POSTGRES_URL) chưa được cấu hình trong .env.local");
  process.exit(2);
}
const host = new URL(raw).hostname;
if (!/(^|\.)supabase\.(co|com)$/.test(host)) {
  console.error(`refusing: host ${host} không thuộc supabase.co/supabase.com`);
  process.exit(2);
}

// CA gốc Supabase nhúng ở lib/supabase-ca.ts (không nhân bản chuỗi PEM vào đây).
const caFromFile = readFileSync(`${ROOT}lib/supabase-ca.ts`, "utf8").match(
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
);
if (!caFromFile) {
  console.error("không đọc được CA từ lib/supabase-ca.ts");
  process.exit(2);
}
const ca = process.env.DATABASE_CA || caFromFile[0];

// Bỏ MỌI tham số truy vấn: postgres.js gửi chúng lên server như tham số khởi động (L10).
const url = new URL(raw);
url.search = "";
const sql = postgres(url.toString(), { ssl: { rejectUnauthorized: true, ca }, prepare: false, max: 1 });

try {
  const hash = createHash("sha256").update(masterKey, "utf8").digest("hex");
  await sql`
    insert into public.relay_config (id, master_sha256)
    values (1, ${hash})
    on conflict (id) do update set master_sha256 = excluded.master_sha256, updated_at = now()
  `;
  await sql.end();
  console.log("ok");
} catch {
  console.error("không ghi được relay_config (kiểm DATABASE_URL và bảng relay_config)");
  process.exit(1);
}
