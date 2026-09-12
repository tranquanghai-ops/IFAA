# IFA+A (IFAA) V3.0

Hệ thống đăng ký sự kiện dành cho Khoa Mỹ thuật Công nghiệp, TDTU.

## Quyền truy cập

- Khách chưa đăng nhập: xem danh sách và chi tiết các sự kiện công khai.
- Sinh viên: chỉ cần đăng nhập Google bằng `MSSV@student.tdtu.edu.vn` khi đăng ký sự kiện.
- Giảng viên/nhân sự: đăng nhập Google bằng email `@tdtu.edu.vn` và có thể đăng ký sự kiện như sinh viên.
- Chủ sở hữu: `tranquanghai@tdtu.edu.vn`, quản lý toàn hệ thống và danh sách Admin.
- Admin: bất kỳ tài khoản Google nào được chủ sở hữu cấp quyền; có thể vào trang quản trị và đăng ký sự kiện ở trang ngoài.

## Cách giới hạn đăng ký

- Người tham gia nhập họ tên, số điện thoại và khoa/đơn vị ở lần đầu; hồ sơ được lưu và có thể sửa lại.
- Mỗi nhóm sự kiện có một giới hạn riêng, ví dụ tối đa 1 hoặc 2 sự kiện/người trong nhóm.
- Sự kiện không thuộc nhóm không bị tính vào giới hạn; sức chứa của từng sự kiện vẫn luôn được áp dụng.
- Trang người tham gia hiển thị sự kiện sắp mở, đang mở, đã đóng và đã kết thúc kèm đồng hồ đếm ngược.
- Nhóm chỉ có một sự kiện được hiển thị như một sự kiện độc lập trên trang chính.
- Admin có thể ẩn sự kiện cũ, chọn khoa/đơn vị được tham gia và bật quyền tự hủy riêng cho từng sự kiện.

## Điểm danh

- Phiên điểm danh có thể lấy danh sách từ một sự kiện đã đăng ký hoặc từ Excel/CSV.
- Form tạo phiên gồm tên, ngày tổ chức/kết thúc, địa điểm, giờ bắt đầu/kết thúc và danh sách SV Leader.
- Admin và sinh viên đã được cấp quyền phải đăng nhập Google trước khi quét.
- Trang quét hỗ trợ camera sau, nhiều cơ chế nhận diện barcode, nhập MSSV thủ công, âm thanh/rung và chụp ảnh.

## Hoàn tất Firebase

1. Bật Authentication > Google.
2. Đăng ký một Web app tên `IFA+A Web`.
3. Chép các giá trị cấu hình Web vào `firebase-config.mjs`.
4. Thêm `tranquanghai-ops.github.io` vào Authentication > Settings > Authorized domains.
5. Dán `firestore.rules` vào Firestore > Rules và Publish.
6. Tạo tài liệu `settings/main` ở lần đầu bằng trang Admin, với `faculties: ["Khoa Mỹ thuật Công nghiệp"]`. Giới hạn được chọn riêng khi tạo từng nhóm (mặc định 2); quyền tự hủy được thiết lập riêng ở từng sự kiện.

## GitHub Pages

Đưa toàn bộ thư mục lên repository `IFAA`, rồi bật Pages từ nhánh `main`, thư mục `/ (root)`.
