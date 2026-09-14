# Dự án

- Repository: `tranquanghai-ops/IFAA`
- Branch hiện tại: `fix/storage-export-permissions`
- PR liên quan: PR #3 — https://github.com/tranquanghai-ops/IFAA/pull/3

# Mục tiêu hiện tại

Sửa tối thiểu luồng xuất Excel đăng ký sự kiện để Owner và Admin cấp cao tiếp tục dùng Firebase Storage cache, còn Sub-admin tạo workbook phía client và tải trực tiếp mà không có quyền đọc/ghi rộng trên `exports/**`.

# Trạng thái hiện tại

- Đã đồng bộ `main` sau khi PR #2 merge, tại commit `620ef71`.
- Đã tạo branch `fix/storage-export-permissions`.
- Đã sửa Storage Rules để export cache chỉ cho Owner hoặc tài khoản có document `admins/{email}` với `role == 'admin'`.
- Sub-admin không còn gọi đọc/ghi Storage cache khi xuất Excel. Workbook vẫn được tạo ở client và tải trực tiếp.
- Cơ chế query và kiểm tra quyền sự kiện hiện có không thay đổi. Sub-admin vẫn chỉ nhận các sự kiện do chính UID tạo và được xuất danh sách đăng ký của các sự kiện đó.
- Student và người chưa đăng nhập không được truy cập export cache.
- Không sửa IAM, service account, role model chung, Firestore schema hoặc dữ liệu production.
- Không deploy production.

# Quyết định đã chốt

- `exports/**` là cache dành riêng cho Owner và Admin có `role == 'admin'`.
- Không cấp quyền Storage export cho Sub-admin.
- Sub-admin dùng cùng logic tạo workbook ở client rồi tải trực tiếp.
- Giữ nguyên cross-service Firestore lookup trong Storage Rules; cảnh báo cấu hình trước đây đã được người dùng xử lý bằng “Fix issue”.
- Không sửa IAM hoặc service account cho lỗi này.
- Không thay đổi auth/role architecture, schema Firestore hoặc tạo migration.
- Không đụng Cloud Functions, Blaze, check-in security hoặc registration concurrency.
- Không refactor ngoài luồng export liên quan.

# File đã thay đổi

- `storage.rules`: thêm `exportCacheAdmin()` kiểm tra role chính xác và dùng helper này cho read/create/update/delete trong `exports/{exportType}/{exportFile}`.
- `admin/admin.mjs`: `downloadCachedWorkbook()` bỏ qua Storage với Sub-admin; `saveAndDownloadCachedWorkbook()` tải workbook trực tiếp với Sub-admin; thông báo giao diện phản ánh đúng cache hoặc tải local.
- `tests/firebase-rules.test.mjs`: thêm test Storage Emulator cho Owner, Admin, Sub-admin, Student và unauthenticated.
- `scripts/validate-security-static.mjs`: thêm assertion cho helper role-aware và nhánh tải local.
- `docs/AI-HANDOVER.md`: cập nhật trạng thái cross-machine bằng tiếng Việt.

# Kiểm tra

- `node --check admin/admin.mjs`: PASS.
- `node --check tests/firebase-rules.test.mjs`: PASS.
- `node scripts/validate-security-static.mjs`: PASS, kết quả `Static security assertions passed.`.
- `git diff --check`: PASS.
- Test Storage Emulator mục tiêu:
  - Lệnh: `firebase emulators:exec --only firestore,storage --project ifa-activities "node --test --test-name-pattern=Export tests/firebase-rules.test.mjs"`
  - Kết quả: 1/1 PASS, 0 FAIL.
  - Owner đọc/ghi export cache: ALLOW.
  - Admin `role=admin` đọc/ghi export cache: ALLOW.
  - Sub-admin đọc/ghi export cache: DENY.
  - Student đọc/ghi export cache: DENY.
  - Unauthenticated đọc/ghi export cache: DENY.
- Không chạy toàn bộ Emulator suite hoặc test không liên quan theo yêu cầu Fast Safe Mode.
- Luồng tải workbook local của Sub-admin được xác minh bằng syntax/static assertion; repository không có browser unit-test framework cho hàm DOM này và không tạo framework mới.

# Hành động tiếp theo

Sau khi lấy branch, kiểm tra có commit triển khai `b8e255a869e0cf7ef3bf9cc3b69c677e05886231` và các commit handover sau đó. Review Draft PR #3, giữ trạng thái chưa merge/deploy, rồi người dùng có thể kiểm tra thực tế bằng tài khoản Owner, Admin và Sub-admin.

# Ràng buộc an toàn

- Không deploy production.
- Không merge PR.
- Không sửa IAM hoặc service account cho cross-service lookup.
- Không đổi role model chung.
- Không đổi schema Firestore hoặc migration dữ liệu.
- Không dùng Cloud Functions hoặc Blaze.
- Không sửa check-in security hoặc registration concurrency.
- Không refactor không liên quan.

# Cập nhật lần cuối

- Commit triển khai: `b8e255a869e0cf7ef3bf9cc3b69c677e05886231`
- Branch: `fix/storage-export-permissions`
- Trạng thái: bản sửa tối thiểu hoàn tất; syntax/static PASS; Storage Emulator mục tiêu 1/1 PASS; chưa deploy, chưa merge.
