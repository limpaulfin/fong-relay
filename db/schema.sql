-- Bảng nhịp sống cho cron hằng ngày. Chạy một lần (đã chạy trên project Supabase FongRelay).
create table if not exists public.heartbeat (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  note text not null default 'keepalive'
);
-- Chặn mọi truy cập qua Data API (anon/authenticated); ứng dụng dùng Postgres trực tiếp (bỏ qua RLS).
alter table public.heartbeat enable row level security;
revoke all on public.heartbeat from anon, authenticated;
