import { NextResponse } from "next/server";
import { hasDatabase, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabase()) {
    return NextResponse.json({ ok: true, database: "not-configured" });
  }
  try {
    await sql()`select 1`;
    return NextResponse.json({ ok: true, database: "up" });
  } catch {
    return NextResponse.json({ ok: false, database: "error" }, { status: 503 });
  }
}
