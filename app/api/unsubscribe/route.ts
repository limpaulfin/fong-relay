// POST /api/unsubscribe — ghi một yêu cầu hủy đăng ký vào nhật ký
// Supabase (bảng public.unsubscribes, chỉ thêm, không xóa).
// Hai dạng gọi:
//  1) Form từ trang /unsubscribe (trường id) -> ghi xong chuyển về
//     trang xác nhận ?done=1.
//  2) JSON của cầu nối agent (header x-feed-key = UNSUB_FEED_KEY):
//     GET  -> danh sách các dòng chưa áp dụng vào lõi thư.
//     POST { markApplied: [id, ...] } -> đánh dấu đã áp dụng.
import {
  ensureUnsubTable,
  findRecipientByUuid,
  hasUnsubscribed,
  recordUnsubscribe,
  pendingUnsubscribes,
  markUnsubscribesApplied,
} from "../../../lib/unsub";
import { isUuid, openContext } from "../../../lib/track";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function feedKeyOk(req: Request): boolean {
  const expected = process.env.UNSUB_FEED_KEY;
  if (!expected) return false;
  return req.headers.get("x-feed-key") === expected;
}

export async function GET(req: Request) {
  if (!feedKeyOk(req)) {
    return Response.json(
      { error: "feed-key-required" },
      { status: 503 },
    );
  }
  try {
    await ensureUnsubTable();
    const rows = await pendingUnsubscribes();
    return Response.json({ pending: rows });
  } catch (e) {
    return Response.json(
      { error: "feed-failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";

  // Dạng 2: cầu nối agent đánh dấu đã áp dụng.
  if (contentType.includes("application/json") && feedKeyOk(req)) {
    try {
      const body = (await req.json()) as { markApplied?: number[] };
      if (Array.isArray(body.markApplied)) {
        await ensureUnsubTable();
        await markUnsubscribesApplied(body.markApplied);
        return Response.json({ ok: true });
      }
    } catch (e) {
      return Response.json(
        { error: "mark-failed", detail: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  // Dạng 1: form hủy đăng ký của người nhận.
  let id = "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { id?: string };
      id = body.id ?? "";
    } else {
      const form = await req.formData();
      id = String(form.get("id") ?? "");
    }
  } catch {
    id = "";
  }

  if (!isUuid(id)) {
    return Response.json({ error: "invalid-id" }, { status: 400 });
  }

  try {
    await ensureUnsubTable();
    const email = await findRecipientByUuid(id);
    if (!email) {
      return Response.json({ error: "unknown-email-id" }, { status: 404 });
    }
    if (!(await hasUnsubscribed(id))) {
      const ctx = openContext(req);
      await recordUnsubscribe(email, id, ctx.ip, ctx.userAgent);
    }
  } catch (e) {
    return Response.json(
      { error: "unsubscribe-failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const url = new URL(`/unsubscribe?id=${id}&done=1`, req.url);
  return Response.redirect(url, 303);
}
