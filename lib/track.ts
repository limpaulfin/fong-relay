// Theo dõi mở email: mỗi email gửi đi mang một UUID; hình tracking (pixel 1x1
// hoặc chữ ký "Fong") được phục vụ từ Vercel, mỗi lần hình được tải là một
// lần mở được ghi vào Supabase (Postgres trực tiếp qua lib/db.ts như toàn app).
import { sql } from "./db";

export const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// Chữ ký "Fong" (PNG nền trong suốt 151x62) — nhúng sẵn để route trả về ngay,
// không đọc file ở runtime.
export const SIGNATURE_PNG_BASE64 =
  "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";

export function pngBytes(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// Tạo bảng nếu chưa có (idempotent). Chạy một lần cho mỗi tiến trình ấm.
let tablesReady: Promise<void> | undefined;

export function ensureTrackTables(): Promise<void> {
  tablesReady ??= (async () => {
    const db = sql();
    await db.unsafe(`
      create table if not exists public.tracked_emails (
        id uuid primary key,
        recipient text not null default '',
        subject text not null default '',
        sent_at timestamptz not null default now(),
        first_open_at timestamptz,
        open_count integer not null default 0
      );
      create table if not exists public.email_opens (
        id bigint generated always as identity primary key,
        email_id uuid not null references public.tracked_emails(id) on delete cascade,
        opened_at timestamptz not null default now(),
        ip text,
        country text,
        region text,
        city text,
        user_agent text,
        accept_language text,
        referer text,
        is_proxy boolean not null default false
      );
      create index if not exists email_opens_email_id_idx
        on public.email_opens (email_id, opened_at);
      alter table public.tracked_emails enable row level security;
      alter table public.email_opens enable row level security;
      revoke all on public.tracked_emails from anon, authenticated;
      revoke all on public.email_opens from anon, authenticated;
    `);
  })();
  return tablesReady;
}

// Thông tin lấy từ header của request tải hình — nguồn dữ kiện "mở ở đâu,
// khi nào, bằng gì" theo thông lệ tracking email.
export interface OpenContext {
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  userAgent: string | null;
  acceptLanguage: string | null;
  referer: string | null;
  isProxy: boolean;
}

function decodeHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function openContext(req: Request): OpenContext {
  const h = req.headers;
  const forwarded = h.get("x-forwarded-for");
  const ip = (forwarded ? forwarded.split(",")[0].trim() : null) || h.get("x-real-ip");
  const userAgent = h.get("user-agent");
  // Mail client thường tải hình qua proxy (Gmail, Yahoo, Apple) — IP/UA khi đó
  // là của proxy, vẫn ghi nhận nhưng đánh dấu để diễn giải đúng.
  const ua = (userAgent || "").toLowerCase();
  const isProxy =
    ua.includes("googleimageproxy") ||
    ua.includes("yahoomailproxy") ||
    ua.includes("applemail") ||
    ua.includes("outlook");
  return {
    ip,
    country: h.get("x-vercel-ip-country"),
    region: h.get("x-vercel-ip-country-region"),
    city: decodeHeader(h.get("x-vercel-ip-city")),
    userAgent,
    acceptLanguage: h.get("accept-language"),
    referer: h.get("referer"),
    isProxy,
  };
}
