# Dự án

- Repository: `tranquanghai-ops/IFAA`
- Branch hiện tại: `refactor/registrations-module`
- Nhánh đích: `main`
- Base commit: `ef38fe5` (`Merge pull request #4 from tranquanghai-ops/refactor/export-module`)

# Mục tiêu hiện tại

Modular hóa có giới hạn bằng cách tách logic quản lý registrations khỏi `admin/admin.mjs`, chỉ refactor cấu trúc và giữ nguyên hành vi production.

# Trạng thái hiện tại

- Logic quản lý registrations đã được chuyển sang module riêng `admin/modules/registrations/registration-service.mjs`.
- Module mới giữ state riêng cho danh sách đã tải, bộ lọc trạng thái, page size, cursor/phân trang và quick preview.
- Module mới xử lý tải/render danh sách, quick preview, truy vấn registrations, xóa một lượt đăng ký và reset toàn bộ registrations của một sự kiện.
- Transaction xóa registration vẫn đọc event và registration, giảm `registeredCount`, ghi `registrationMutationId`, xóa registration và cập nhật `registrationLimits` như trước.
- `admin/admin.mjs` import factory registrations, inject các dependency hiện có và giữ event binding/phối hợp cấp cao.
- Export module nhận `fetchRegistrations` từ registrations module; logic tạo workbook và Storage cache vẫn chỉ nằm trong export module.
- `admin/admin.mjs` giảm từ 3.119 xuống 2.924 dòng.
- Không thay đổi UI, quyền Owner/Admin/Sub-admin, Auth, Firestore schema, Firestore Rules hoặc Storage Rules.
- Không thay đổi collection/document path, transaction semantics, registration counters, registration limits hoặc delete/reset behavior.
- Không sửa `student.mjs`.

# Logic cố ý còn lại trong admin/admin.mjs

- Event binding chính cho bộ lọc, phân trang, quick preview, xóa/reset và export registrations.
- Điều phối xóa vĩnh viễn event/group: lấy và xóa registrations qua API của registrations module, đồng thời xử lý event/group và export cache ở module tương ứng.
- Kiểm tra số registrations khi sửa giới hạn nhóm, vì đây là luồng quản lý event group.
- Hiển thị `registeredCount` trên event cards và group summaries, vì đây là phần render event management.
- Tạo attendance roster từ registrations, vì đây là luồng check-in/attendance.
- Tạo workbook, tên file, sheet, cột và Storage export cache, vì đây là trách nhiệm của export module.

# File đã thay đổi

- `admin/modules/registrations/registration-service.mjs`: module mới chứa state và logic quản lý registrations.
- `admin/admin.mjs`: bỏ logic registrations nội tuyến, khởi tạo service và giữ các điểm phối hợp/event binding.
- `admin/modules/exports/export-service.mjs`: nhận `fetchRegistrations` qua dependency thay vì sở hữu truy vấn registrations.
- `scripts/validate-security-static.mjs`: thêm assertion cho wiring module và transaction xóa registration.
- `docs/AI-HANDOVER.md`: cập nhật handover cho refactor registrations.

# Kiểm tra

- `node --check admin/admin.mjs`: PASS.
- `node --check admin/modules/registrations/registration-service.mjs`: PASS.
- `node --check admin/modules/exports/export-service.mjs`: PASS.
- `node --check scripts/validate-security-static.mjs`: PASS.
- `node scripts/validate-security-static.mjs`: PASS, kết quả `Static security assertions passed.`.
- `git diff --check`: PASS.
- Targeted Firebase Emulator registrations:
  - Lệnh: `firebase emulators:exec --only firestore,storage --project ifa-activities "node --test --test-name-pattern=registration tests/firebase-rules.test.mjs"`
  - Kết quả: 6/6 PASS, 0 FAIL.
- Lần chạy đầu chỉ bật Firestore nên test harness dừng vì thiếu Storage Emulator; chạy lại đúng cấu hình Firestore + Storage đã PASS 6/6.
- Không chạy toàn bộ emulator suite vì không thay đổi Rules.
- Repository không có browser unit test riêng cho giao diện quản lý registrations; không tạo test framework mới.

# Quyết định đã chốt

- Giữ một file registrations service để tránh chia nhỏ quá mức.
- Không tạo state manager hoặc abstraction dùng chung mới.
- `admin.mjs` inject dependency; registrations module không import ngược `admin.mjs`, nên không có circular dependency.
- Registrations module là nguồn duy nhất cho truy vấn và thao tác quản lý registrations; export module chỉ tiêu thụ API được inject.
- Commit triển khai dùng message: `refactor: extract admin registrations module`.
- Không deploy production và không merge PR trong task này.

# Hành động tiếp theo

Review Draft PR của branch `refactor/registrations-module`, tập trung xác nhận diff chỉ di chuyển logic registrations và giữ nguyên transaction/counter behavior. Sau refactor này, module phù hợp tiếp theo được đề xuất là `events`; không bắt đầu việc đó khi chưa có task/phê duyệt riêng.

# Ràng buộc an toàn

- Không thay đổi hành vi hoặc giao diện registrations.
- Không thay đổi Owner/Admin/Sub-admin permissions hoặc Auth.
- Không thay đổi Firestore Rules hoặc Storage Rules.
- Không thay đổi Firestore schema, collection hoặc document.
- Không thay đổi transaction semantics, registration counters hoặc registration limits.
- Không sửa student registration flow.
- Không deploy production.
- Không merge PR.
- Không refactor phần không liên quan.

# Cập nhật lần cuối

- Branch: `refactor/registrations-module`.
- Commit: `refactor: extract admin registrations module`.
- Trạng thái: refactor registrations hoàn tất; syntax/static PASS; targeted Emulator registrations 6/6 PASS; sẵn sàng tạo Draft PR.
