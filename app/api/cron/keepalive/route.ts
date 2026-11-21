import { NextResponse } from "next/server";
import { hasDatabase, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Giữ database luôn sống: mỗi ngày một vòng Tạo, Đọc, Sửa, Xóa trên bảng heartbeat (xem db/schema.sql).
const COOLDOWN_MIN = 60; // gọi dồn trong 1 giờ chỉ chạy một lần (chặn lạm dụng khi không đặt CRON_SECRET)
const KEEP_DAYS = 7;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // Vercel cron tự gửi "Authorization: Bearer <CRON_SECRET>" khi biến này có
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Gọi nhẹ một API công khai của Supabase để project luôn có hoạt động qua cả đường HTTP.
async function apiPing(): Promise<number | "skipped" | "error"> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return "skipped";
  try {
    const r = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, signal: AbortSignal.timeout(5000) });
    return r.status;
  } catch {
    return "error";
  }
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  if (!hasDatabase()) return NextResponse.json({ ok: false, error: "no-database" }, { status: 503 });
  try {
    const db = sql();
    const recent = await db`select 1 from public.heartbeat where created_at > now() - (${COOLDOWN_MIN}::int * interval '1 minute') limit 1`;
    if (recent.length) return NextResponse.json({ ok: true, skipped: "cooldown" });
    const [row] = await db`insert into public.heartbeat (note) values ('keepalive') returning id`; // Create
    const [seen] = await db`select count(*)::int as n from public.heartbeat`; // Read
    await db`update public.heartbeat set note = 'verified' where id = ${row.id}`; // Update
    const gone = await db`delete from public.heartbeat where created_at < now() - (${KEEP_DAYS}::int * interval '1 day') returning id`; // Delete
    const api = await apiPing();
    return NextResponse.json({ ok: true, created: row.id, rows: seen.n, deleted: gone.length, api });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
