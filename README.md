# fong-relay

Ứng dụng web của Thanh-Phong Lam, chạy trên Vercel (Next.js, App Router, TypeScript). Ngày tạo: 2026-11-21.

## Cấu trúc

```text
app/                 giao diện (page.tsx, layout.tsx)
app/api/health/      backend: kiểm tra sống và kết nối database
app/api/images/      backend: liệt kê hình trong public/images
lib/db.ts            lớp database duy nhất (Postgres chuẩn, dùng với Supabase, đọc DATABASE_URL)
public/images/       hình tĩnh, URL là /images/<ten-hinh>
.env.example         mẫu biến môi trường, không chứa giá trị thật
```

## Chạy cục bộ

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm run build
```

## Triển khai (Vercel)

- Framework Preset phải là **Next.js** (Settings, General). Build Command và Output Directory để mặc định.
- Mỗi lần đẩy lên `main`, Vercel tự deploy. Nhánh khác tạo bản preview.

## Database

- Mặc định: Supabase Postgres. Nối qua Vercel Marketplace (Vercel tự thêm biến môi trường) hoặc đặt `DATABASE_URL` trong `.env.local` khi chạy cục bộ.
- Chưa có `DATABASE_URL` thì ứng dụng vẫn chạy, `/api/health` báo `database: not-configured`.
- Đổi nhà cung cấp Postgres khác chỉ cần đổi `DATABASE_URL`; không ghi khóa vào repo.
- TLS luôn được kiểm chứng chỉ. Supabase ký bằng CA riêng nên mã nạp sẵn CA gốc của Supabase (`lib/supabase-ca.ts`, đã kiểm chuỗi chứng chỉ). Dùng Postgres khác thì đặt `DATABASE_CA` (PEM). Không tắt kiểm tra.
- Trên Vercel dùng chuỗi kết nối qua pooler (IPv4) từ Supabase, mục Connect; host `db.<mã>.supabase.co` trực tiếp chỉ có IPv6.

## Quy ước hình trong `public/images/`

- Chữ thường, không dấu tiếng Việt, không khoảng trắng, nối bằng gạch ngang. Ví dụ `story-genius-cover.jpg`.
- `.jpg` cho ảnh chụp, bìa sách; `.png` khi cần nền trong hoặc chữ sắc nét. Mỗi hình dưới 2 MB.
- Trang https://limpaulfin.github.io/publications/ chỉ tham chiếu hình từ đây.

Không ghi token hay mật khẩu vào repo.

## Giữ database luôn sống (keepalive)

- Supabase gói miễn phí tự tạm dừng project không hoạt động. `vercel.json` có cron `0 3 * * *` (03:00 UTC, 10:00 giờ Việt Nam) gọi `/api/cron/keepalive`.
- Mỗi lần chạy làm đủ Tạo, Đọc, Sửa, Xóa trên bảng `heartbeat` (`db/schema.sql`, bật RLS, chặn Data API) và xóa hàng quá 7 ngày. Gọi dồn trong 1 giờ chỉ chạy một lần.
- `CRON_SECRET` (tùy chọn) bắt buộc lời gọi có `Authorization: Bearer <giá trị>`; Vercel cron tự gửi khi biến này có.
- Kiểm tra: `select id, note, created_at from public.heartbeat order by id desc limit 3;` phải có hàng mới mỗi ngày.

## Relay blob đọc một lần (`/put`, `/get/<key>`)

- Đẩy: `POST /put` với header `x-relay-master` bằng `RELAY_MASTER_KEY`, thân tối đa 4194304 byte (4 MiB, dưới giới hạn ~4.5 MB của Vercel). Trả `{key, readUrl, expiresInSec: 900}` với `key` là 64 hex.
- Đọc: `GET /get/<key>` — lần đọc đầu mở cửa 60 giây (đóng dấu `read_at` nguyên tử trong đúng một câu UPDATE); đọc lại trong cửa vẫn 200; hết cửa trả 410 và nội dung bị xóa. Khóa chưa đọc tự chết sau 900 giây. Hỗ trợ `Range: bytes=a-b` (206). `HEAD` chỉ đọc metadata, không tính là lần đọc.
- Bảng `public.relay_blob` trong `db/schema.sql` (RLS bật, chặn anon/authenticated); áp dụng thủ công một lần. Logic chung nằm ở `lib/relay.ts`.
- `RELAY_MASTER_KEY` chưa đặt thì `/put` trả 503 (fail closed). Sai khóa → 401. Thân rỗng → 400. Quá hạn mức → 413. Khóa sai dạng → 404.
- Tự kiểm (server phải đang chạy, có bước ngủ 61 giây): `BASE=http://localhost:3000 RELAY_MASTER_KEY=… node scripts/relay-selftest.mjs`.
