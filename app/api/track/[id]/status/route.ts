// GET /api/track/<uuid>/status — xem một email đã được mở mấy lần, khi nào, ở đâu.
import { ensureTrackTables, isUuid } from "../../../../../lib/track";
import { sql } from "../../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await handle(params);
  } catch (e) {
    return Response.json(
      { error: "status-failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

async function handle(params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "id không phải UUID" }, { status: 400 });
  }
  await ensureTrackTables();
  const db = sql();
  const emails = await db`
    select id, recipient, subject, sent_at, first_open_at, open_count
    from public.tracked_emails
    where id = ${id}
  `;
  if (emails.length === 0) {
    return Response.json({ error: "không tìm thấy email" }, { status: 404 });
  }
  const opens = await db`
    select opened_at, ip, country, region, city, user_agent, accept_language, referer, is_proxy
    from public.email_opens
    where email_id = ${id}
    order by opened_at asc
  `;
  return Response.json({ email: emails[0], opens });
}
