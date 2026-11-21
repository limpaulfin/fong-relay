import type { ReactNode } from "react";

export const metadata = {
  title: "fong-relay",
  description: "Ứng dụng web của Thanh-Phong Lam, chạy trên Vercel",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem auto", maxWidth: 720, padding: "0 1rem" }}>
        {children}
      </body>
    </html>
  );
}
