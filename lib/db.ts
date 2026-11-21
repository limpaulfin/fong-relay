// Lớp truy cập database duy nhất của ứng dụng (Postgres chuẩn, chạy được với Supabase).
// Chỉ đọc biến môi trường, không giữ khóa trong mã. Luôn kiểm chứng chỉ TLS (không hạ xuống "require").
import postgres from "postgres";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

let client: ReturnType<typeof postgres> | undefined;

// DATABASE_URL do mình đặt; POSTGRES_URL là tên Vercel tự thêm khi nối Supabase qua Marketplace.
function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

export function hasDatabase(): boolean {
  return Boolean(databaseUrl());
}

export function sql() {
  const raw = databaseUrl();
  if (!raw) throw new Error("DATABASE_URL (hoặc POSTGRES_URL) chưa được cấu hình");
  // Bỏ MỌI tham số truy vấn trong URL: sslmode có thể hạ mức TLS, còn tham số lạ (Vercel thêm supa=...)
  // sẽ bị thư viện gửi lên server như tham số khởi động. Mọi tùy chọn đặt tường minh ở dưới.
  const url = new URL(raw);
  url.search = "";
  // Supabase ký bằng CA riêng (không có trong kho CA của hệ thống), nên mặc định nạp CA gốc của Supabase.
  // DATABASE_CA (tùy chọn, PEM) ghi đè khi dùng nhà cung cấp Postgres khác.
  const ca = process.env.DATABASE_CA || SUPABASE_ROOT_CA;
  const ssl = { rejectUnauthorized: true, ca };
  // prepare:false để tương thích bộ gộp kết nối (pooler) của Supabase ở chế độ transaction.
  client ??= postgres(url.toString(), { ssl, prepare: false, max: 1 });
  return client;
}
