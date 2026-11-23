// Trang hủy đăng ký của Modern Email Core.
// GET chỉ HIỂN THỊ trang xác nhận — không ghi nhận gì cả (tránh các
// trình quét link của Gmail/Outlook tự hủy thay người nhận).
// Chỉ khi người nhận bấm nút "Hủy đăng ký" (POST) thì nhật ký mới ghi.
import {
  findRecipientByUuid,
  hasUnsubscribed,
  maskEmail,
  ensureUnsubTable,
} from "../../lib/unsub";
import { isUuid } from "../../lib/track";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const wrap: React.CSSProperties = {
  maxWidth: 560,
  margin: "48px auto",
  padding: "0 20px",
  fontFamily: "'Times New Roman', Times, serif",
  color: "#1a1a1a",
  lineHeight: 1.6,
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; done?: string }>;
}) {
  const { id, done } = await searchParams;

  if (!id || !isUuid(id)) {
    return (
      <main style={wrap}>
        <h1>Liên kết không hợp lệ</h1>
        <p>
          Link hủy đăng ký này thiếu mã email hoặc mã không đúng. Anh/chị vui
          lòng mở lại link ngay trong email đã nhận.
        </p>
      </main>
    );
  }

  if (done === "1") {
    return (
      <main style={wrap}>
        <h1>Đã hủy đăng ký</h1>
        <p>
          Hệ thống đã ghi nhận yêu cầu hủy đăng ký của anh/chị và sẽ không
          gửi thêm email nào nữa. Việc hủy này được lưu vào nhật ký của hệ
          thống.
        </p>
        <p>Cảm ơn anh/chị đã đọc thư trong thời gian qua.</p>
      </main>
    );
  }

  let masked = "";
  let already = false;
  try {
    await ensureUnsubTable();
    const recipient = await findRecipientByUuid(id);
    if (recipient) masked = maskEmail(recipient);
    already = await hasUnsubscribed(id);
  } catch {
    // Không đọc được cơ sở dữ liệu: vẫn cho bấm nút, POST sẽ xử lý lại.
  }

  if (already) {
    return (
      <main style={wrap}>
        <h1>Đã hủy đăng ký rồi</h1>
        <p>
          Địa chỉ {masked || "của anh/chị"} đã hủy đăng ký trước đó. Hệ thống
          sẽ không gửi thêm email nào nữa.
        </p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1>Hủy đăng ký nhận email</h1>
      <p>
        Anh/chị đang hủy đăng ký cho địa chỉ <strong>{masked || "email này"}</strong>.
      </p>
      <p>
        Sau khi hủy, hệ thống sẽ không bao giờ gửi email cho địa chỉ này nữa.
        Yêu cầu hủy được lưu vào nhật ký của hệ thống.
      </p>
      <form method="post" action="/api/unsubscribe">
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          style={{
            fontFamily: "'Times New Roman', Times, serif",
            fontSize: 17,
            padding: "10px 22px",
            border: "1px solid #1a1a1a",
            background: "#1a1a1a",
            color: "#ffffff",
            cursor: "pointer",
          }}
        >
          Hủy đăng ký
        </button>
      </form>
    </main>
  );
}
