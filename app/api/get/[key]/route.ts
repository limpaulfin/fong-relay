import { NextResponse } from "next/server";
import { hasDatabase, sql } from "@/lib/db";
import { RELAY_KEY_REGEX, blobExists, readBlobAtomically, wipeBlobContent } from "@/lib/relay";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string }> };

function secondsUntil(date: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
}

function metaHeaders(
  mime: string,
  size: number,
  readAt: Date | null,
  diesIn: number,
): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": mime,
    "content-length": String(size),
    "cache-control": "no-store",
    "x-relay-dies-in": String(diesIn),
  };
  if (readAt) h["x-relay-read-at"] = readAt.toISOString();
  return h;
}

// Chỉ nhận "bytes=a-b" (hoặc "bytes=a-", "bytes=-n"). Trả "invalid" khi không thể thỏa (→ 416).
function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const [, a, b] = m;
  if (a === "" && b === "") return "invalid";
  let start: number;
  let end: number;
  if (a === "") {
    const n = parseInt(b, 10);
    if (n === 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(a, 10);
    end = b === "" ? size - 1 : parseInt(b, 10);
  }
  if (start > end || start >= size) return "invalid";
  end = Math.min(end, size - 1);
  return { start, end };
}

// GET lần đầu mở cửa 60 giây (câu UPDATE nguyên tử, đúng một lần đóng dấu);
// đọc lại trong cửa vẫn 200; hết cửa → 410 và xóa nội dung; khóa lạ → 404.
export async function GET(req: Request, context: RouteContext) {
  const { key } = await context.params;
  if (!RELAY_KEY_REGEX.test(key)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (!hasDatabase()) {
    return NextResponse.json({ error: "no-database" }, { status: 503 });
  }
  try {
    const db = sql();
    const [row] = await readBlobAtomically(db, key);
    if (!row) {
      if (await blobExists(db, key)) {
        await wipeBlobContent(db, key);
        return NextResponse.json({ error: "gone" }, { status: 410 });
      }
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    const content = new Uint8Array(row.content as Buffer);
    const size = Number(row.size);
    const headers = metaHeaders(
      String(row.mime),
      size,
      row.read_at ? new Date(row.read_at) : null,
      secondsUntil(new Date(row.expires_at)),
    );
    const range = parseRange(req.headers.get("range"), size);
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}`, "cache-control": "no-store" },
      });
    }
    if (range) {
      const slice = content.subarray(range.start, range.end + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          ...headers,
          "content-length": String(slice.byteLength),
          "content-range": `bytes ${range.start}-${range.end}/${size}`,
        },
      });
    }
    return new Response(content, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

// HEAD chỉ đọc, KHÔNG đếm là lần đọc đầu (chọn thuần, không sửa gì).
export async function HEAD(_req: Request, context: RouteContext) {
  const { key } = await context.params;
  if (!RELAY_KEY_REGEX.test(key)) {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (!hasDatabase()) {
    return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
  }
  try {
    const db = sql();
    const [row] =
      await db`select mime, size, read_at, expires_at from public.relay_blob where key = ${key} and expires_at > now() limit 1`;
    if (!row) {
      const status = (await blobExists(db, key)) ? 410 : 404;
      return new Response(null, { status, headers: { "cache-control": "no-store" } });
    }
    const headers = metaHeaders(
      String(row.mime),
      Number(row.size),
      row.read_at ? new Date(row.read_at) : null,
      secondsUntil(new Date(row.expires_at)),
    );
    return new Response(null, { status: 200, headers });
  } catch {
    return new Response(null, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
