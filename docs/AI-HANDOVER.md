# Cập nhật mới nhất — Flexible event registration

- Branch triển khai: `feature/flexible-event-registration`.
- Public page có Quick Edit bằng icon cây bút ở góc phải; quyền hiển thị và cập nhật giữ theo Owner/Admin/Sub-admin hiện có, không chuyển sang `/admin/`.
- Event có thêm `registrationProfileFields` và `registrationFormItems`; event cũ không có các field này vẫn dùng luồng đăng ký nhanh.
- Form builder hỗ trợ câu hỏi `short_text`, `long_text`, `single_choice`, `multiple_choice`, `dropdown`, `number`, `date`, `boolean`; hỗ trợ content block xen kẽ, nhân bản, xóa, lên/xuống và preview không ghi dữ liệu.
- Registration mới lưu `answers`, `profileSnapshot` và `registrationFormSnapshot`. Việc thay đổi hồ sơ sau này không cập nhật ngược snapshot cũ.
- Hồ sơ và danh sách SV khoa hỗ trợ thêm `personalEmail` và `phone`. Hai trường liên hệ bị loại khỏi faculty dataset nén mà participant có thể đọc; Admin xem/chỉnh qua document Firestore theo quyền hiện tại.
- Admin có modal xem chi tiết registration; Excel registration thêm cột profile/câu hỏi động từ snapshot và nối multiple choice bằng `; `.
- Không sửa Firestore Rules, Storage Rules, Auth, Attendance, Check-in, Drupal hoặc iframe.
- Upload tài liệu sự kiện được hoãn: `storage.rules` hiện chưa có đường dẫn/quyền riêng cho event documents; không tự ý mở quyền trong task này.
- Kiểm tra mục tiêu: `npm run test:registration-form`, `npm run test:security-static`, syntax các file MJS thay đổi và `git diff --check`.
- Task tiếp theo không thay đổi thành Attendance trong phạm vi triển khai này; không bắt đầu Attendance tự động.

# Dự án

- Repository: `tranquanghai-ops/IFAA`
- Branch hiện tại: `refactor/groups-module`
- Nhánh đích: `main`
- Base commit: `1e4fcbd` (`Merge pull request #7 from tranquanghai-ops/refactor/students-module`)

# Cập nhật mới nhất — Groups

- Groups đã được modularize vào `admin/modules/groups/group-service.mjs`.
- Module mới giữ group render, list subscription, group dialog/form, validation, group ordering, group link/calendar, group limit/unlimited behavior, bulk status, trash/restore/purge và binding riêng của Groups.
- `admin/admin.mjs` giữ shared `groups` list cho Events/Registrations/Exports, subscription orchestration và phần tạo group ngay trong event form vì nó phối hợp trực tiếp event creation.
- Events module nhận `groupCode`, `groupPosition`, `refreshGroupOptions` và `setLimitInputState`; Registrations đọc `groups` qua getter và dùng `groupPosition` để sắp thứ tự. Không có import ngược hoặc circular dependency.
- Không thay đổi UI, quyền, Firestore Rules/Storage Rules, schema, collection/document path, group registration-limit, event-group relationship hoặc transaction/batch behavior.
- Kiểm tra: syntax `admin/admin.mjs`, `group-service.mjs`, static security và `git diff --check` PASS. Có targeted registration integration test, nhưng không chạy được vì môi trường không có `firebase`; không cài thêm công cụ.
- Commit dự kiến: `refactor: extract admin groups module`.
- Module đề xuất tiếp theo: `attendance`; không bắt đầu khi chưa có task riêng.

# Bàn giao Students (lịch sử)

Modular hóa có giới hạn bằng cách tách logic quản lý sinh viên phía Admin khỏi `admin/admin.mjs`, chỉ refactor cấu trúc và giữ nguyên hành vi production.

# Trạng thái hiện tại

