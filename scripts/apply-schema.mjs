#!/usr/bin/env node
// Áp dụng các câu lệnh relay_blob và relay_config trong db/schema.sql (idempotent, chạy lại an toàn).
// Ghép đúng cách xử lý TLS/URL của lib/db.ts: bỏ mọi tham số truy vấn của URL,
// kiểm chứng chỉ (rejectUnauthorized) với CA gốc Supabase đọc từ lib/supabase-ca.ts.
// Không bao giờ in giá trị bí mật. Chế độ đọc riêng: node scripts/apply-schema.mjs --check
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

// Trích riêng các câu lệnh relay_blob: bỏ dòng ghi chú, tách theo ';', giữ khối có 'relay_blob'.
const schema = readFileSync(`${ROOT}db/schema.sql`, "utf8")
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const statements = schema
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && /relay_(blob|config)/.test(s));
if (statements.length === 0) {
  console.error("không tìm thấy câu lệnh relay_blob/relay_config nào trong db/schema.sql");
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

const checkOnly = process.argv.includes("--check");
// Dọn dẹp sau selftest: chỉ xóa hàng ĐÃ CHẾT sinh trong 1 giờ gần nhất (tự kiểm), không đụng blob còn sống.
if (process.argv.includes("--clean-dead")) {
  const del = await sql`delete from public.relay_blob where expires_at < now() and created_at > now() - interval '1 hour' returning key`;
  console.log(`deleted_dead_test_rows: ${del.length}`);
}
if (!checkOnly) {
  for (const stmt of statements) {
    await sql.unsafe(stmt);
    console.log(`applied: ${stmt.split(/\s+/).slice(0, 4).join(" ")} …`);
  }
  console.log(`applied ${statements.length} relay statement(s)`);
}

const reg = await sql`select to_regclass('public.relay_blob') as reg, (select n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname = 'relay_blob') as qualified, to_regclass('public.relay_config') as reg_config`;
console.log(`to_regclass: ${reg[0].qualified} (to_regclass=${reg[0].reg}), relay_config: ${reg[0].reg_config}`);
const dead = await sql`select count(*)::int as n from public.relay_blob where size > 0 and expires_at < now()`;
console.log(`expired_unwiped_rows: ${dead[0].n}`);
await sql.end();
