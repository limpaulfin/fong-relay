// Lớp truy cập database duy nhất của ứng dụng (Postgres chuẩn, chạy được với Supabase).
// Chỉ đọc DATABASE_URL, không giữ khóa trong mã.
import postgres from "postgres";

let client: ReturnType<typeof postgres> | undefined;

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL chưa được cấu hình");
  // prepare:false để tương thích bộ gộp kết nối (pooler) của Supabase ở chế độ transaction.
  client ??= postgres(url, { ssl: "require", prepare: false, max: 1 });
  return client;
}
