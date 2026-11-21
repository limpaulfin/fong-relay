// Lớp truy cập database duy nhất của ứng dụng (Postgres chuẩn, chạy được với Supabase).
// Chỉ đọc biến môi trường, không giữ khóa trong mã. Luôn kiểm chứng chỉ TLS (không hạ xuống "require").
import postgres from "postgres";

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
  // Bỏ sslmode trong URL: nếu giữ, thư viện có thể hạ xuống chế độ không kiểm chứng chỉ.
  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  // DATABASE_CA (tùy chọn): nội dung PEM của CA gốc, dùng khi nhà cung cấp không ký bằng CA công cộng.
  const ca = process.env.DATABASE_CA;
  const ssl = ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
  // prepare:false để tương thích bộ gộp kết nối (pooler) của Supabase ở chế độ transaction.
  client ??= postgres(url.toString(), { ssl, prepare: false, max: 1 });
  return client;
}
