// Lớp truy cập database duy nhất của ứng dụng (Postgres chuẩn, chạy được với Supabase).
// Chỉ đọc biến môi trường, không giữ khóa trong mã. Luôn kiểm chứng chỉ TLS (không hạ xuống "require").
import postgres from "postgres";

let client: ReturnType<typeof postgres> | undefined;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL chưa được cấu hình");
  // DATABASE_CA (tùy chọn): nội dung PEM của CA gốc, dùng khi nhà cung cấp không ký bằng CA công cộng.
  const ca = process.env.DATABASE_CA;
  const ssl = ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
  // prepare:false để tương thích bộ gộp kết nối (pooler) của Supabase ở chế độ transaction.
  client ??= postgres(url, { ssl, prepare: false, max: 1 });
  return client;
}
