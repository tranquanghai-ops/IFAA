# IFAHr V1.0

Hệ thống đăng ký sự kiện dành cho Khoa Mỹ thuật Công nghiệp, TDTU.

## Quyền truy cập

- Sinh viên: bắt buộc đăng nhập Google bằng `MSSV@student.tdtu.edu.vn`.
- Chủ sở hữu: `tranquanghai@tdtu.edu.vn`, quản lý toàn hệ thống và danh sách Admin.
- Admin: email `@tdtu.edu.vn` được chủ sở hữu cấp quyền; xem/sửa mọi sự kiện nhưng chỉ xóa sự kiện do mình tạo.

## Hoàn tất Firebase

1. Bật Authentication > Google.
2. Đăng ký một Web app tên `IFAHr Web`.
3. Chép các giá trị cấu hình Web vào `firebase-config.mjs`.
4. Thêm `tranquanghai-ops.github.io` vào Authentication > Settings > Authorized domains.
5. Dán `firestore.rules` vào Firestore > Rules và Publish.
6. Tạo tài liệu `settings/main` ở lần đầu bằng trang Admin, hoặc đặt `maxRegistrations: 1`, `allowCancellation: false`.

## GitHub Pages

Đưa toàn bộ thư mục lên repository `IFAHr`, rồi bật Pages từ nhánh `main`, thư mục `/ (root)`.
