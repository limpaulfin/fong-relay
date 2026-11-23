// POST /api/track/register { recipient, subject, id? }
// Đăng ký một email sắp gửi: sinh UUID (hoặc dùng UUID bên gửi tự chọn),
// trả về URL pixel + URL chữ ký để nhúng vào HTML của email.
import { isUuid } from "../../../../lib/track";
import { sql } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let payload: { recipient?: string; subject?: string; id?: string } = {};
  try {
    payload = await req.json();
  } catch {
    // Thân rỗng vẫn hợp lệ: chỉ cần một UUID mới.
  }
  const id = payload.id && isUuid(payload.id) ? payload.id : crypto.randomUUID();
  // Bảng đã tồn tại (tạo một lần khi triển khai): KHÔNG chạy DDL trong
  // đường request nữa — DDL trên Supabase hay bị statement timeout và
  // từng làm route này trả 500 rỗng (sửa 23/11/2026, cùng bài học PR #3).
  const db = sql();
  try {
    await db`
      insert into public.tracked_emails (id, recipient, subject)
      values (${id}, ${payload.recipient ?? ""}, ${payload.subject ?? ""})
      on conflict (id) do update
        set recipient = excluded.recipient,
            subject = excluded.subject
    `;
  } catch (err) {
    console.error("track/register: upsert thất bại", err);
    return Response.json(
      { error: "register-failed", detail: String(err) },
      { status: 500 },
    );
  }
  const origin = new URL(req.url).origin;
  return Response.json({
    id,
    pixelUrl: `${origin}/api/track/${id}`,
    signatureUrl: `${origin}/api/track/${id}?v=sig`,
    statusUrl: `${origin}/api/track/${id}/status`,
  });
}
