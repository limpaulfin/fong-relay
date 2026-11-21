# fong-relay

Ứng dụng web của Thanh-Phong Lam, chạy trên Vercel (Next.js, App Router, TypeScript). Ngày tạo: 2026-11-21.

## Cấu trúc

```text
app/                 giao diện (page.tsx, layout.tsx)
app/api/health/      backend: kiểm tra sống và kết nối database
app/api/images/      backend: liệt kê hình trong public/images
lib/db.ts            lớp database duy nhất (Neon Postgres, đọc DATABASE_URL)
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

- Mặc định: Neon Postgres gắn qua Vercel (project, Storage, Marketplace). Vercel tự thêm `DATABASE_URL`.
- Chưa có `DATABASE_URL` thì ứng dụng vẫn chạy, `/api/health` báo `database: not-configured`.
- Đổi nhà cung cấp (ví dụ Supabase) chỉ cần sửa `lib/db.ts` và biến môi trường.

## Quy ước hình trong `public/images/`

- Chữ thường, không dấu tiếng Việt, không khoảng trắng, nối bằng gạch ngang. Ví dụ `story-genius-cover.jpg`.
- `.jpg` cho ảnh chụp, bìa sách; `.png` khi cần nền trong hoặc chữ sắc nét. Mỗi hình dưới 2 MB.
- Trang https://limpaulfin.github.io/publications/ chỉ tham chiếu hình từ đây.

Không ghi token hay mật khẩu vào repo.