- Students đã được modularize vào `admin/modules/students/student-service.mjs`.
- Module mới giữ student list/cache, metadata dataset, filter, search, pagination, page size và danh sách sinh viên hết hạn.
- Module mới chứa chuẩn hóa/validation bản ghi sinh viên, render danh sách, đọc/import file, add/update/delete, xử lý trùng MSSV, rebuild/publish dataset và binding riêng của màn hình Students.
- `admin/admin.mjs` giảm từ 2.472 xuống 2.248 dòng.
- Không thay đổi UI, quyền Owner/Admin/Sub-admin, Auth, Firestore schema, Firestore Rules hoặc Storage Rules.
- Không thay đổi Firestore path, batch behavior, import format, student data format hoặc validation behavior.
- Không sửa `student.mjs`, registrations module, events module hoặc exports module.

# Logic student cố ý còn lại trong admin/admin.mjs

- Attendance dùng `studentRecord`, `validStudentId` và `normalizeSearch` qua API của Students module.
- Attendance đọc student list/cache qua `getFacultyStudents()` để bổ sung thông tin khi nhập danh sách cấp quyền.
- Attendance đọc metadata dataset qua `getFacultyStudentDatasetMeta()` để enrich tên sinh viên.
- Tra cứu trực tiếp `facultyStudents` phục vụ attendance/check-in vẫn ở `admin.mjs` vì đây là orchestration attendance, không phải quản lý student master list.

# Dependencies

- Students module nhận `db`, `storage`, DOM selector, escaping helper, user/access getter, notice/confirm, XLSX header normalizer, faculty dataset helpers và workbook downloader qua dependency injection.
- `admin.mjs` gọi `loadFacultyStudentMeta()` khi khởi tạo dữ liệu Admin.
- Students module không import ngược `admin.mjs`; không có circular dependency.

# File đã thay đổi

- `admin/modules/students/student-service.mjs`: module mới chứa logic quản lý Students.
- `admin/admin.mjs`: khởi tạo Students service, bỏ logic/state Students nội tuyến và giữ attendance orchestration.
- `scripts/validate-security-static.mjs`: thêm assertion cho wiring Students, quyền cập nhật và Firestore paths hiện hữu.
- `docs/AI-HANDOVER.md`: cập nhật handover cho refactor Students.

# Kiểm tra

- `node --check admin/admin.mjs`: PASS.
- `node --check admin/modules/students/student-service.mjs`: PASS.
- `node --check scripts/validate-security-static.mjs`: PASS.
- `node scripts/validate-security-static.mjs`: PASS, kết quả `Static security assertions passed.`.
- `git diff --check`: PASS.
- Không có targeted test riêng cho admin student CRUD/render.
- Không chạy Firebase Emulator hoặc full test suite vì không thay đổi Rules.

# Quyết định đã chốt

- Giữ một file `student-service.mjs` để tránh chia nhỏ quá mức.
- Student list/cache và UI state thuộc Students module; attendance chỉ truy cập qua getter/API được inject.
- Giữ nguyên toàn bộ collection/document path, batch size 450, duplicate MSSV handling, import/export format và dataset fallback.
- Commit triển khai dùng message: `refactor: extract admin students module`.
- Không deploy production và không merge PR trong task này.

# Hành động tiếp theo

Review Draft PR của branch `refactor/students-module`, tập trung xác nhận diff chỉ di chuyển logic quản lý Students và không đổi permission, dữ liệu, import hoặc Firestore behavior. Module phù hợp tiếp theo được đề xuất là `groups`; không bắt đầu khi chưa có task riêng.

# Ràng buộc an toàn

- Không thay đổi hành vi hoặc giao diện Students.
- Không thay đổi Owner/Admin/Sub-admin permissions hoặc Auth.
- Không thay đổi Firestore Rules, Storage Rules, schema, collection hoặc document path.
- Không thay đổi import format, validation hoặc dữ liệu sinh viên hiện có.
- Không deploy production.
- Không merge PR.
- Không refactor groups, registrations, events, exports hoặc attendance ngoài dependency wiring cần thiết.

# Cập nhật lần cuối

- Branch: `refactor/students-module`.
- Commit: `refactor: extract admin students module`.
- Trạng thái: refactor Students hoàn tất; syntax/static PASS; không có targeted student test; sẵn sàng tạo Draft PR.
