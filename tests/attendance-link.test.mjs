import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeAttendanceSessionForEvent } from "../attendance-link.mjs";

const adminSource = readFileSync("admin/admin.mjs", "utf8");

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
