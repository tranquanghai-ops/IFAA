# Dự án

- Repository: `tranquanghai-ops/IFAA`
- Branch hiện tại: `refactor/events-module`
- Nhánh đích: `main`
- Base commit: `2b5dfc4` (`Merge pull request #5 from tranquanghai-ops/refactor/registrations-module`)

# Mục tiêu hiện tại

Modular hóa có giới hạn bằng cách tách logic quản lý events khỏi `admin/admin.mjs`, chỉ refactor cấu trúc và giữ nguyên hành vi production.

# Trạng thái hiện tại

- Logic quản lý events đã được chuyển phần lớn sang module riêng `admin/modules/events/event-service.mjs`.
- Module mới giữ state riêng cho event status filter và kiểu hiển thị cards/list.
- Module mới chứa event date/time/status/capacity/HOT/NEW/external helpers, render danh sách và thùng rác event, realtime event subscription, chuẩn bị dialog, validation dữ liệu, move, tạo link, trash, restore và permanent delete.
- Event list vẫn được giữ ở top-level `admin.mjs` vì registrations, export, groups và attendance cùng đọc danh sách này; service cập nhật qua dependency `setEvents`.
- `admin/admin.mjs` giữ event binding chính và orchestration với groups/registrations/attendance/export.
- `admin/admin.mjs` giảm từ 2.924 xuống 2.472 dòng.
- Không thay đổi UI, quyền Owner/Admin/Sub-admin, Auth, Firestore schema, Firestore Rules hoặc Storage Rules.
- Không thay đổi Firestore path, timestamp/date behavior, transaction/batch behavior, event lifecycle, capacity hoặc registration integration.
- Không sửa `student.mjs`, registrations module hoặc export module.

# Logic event cố ý còn lại trong admin/admin.mjs

- Event binding cho filter/view, dialog, form submit, quick actions và các module liên quan.
- Phần cuối của event form submit: tạo group mới ngay trong dialog event, gắn event vào group và đồng bộ các field được chọn cho sibling events.
- Firestore create/update event trong form submit vì đoạn này phối hợp trực tiếp với group creation và group-wide synchronization.
- Group bulk status, group trash/restore/purge và các event write phát sinh từ group lifecycle.
- Cleanup scheduler gọi permanent delete API của events module.
- Attendance source selection và roster linkage dùng event list, vì đây là orchestration attendance.
- Quick registrations và export gọi registrations/export module bằng event ID.

# Dependencies với groups/registrations

- Events module nhận `getGroups`, `groupCode` và `groupPosition` qua dependency để render event theo nhóm và tạo share code không trùng; không import group module.
- Events module gọi `fetchRegistrations` và `removeRegistration` được inject khi permanent delete event; không import registrations module.
- `admin.mjs` giữ shared `events` list và truyền getter cho registrations/export/attendance.
- Không có module nào import ngược `admin.mjs`; không có circular dependency.

# File đã thay đổi

- `admin/modules/events/event-service.mjs`: module mới chứa logic thuần event và event lifecycle.
- `admin/admin.mjs`: bỏ logic event nội tuyến đã chuyển, khởi tạo events service và giữ orchestration/event binding.
- `scripts/validate-security-static.mjs`: thêm assertion cho wiring, Sub-admin event scope và owner-only permanent delete.
- `docs/AI-HANDOVER.md`: cập nhật handover cho refactor events.

# Kiểm tra

- `node --check admin/admin.mjs`: PASS.
- `node --check admin/modules/events/event-service.mjs`: PASS.
- `node --check admin/modules/registrations/registration-service.mjs`: PASS.
- `node --check admin/modules/exports/export-service.mjs`: PASS.
- `node --check scripts/validate-security-static.mjs`: PASS.
- `node scripts/validate-security-static.mjs`: PASS, kết quả `Static security assertions passed.`.
- `git diff --check`: PASS.
- Targeted Firebase Emulator registrations integration:
  - Lệnh: `firebase emulators:exec --only firestore,storage --project ifa-activities "node --test --test-name-pattern=registration tests/firebase-rules.test.mjs"`
  - Kết quả: 6/6 PASS, 0 FAIL.
- Repository không có targeted test riêng cho admin event CRUD/render.
- Không chạy toàn bộ emulator suite vì không thay đổi Rules.
- Không tạo test framework mới.

# Quyết định đã chốt

- Giữ một file `event-service.mjs` để tránh chia nhỏ quá mức.
- Shared event list tiếp tục ở `admin.mjs`; event-only filter/view state chuyển vào service.
- Không tách group management trong task này.
- Event form validation chuyển vào service; phần write có group creation/synchronization ở lại `admin.mjs` để giữ ranh giới orchestration rõ ràng.
- Commit triển khai dùng message: `refactor: extract admin events module`.
- Không deploy production và không merge PR trong task này.

# Hành động tiếp theo

Review Draft PR của branch `refactor/events-module`, tập trung xác nhận diff chỉ di chuyển logic events, event lifecycle và permission scope không đổi. Sau refactor này, module phù hợp tiếp theo được đề xuất là `students`; không bắt đầu việc đó khi chưa có task/phê duyệt riêng.

# Ràng buộc an toàn

- Không thay đổi hành vi hoặc giao diện events.
- Không thay đổi Owner/Admin/Sub-admin permissions hoặc Auth.
- Không thay đổi Firestore Rules hoặc Storage Rules.
- Không thay đổi Firestore schema, collection hoặc document.
- Không thay đổi transaction/batch behavior.
- Không thay đổi student-facing event flow.
- Không deploy production.
- Không merge PR.
- Không refactor groups, registrations, export hoặc attendance ngoài dependency wiring cần thiết.

# Cập nhật lần cuối

- Branch: `refactor/events-module`.
- Commit: `refactor: extract admin events module`.
- Trạng thái: refactor events hoàn tất; syntax/static PASS; targeted registrations integration 6/6 PASS; sẵn sàng tạo Draft PR.
