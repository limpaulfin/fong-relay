// Lớp truy cập database duy nhất của ứng dụng. Chỉ đọc DATABASE_URL, không giữ khóa trong mã.
import { neon } from "@neondatabase/serverless";

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL chưa được cấu hình");
  return neon(url);
}
