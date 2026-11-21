import { readdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Liệt kê hình trong public/images, trả về đường dẫn công khai.
export async function GET() {
  const dir = path.join(process.cwd(), "public", "images");
  const names = (await readdir(dir)).filter((n) => /\.(png|jpe?g|webp|gif|svg)$/i.test(n));
  return NextResponse.json({ count: names.length, images: names.map((n) => `/images/${n}`) });
}
