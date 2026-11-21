# fong-relay

Kho trung chuyển (relay) của Thanh-Phong Lam, deploy tự động bằng Vercel. Hiện có một kiểu relay: hình ảnh.

- Hình nằm trong `images/`. URL của một hình là `https://<ten-mien-vercel>/images/<ten-hinh>`.
- Trang web chính vẫn ở https://limpaulfin.github.io/publications/ và chỉ **tham chiếu** hình từ đây.
- Các kiểu relay khác sẽ thêm sau, mỗi kiểu một thư mục riêng ở gốc repo.
- Ngày tạo: 2026-11-21.

## Quy ước đặt tên file hình

- Chữ thường, không dấu tiếng Việt, không khoảng trắng, nối bằng dấu gạch ngang. Ví dụ: `story-genius-cover.jpg`.
- `.jpg` cho ảnh chụp và bìa sách, `.png` khi cần nền trong hoặc chữ sắc nét.
- Mỗi hình dưới 2 MB; lớn hơn thì nén trước khi commit.
- Hình chỉ nằm trong `images/`.
