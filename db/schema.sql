-- Bảng nhịp sống cho cron hằng ngày. Chạy một lần (đã chạy trên project Supabase FongRelay).
create table if not exists public.heartbeat (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  note text not null default 'keepalive'
);
-- Chặn mọi truy cập qua Data API (anon/authenticated); ứng dụng dùng Postgres trực tiếp (bỏ qua RLS).
alter table public.heartbeat enable row level security;
revoke all on public.heartbeat from anon, authenticated;

-- Theo dõi mở email (2026-11-23): mỗi email một UUID; hình tracking trên Vercel
-- ghi một dòng email_opens mỗi lần được tải. Ứng dụng cũng tự tạo bảng khi chạy
-- (lib/track.ts ensureTrackTables) nên đoạn này là bản ghi chuẩn để đối chiếu.
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

-- Nhật ký hủy đăng ký (unsubscribe journal) — chỉ thêm, không bao giờ xóa.
-- Cầu nối bất đồng bộ đọc các dòng applied_at IS NULL và đẩy vào lõi thư.
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

-- Blob đọc một lần cho relay /put và /get/<key> (xem lib/relay.ts, app/api/put, app/api/get/[key]).
-- Chạy một lần, thủ công. key = 64 hex; lần đọc đầu đóng dấu read_at và mở cửa 60 giây;
-- khóa chưa đọc tự chết sau 900 giây; hết cửa thì trả 410 và nội dung bị xóa.
create table if not exists public.relay_blob (
  key text primary key,
  content bytea not null,
  mime text not null,
  size integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  read_at timestamptz
);
alter table public.relay_blob enable row level security;
revoke all on public.relay_blob from anon, authenticated;
