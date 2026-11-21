import { NextResponse } from "next/server";
import { hasDatabase, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Bộ nhớ đệm ngắn để người lạ gọi liên tục không làm cạn kết nối database.
const TTL_MS = 15_000;
let cached: { at: number; ok: boolean; database: string } | undefined;

async function probe(): Promise<{ ok: boolean; database: string }> {
  if (!hasDatabase()) return { ok: true, database: "not-configured" };
  try {
    await sql()`select 1`;
    return { ok: true, database: "up" };
  } catch {
    return { ok: false, database: "error" };
  }
}

export async function GET() {
  if (!cached || Date.now() - cached.at > TTL_MS) cached = { at: Date.now(), ...(await probe()) };
  const { ok, database } = cached;
  return NextResponse.json({ ok, database }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
