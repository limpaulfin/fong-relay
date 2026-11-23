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

export function pngBytes(base64: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(base64, "base64");
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
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
