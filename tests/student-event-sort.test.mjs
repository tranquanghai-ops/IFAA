import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareStudentAllEvents, matchesStudentGroupFilter } from "../student-event-sort.mjs";

const stateOf = (event) => event.state;
const now = new Date("2026-09-15T12:00:00Z").getTime();
const sortAll = (events) => events.slice().sort((a, b) => compareStudentAllEvents(a, b, stateOf, now));
const studentSource = readFileSync("student.mjs", "utf8");

test("Tất cả xếp upcoming trước open trước ended/closed", () => {
  const result = sortAll([
    { id: "ended", state: "ended", date: "2026-09-14", endTime: "12:00" },
    { id: "open", state: "open", openAt: "2026-09-15T10:00:00Z" },
    { id: "upcoming", state: "upcoming", openAt: "2026-09-15T13:00:00Z" }
  ]);
  assert.deepEqual(result.map((event) => event.id), ["upcoming", "open", "ended"]);
});

test("upcoming gần thời điểm mở nhất lên trước", () => {
  const result = sortAll([
    { id: "tomorrow", state: "upcoming", openAt: "2026-09-16T12:00:00Z" },
    { id: "two-hours", state: "upcoming", openAt: "2026-09-15T14:00:00Z" },
    { id: "twenty-minutes", state: "upcoming", openAt: "2026-09-15T12:20:00Z" }
  ]);
  assert.deepEqual(result.map((event) => event.id), ["twenty-minutes", "two-hours", "tomorrow"]);
});

test("open gần thời điểm mở hiện tại nhất lên trước", () => {
  const result = sortAll([
    { id: "old-open", state: "open", openAt: "2026-09-10T12:00:00Z" },
    { id: "recent-open", state: "open", openAt: "2026-09-15T11:30:00Z" }
  ]);
  assert.deepEqual(result.map((event) => event.id), ["recent-open", "old-open"]);
});

test("ended/closed gần đây nhất lên trước", () => {
  const result = sortAll([
    { id: "old-ended", state: "ended", date: "2026-09-10", endTime: "12:00" },
    { id: "recent-closed", state: "closed", closeAt: "2026-09-15T11:00:00Z" },
    { id: "recent-ended", state: "ended", date: "2026-09-15", endTime: "10:00" }
  ]);
  assert.deepEqual(result.map((event) => event.id), ["recent-closed", "recent-ended", "old-ended"]);
});

test("Group không phải khóa sort chính trong Tất cả", () => {
  const result = sortAll([
    { id: "same-group-ended", groupId: "G1", state: "ended", date: "2026-09-15", endTime: "10:00" },
    { id: "other-group-upcoming", groupId: "G2", state: "upcoming", openAt: "2026-09-15T13:00:00Z" },
    { id: "same-group-open", groupId: "G1", state: "open", openAt: "2026-09-15T11:00:00Z" }
  ]);
  assert.deepEqual(result.map((event) => event.id), ["other-group-upcoming", "same-group-open", "same-group-ended"]);
  assert.match(studentSource, /if \(filter === "all"\) return compareStudentAllEvents/);
  assert.match(studentSource, /if \(filter === "all" && !linkedCode\)[\s\S]*list\.map\(eventCard\)/);
});

test("lọc Group cụ thể và không nhóm vẫn chính xác", () => {
  assert.equal(matchesStudentGroupFilter({ groupId: "G1" }, "G1"), true);
  assert.equal(matchesStudentGroupFilter({ groupId: "G2" }, "G1"), false);
  assert.equal(matchesStudentGroupFilter({}, "__ungrouped__"), true);
  assert.equal(matchesStudentGroupFilter({ groupId: "G1" }, "__ungrouped__"), false);
  assert.equal(matchesStudentGroupFilter({ groupId: "G1" }, ""), true);
});

test("các filter student hiện hữu giữ điều kiện eligibility", () => {
  assert.match(studentSource, /if \(filter === "mine"\) return true/);
  assert.match(studentSource, /if \(filter === "ended"\) return state === "ended"/);
  assert.match(studentSource, /return \["upcoming", "open", "full"\]\.includes\(state\)/);
});

test("hidden Group không ảnh hưởng ended/open hoặc sorting phía student", () => {
  const hiddenGroupEvents = [
    { id: "ended-hidden-group", groupId: "hidden-group", state: "ended", date: "2026-09-15", endTime: "10:00" },
    { id: "open-hidden-group", groupId: "hidden-group", state: "open", openAt: "2026-09-15T11:30:00Z" },
    { id: "upcoming-active-group", groupId: "active-group", state: "upcoming", openAt: "2026-09-15T13:00:00Z" }
  ];
  assert.deepEqual(sortAll(hiddenGroupEvents).map((event) => event.id), ["upcoming-active-group", "open-hidden-group", "ended-hidden-group"]);
  assert.equal(hiddenGroupEvents.filter((event) => event.state === "ended").some((event) => event.id === "ended-hidden-group"), true);
  assert.equal(hiddenGroupEvents.filter((event) => ["upcoming", "open", "full"].includes(event.state)).some((event) => event.id === "open-hidden-group"), true);
  assert.doesNotMatch(studentSource, /groups\.get\(event\.groupId\)\?\.(hidden|hiddenAt)/);
});
