import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeAttendanceSessionById, activeAttendanceSessionForEvent } from "../attendance-link.mjs";

const adminSource = readFileSync("admin/admin.mjs", "utf8");
const adminHtml = readFileSync("admin/index.html", "utf8");
const eventServiceSource = readFileSync("admin/modules/events/event-service.mjs", "utf8");
const studentSource = readFileSync("student.mjs", "utf8");

test("event chưa có điểm danh có thể tạo mới", () => {
  assert.equal(activeAttendanceSessionForEvent([], "EVENT_A"), null);
});

test("event có điểm danh đang tồn tại không được tạo trùng", () => {
  const active = { id: "CHECKIN_B", eventId: "EVENT_A", status: "open" };
  assert.equal(activeAttendanceSessionForEvent([active], "EVENT_A"), active);
});

test("điểm danh hard-delete hoặc soft-delete không chặn tạo lại", () => {
  assert.equal(activeAttendanceSessionForEvent([], "EVENT_A"), null);
  assert.equal(activeAttendanceSessionForEvent([
    { id: "CHECKIN_B", eventId: "EVENT_A", deletedAt: new Date() }
  ], "EVENT_A"), null);
});

test("sau khi tạo lại, event được nhận diện qua attendance session mới", () => {
  const sessions = [
    { id: "CHECKIN_B", eventId: "EVENT_A", deletedAt: new Date() },
    { id: "CHECKIN_C", eventId: "EVENT_A", deletedAt: null }
  ];
  assert.equal(activeAttendanceSessionForEvent(sessions, "EVENT_A")?.id, "CHECKIN_C");
  assert.equal(activeAttendanceSessionById(sessions, "CHECKIN_B"), null);
  assert.equal(activeAttendanceSessionById(sessions, "CHECKIN_C")?.id, "CHECKIN_C");
});

test("không nhận nhầm điểm danh của event khác", () => {
  assert.equal(activeAttendanceSessionForEvent([
    { id: "CHECKIN_OTHER", eventId: "EVENT_OTHER", deletedAt: null }
  ], "EVENT_A"), null);
});

test("luồng click và validation create đều dùng cùng active-session lookup", () => {
  assert.match(adminSource, /if \(activeAttendanceSessionForEvent\(attendanceSessions, eventId\)\) throw Error\("Sự kiện này đã có phiên điểm danh\."\)/);
  assert.match(adminSource, /const existing = activeAttendanceSessionForEvent\(attendanceSessions, button\.dataset\.attendanceEvent\)/);
  assert.match(adminSource, /data: \{ eventId, source: eventId \? "registration" : "standalone"/);
  assert.doesNotMatch(adminSource, /attendanceSessions\.some\(\(item\) => item\.eventId === eventId\)/);
});

test("deleted session không mở Manage và nút Create chung xóa selected state", () => {
  assert.match(adminSource, /selectedAttendanceSession = activeAttendanceSessionById\(attendanceSessions, sessionId\)/);
  assert.match(adminSource, /function resetAttendanceCreateState\(\) \{\s*selectedAttendanceSession = null;/);
  assert.match(adminSource, /function openAttendanceCreate\(eventId = ""\) \{\s*resetAttendanceCreateState\(\)/);
  assert.match(adminSource, /attendanceCreateDialog"\)\.addEventListener\("close", resetAttendanceCreateState\)/);
  assert.match(adminSource, /if \(button\.id === "newAttendanceBtn"\) \{\s*openAttendanceCreate\(\);/);
  assert.match(adminSource, /if \(selectedAttendanceSession\?\.id === selected\.id\) \{\s*selectedAttendanceSession = null;/);
});

test("danh sách Attendance mặc định là Tất cả và chỉ giữ session active", () => {
  assert.match(adminSource, /let attendanceFilter = "all";/);
  assert.match(adminHtml, /data-attendance-filter="all">Tất cả<\/button>/);
  assert.match(adminSource, /attendanceSessions\.filter\(\(item\) => !item\.deletedAt\)/);
});

test("card Event dùng active-session lookup, luôn clickable và mở Create/Manage đúng trạng thái", () => {
  assert.match(eventServiceSource, /import \{ activeAttendanceSessionForEvent \} from "\.\.\/\.\.\/\.\.\/attendance-link\.mjs";/);
  assert.match(eventServiceSource, /const activeAttendance = activeAttendanceSessionForEvent\(attendanceSessions, event\.id\);/);
  assert.match(eventServiceSource, /data-attendance-event="\$\{event\.id\}">\$\{activeAttendance \? "✓ Đã tạo điểm danh" : "＋ Tạo điểm danh"\}/);
  assert.doesNotMatch(eventServiceSource, /data-attendance-event="\$\{event\.id\}"[^>]*disabled/);
  assert.match(adminSource, /if \(existing\) await openAttendanceManage\(existing\.id\);/);
  assert.match(adminSource, /openAttendanceCreate\(button\.dataset\.attendanceEvent\);/);
});

test("direct-link event deleted hoặc not-found ẩn khu vực filters", () => {
  const missingStart = studentSource.indexOf("if (linkedEventCode && eventsLoaded && !focusedEvent)");
  const missingEnd = studentSource.indexOf("const filterLabels", missingStart);
  assert.ok(missingStart >= 0 && missingEnd > missingStart);
  assert.match(studentSource.slice(missingStart, missingEnd), /#studentAdvancedFilters/);
});
