import { NextResponse } from "next/server";
import { hasDatabase, sql } from "@/lib/db";
import {
  MAX_BODY_BYTES,
  UNREAD_TTL_SECONDS,
  cleanExpiredBlobs,
  masterKeyMatches,
  newKey,
  relayMasterConfigured,
} from "@/lib/relay";

export const dynamic = "force-dynamic";

// Đẩy blob: POST /put (rewrite từ /put) với header x-relay-master.
// Trả 200 {key, readUrl, expiresInSec}; không bao giờ in nội dung thân vào log.
export async function POST(req: Request) {
  if (!relayMasterConfigured()) {
    return NextResponse.json({ error: "relay-not-configured" }, { status: 503 });
  }
  if (!masterKeyMatches(req.headers.get("x-relay-master"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDatabase()) {
    return NextResponse.json({ error: "no-database" }, { status: 503 });
  }
  // Kiểm content-length trước để chặn sớm, không đọc thân quá hạn mức.
  const declared = Number(req.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }
  if (body.byteLength === 0) {
    return NextResponse.json({ error: "empty-body" }, { status: 400 });
  }
  const key = newKey();
  const mime = req.headers.get("x-relay-mime") || req.headers.get("content-type") || "text/plain";
  try {
    const db = sql();
    await cleanExpiredBlobs(db);
    await db`
      insert into public.relay_blob (key, content, mime, size, expires_at)
      values (${key}, ${body}, ${mime}, ${body.byteLength}, now() + interval '900 seconds')
    `;
    const readUrl = new URL(`/get/${key}`, req.url).toString();
    return NextResponse.json({ key, readUrl, expiresInSec: UNREAD_TTL_SECONDS }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
