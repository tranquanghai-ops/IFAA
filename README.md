# IFAHr V1.0

Hệ thống đăng ký sự kiện dành cho Khoa Mỹ thuật Công nghiệp, TDTU.

## Quyền truy cập

- Sinh viên: đăng nhập Google bằng `MSSV@student.tdtu.edu.vn`.
- Giảng viên/nhân sự: đăng nhập Google bằng email `@tdtu.edu.vn` và có thể đăng ký sự kiện như sinh viên.
- Chủ sở hữu: `tranquanghai@tdtu.edu.vn`, quản lý toàn hệ thống và danh sách Admin.
- Admin: bất kỳ tài khoản Google nào được chủ sở hữu cấp quyền; có thể vào trang quản trị và đăng ký sự kiện ở trang ngoài.

## Cách giới hạn đăng ký

- Người tham gia nhập họ tên, số điện thoại và khoa/đơn vị ở lần đầu; hồ sơ được lưu và có thể sửa lại.
- Mỗi nhóm sự kiện có một giới hạn riêng, ví dụ tối đa 1 hoặc 2 sự kiện/người trong nhóm.
- Sự kiện không thuộc nhóm không bị tính vào giới hạn; sức chứa của từng sự kiện vẫn luôn được áp dụng.
- Trang người tham gia hiển thị sự kiện sắp mở, đang mở, đã đóng và đã kết thúc kèm đồng hồ đếm ngược.
- Admin có thể ẩn sự kiện cũ, chọn khoa/đơn vị được tham gia và bật quyền tự hủy riêng cho từng sự kiện.

## Hoàn tất Firebase

1. Bật Authentication > Google.
2. Đăng ký một Web app tên `IFAHr Web`.
3. Chép các giá trị cấu hình Web vào `firebase-config.mjs`.
4. Thêm `tranquanghai-ops.github.io` vào Authentication > Settings > Authorized domains.
5. Dán `firestore.rules` vào Firestore > Rules và Publish.
6. Tạo tài liệu `settings/main` ở lần đầu bằng trang Admin, hoặc đặt `maxRegistrations: 1`, `faculties: ["Khoa Mỹ thuật Công nghiệp"]`. `maxRegistrations` là giá trị mặc định khi tạo nhóm mới; quyền tự hủy được thiết lập riêng ở từng sự kiện.

## GitHub Pages

Đưa toàn bộ thư mục lên repository `IFAHr`, rồi bật Pages từ nhánh `main`, thư mục `/ (root)`.
