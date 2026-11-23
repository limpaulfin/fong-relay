// GET /api/track/<uuid>?v=sig — phục vụ hình tracking và ghi một lần mở.
// Luôn trả hình kể cả khi ghi DB lỗi: không bao giờ làm hỏng email của người nhận.
import { ensureTrackTables, isUuid, openContext, pngBytes, PIXEL_PNG_BASE64, SIGNATURE_PNG_BASE64 } from "../../../../lib/track";
import { sql } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const signature = url.searchParams.get("v") === "sig";
  const body = pngBytes(signature ? SIGNATURE_PNG_BASE64 : PIXEL_PNG_BASE64);

  if (isUuid(id)) {
    try {
      await ensureTrackTables();
      const ctx = openContext(req);
      const db = sql();
      // Email chưa đăng ký trước vẫn ghi được (hàng placeholder), không mất sự kiện.
      await db`
        insert into public.tracked_emails (id)
        values (${id})
        on conflict (id) do nothing
      `;
      await db`
        insert into public.email_opens
          (email_id, ip, country, region, city, user_agent, accept_language, referer, is_proxy)
        values
          (${id}, ${ctx.ip}, ${ctx.country}, ${ctx.region}, ${ctx.city},
           ${ctx.userAgent}, ${ctx.acceptLanguage}, ${ctx.referer}, ${ctx.isProxy})
      `;
      await db`
        update public.tracked_emails
        set open_count = open_count + 1,
            first_open_at = coalesce(first_open_at, now())
        where id = ${id}
      `;
    } catch (err) {
      console.error("track: ghi sự kiện mở thất bại", err);
    }
  }

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}
