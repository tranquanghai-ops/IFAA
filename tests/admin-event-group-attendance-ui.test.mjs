import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creatorLabel, eventsVisibleInAdmin, groupsForVisibility, isGroupHidden } from "../admin/modules/resource-ui.mjs";

const adminSource = readFileSync("admin/admin.mjs", "utf8");
const groupSource = readFileSync("admin/modules/groups/group-service.mjs", "utf8");
const adminHtml = readFileSync("admin/index.html", "utf8");
const attendanceCss = readFileSync("attendance.css", "utf8");
const styles = readFileSync("styles.css", "utf8");
const studentSource = readFileSync("student.mjs", "utf8");
const rulesSource = readFileSync("firestore.rules", "utf8");
const eventServiceSource = readFileSync("admin/modules/events/event-service.mjs", "utf8");

test("Event kết thúc có nền hồng nhạt và phân cấp cảnh báo rõ", () => {
  assert.match(styles, /\.admin-event-card\.event-ended,\.admin-event-card\.event-closed\{background:#fff5f6;border-color:#e9a5ad\}/);
  assert.match(styles, /\.tag\.admin-ended\{border:1px solid #e98f99;background:#f8cbd0;color:#861528;font-weight:900\}/);
  assert.match(styles, /\.admin-event-card\.event-ended \.countdown,\.admin-event-card\.event-closed \.countdown\{color:#97152a;font-weight:900\}/);
  assert.match(styles, /\.admin-event-card\.event-ended \.admin-card-actions \.btn-danger,\.admin-event-card\.event-closed \.admin-card-actions \.btn-danger\{border-color:#b42318;background:#b42318;color:#fff\}/);
  assert.match(styles, /\.admin-event-card\.event-ended \.admin-card-actions \.btn-danger:hover,\.admin-event-card\.event-closed \.admin-card-actions \.btn-danger:hover\{border-color:#8f1b14;background:#8f1b14;color:#fff\}/);
});

test("creator label ưu tiên tên, fallback email rồi dấu gạch", () => {
  assert.equal(creatorLabel({ createdByName: "Nguyễn A", createdByEmail: "a@example.com" }), "Nguyễn A");
  assert.equal(creatorLabel({ createdByEmail: "a@example.com" }), "a@example.com");
  assert.equal(creatorLabel({}), "—");
});

test("Group và Attendance đều render metadata Người tạo an toàn", () => {
  assert.match(groupSource, /Người tạo: \$\{safe\(creatorLabel\(group\)\)\}/);
  assert.match(adminSource, /<b>Người tạo:<\/b> \$\{safe\(creatorLabel\(item\)\)\}/);
  assert.match(groupSource, /createdByName: user\.displayName \|\| ""/);
});

test("Attendance filter bắt đầu bằng Tất cả và mặc định all", () => {
  const filters = [...adminHtml.matchAll(/data-attendance-filter="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(filters.slice(0, 5), ["all", "open", "scheduled", "ended", "finalized"]);
  assert.match(adminSource, /let attendanceFilter = "all";/);
});

test("Attendance empty state span toàn bộ grid", () => {
  assert.match(adminSource, /class="card empty attendance-empty-card"/);
  assert.match(attendanceCss, /\.attendance-empty-card\{grid-column:1\/-1;width:100%\}/);
});

test("nút tải danh sách và lịch Group dùng cùng sizing grid", () => {
  assert.match(groupSource, /actions group-action-buttons/);
  assert.match(styles, /\.group-action-buttons\{display:grid!important;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /#groupRows \.group-action-buttons \.btn-download-list\{grid-column:auto!important\}/);
});

test("legacy Group không có hidden thuộc tab active", () => {
  const legacy = { id: "legacy" };
  assert.equal(isGroupHidden(legacy), false);
  assert.deepEqual(groupsForVisibility([legacy], "active"), [legacy]);
});

test("Group hidden chỉ nằm tab Đã ẩn và restore quay về active", () => {
  const active = { id: "active", hidden: false };
  const hidden = { id: "hidden", hiddenAt: new Date() };
  assert.deepEqual(groupsForVisibility([active, hidden], "active"), [active]);
  assert.deepEqual(groupsForVisibility([active, hidden], "hidden"), [hidden]);
  assert.equal(isGroupHidden({ ...hidden, hidden: false, hiddenAt: null }), false);
  assert.match(adminHtml, /data-group-visibility="active">Đang hoạt động<\/button><button[^>]+data-group-visibility="hidden">Đã ẩn/);
});

test("Admin Events ẩn Event thuộc hidden Group nhưng giữ Event riêng", () => {
  const events = [
    { id: "active-event", groupId: "active-group" },
    { id: "hidden-event", groupId: "hidden-group" },
    { id: "ungrouped-event" }
  ];
  const groups = [{ id: "active-group" }, { id: "hidden-group", hidden: true }];
  assert.deepEqual(eventsVisibleInAdmin(events, groups).map((event) => event.id), ["active-event", "ungrouped-event"]);
  assert.match(eventServiceSource, /const adminEvents = eventsVisibleInAdmin\(activeEvents, activeGroups\)/);
  assert.match(eventServiceSource, /statusFilter === "all" \? adminEvents\.filter/);
});

test("restore Group làm Event xuất hiện lại trong Admin", () => {
  const event = { id: "event", groupId: "group" };
  assert.deepEqual(eventsVisibleInAdmin([event], [{ id: "group", hiddenAt: new Date() }]), []);
  assert.deepEqual(eventsVisibleInAdmin([event], [{ id: "group", hidden: false, hiddenAt: null }]), [event]);
});

test("Hide/restore Group chỉ cập nhật document eventGroups, không cascade", () => {
  const hideBlock = groupSource.slice(groupSource.indexOf("if (button.dataset.hideGroup)"), groupSource.indexOf("if (button.dataset.showGroup)"));
  const showBlock = groupSource.slice(groupSource.indexOf("if (button.dataset.showGroup)"), groupSource.indexOf("if (button.dataset.deleteGroup)"));
  assert.match(hideBlock, /doc\(db, "eventGroups", selected\.id\)/);
  assert.match(hideBlock, /hidden: true, hiddenAt: serverTimestamp\(\)/);
  assert.doesNotMatch(hideBlock, /doc\(db, "events"|registrations|attendanceSessions|deleteDoc/);
  assert.match(showBlock, /hidden: false, hiddenAt: null/);
  assert.doesNotMatch(showBlock, /doc\(db, "events"|registrations|attendanceSessions|deleteDoc/);
});

test("quyền hide Group giữ nguyên theo quyền sửa Group, không cấp cho co-manager", () => {
  const groupRules = rulesSource.slice(rulesSource.indexOf("match /eventGroups/{groupId}"), rulesSource.indexOf("match /events/{eventId}"));
  assert.match(groupRules, /allow update: if canManageResourceData\(resource\.data\)/);
  assert.doesNotMatch(groupRules, /eventCoManager|attendanceCoManager|managesEvent|managesSession/);
});

test("Group hidden không làm Event biến mất khỏi student UI", () => {
  assert.match(studentSource, /if \(event\.deletedAt \|\| groups\.get\(event\.groupId\)\?\.deletedAt\) return false/);
  assert.doesNotMatch(studentSource, /groups\.get\(event\.groupId\)\?\.(hidden|hiddenAt)/);
});
