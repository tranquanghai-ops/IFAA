# Dự án

- Repository: `tranquanghai-ops/IFAA`
- Branch hiện tại: `refactor/export-module`
- Nhánh đích: `main`
- PR liên quan: Draft PR #4 — https://github.com/tranquanghai-ops/IFAA/pull/4

# Mục tiêu hiện tại

Modular hóa có giới hạn bằng cách tách chức năng Export Excel khỏi `admin/admin.mjs`, chỉ refactor cấu trúc và giữ nguyên toàn bộ hành vi production.

# Trạng thái hiện tại

- `main` đã được đồng bộ tại merge commit PR #3: `32978c72a342c207e53e02aa59c875e6363d7835`.
- Logic export đã được chuyển sang module riêng `admin/modules/exports/export-service.mjs`.
- `admin/admin.mjs` import factory export, truyền các dependency hiện có và chỉ gọi API export tại các event binding/luồng UI liên quan.
- Không có bản sao thứ hai của logic tạo workbook hoặc Storage cache.
- Số dòng `admin/admin.mjs` giảm từ 3.275 xuống 3.119.
- Owner và Admin `role=admin` tiếp tục đọc/ghi Firebase Storage export cache.
- Sub-admin tiếp tục bỏ qua Storage cache, tạo workbook ở client và tải trực tiếp.
- Student và người chưa đăng nhập không được cấp thêm quyền.
- Không thay đổi giao diện, role model, Firestore schema, Firestore Rules hoặc Storage Rules.

# Quyết định đã chốt

- Đây là refactor thuần túy; tên file Excel, sheet, cột, truy vấn, thông báo và cache metadata/version được giữ nguyên.
- Quyết định phân quyền đã triển khai trong PR #3 không thay đổi:
  - Owner và Admin cấp cao được dùng Storage cache.
  - Sub-admin tải workbook local.
  - Student và unauthenticated không truy cập export cache.
- Module export nhận `canUseStorageCache: highAdminAccess` từ `admin/admin.mjs`; module không tự định nghĩa role model mới.
- Không đổi collection/document, schema hoặc Rules.
- Không deploy production và không merge PR trong task này.
- Không mở rộng refactor sang phần khác.

# File đã thay đổi

- `admin/modules/exports/export-service.mjs`: module mới, chứa logic tạo/tải workbook, cache hash/version, đọc/ghi/xóa Storage export cache, export registrations và export nhanh attendance.
- `admin/admin.mjs`: bỏ logic export nội tuyến, import và khởi tạo export service, giữ nguyên các điểm gọi UI/event binding.
- `scripts/validate-security-static.mjs`: chuyển assertion nhánh quyền export sang module mới và xác nhận `admin/admin.mjs` vẫn truyền `highAdminAccess`.
- `docs/AI-HANDOVER.md`: cập nhật handover cho refactor export.

# Kiểm tra

- `node --check admin/admin.mjs`: PASS.
- `node --check admin/modules/exports/export-service.mjs`: PASS.
- `node --check scripts/validate-security-static.mjs`: PASS.
- `node scripts/validate-security-static.mjs`: PASS, kết quả `Static security assertions passed.`.
- `git diff --check`: PASS.
- Test Firebase Emulator export hiện có:
  - Lệnh: `firebase emulators:exec --only firestore,storage --project ifa-activities "node --test --test-name-pattern=Export tests/firebase-rules.test.mjs"`
  - Kết quả: 1/1 PASS, 0 FAIL.
  - Owner và Admin `role=admin`: ALLOW.
  - Sub-admin, Student và unauthenticated: DENY.
- Không chạy toàn bộ suite 19/19 vì refactor không thay đổi Rules.
- Repository không có browser unit test riêng cho luồng tạo/download workbook; không tạo test framework mới.

# Hành động tiếp theo

Review Draft PR #4, tập trung xác nhận diff chỉ di chuyển logic export. Sau refactor này, module phù hợp tiếp theo được đề xuất là `registrations`; không bắt đầu việc đó khi chưa có task/phê duyệt riêng.

# Ràng buộc an toàn

- Không thay đổi hành vi hoặc giao diện export.
- Không thay đổi Owner/Admin/Sub-admin permissions.
- Không thay đổi Firestore Rules hoặc Storage Rules.
- Không thay đổi Firestore schema, collection hoặc document.
- Không deploy production.
- Không merge PR.
- Không refactor phần không liên quan.

# Cập nhật lần cuối

- Commit triển khai refactor: `a4d0920`.
- Branch: `refactor/export-module`
- Trạng thái: refactor export hoàn tất; syntax/static PASS; test Emulator export 1/1 PASS; sẵn sàng tạo Draft PR.
