import { hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main>
      <h1>fong-relay</h1>
      <p>Ứng dụng web chạy trên Vercel. Trang chính của tác giả: <a href="https://limpaulfin.github.io/publications/">limpaulfin.github.io/publications</a>.</p>
      <ul>
        <li>Giao diện: trang này (<code>app/page.tsx</code>)</li>
        <li>Backend: <a href="/api/health">/api/health</a>, <a href="/api/images">/api/images</a></li>
        <li>Hình tĩnh: <code>/images/&lt;ten-hinh&gt;</code> (thư mục <code>public/images</code>)</li>
        <li>Database: {hasDatabase() ? "đã cấu hình" : "chưa cấu hình (xem README)"}</li>
      </ul>
    </main>
  );
}
