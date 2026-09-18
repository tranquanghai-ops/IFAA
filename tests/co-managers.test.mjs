import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addCoManagerUid,
  canEditResourceCoManagers,
  inheritedAttendanceCoManagerUids,
  isResourceCoManager,
  normalizeCoManagerUids
} from "../admin/modules/co-managers.mjs";

const adminSource = readFileSync("admin/admin.mjs", "utf8");
const adminHtml = readFileSync("admin/index.html", "utf8");
const eventServiceSource = readFileSync("admin/modules/events/event-service.mjs", "utf8");
const checkinSource = readFileSync("check-in/check-in.mjs", "utf8");
const rulesSource = readFileSync("firestore.rules", "utf8");

test("legacy resource không có coManagerUids được chuẩn hóa thành mảng rỗng", () => {
  assert.deepEqual(normalizeCoManagerUids(undefined), []);
  assert.equal(isResourceCoManager({}, "u1"), false);
});

test("UID đồng quản lý được trim, loại rỗng và duplicate", () => {
  assert.deepEqual(normalizeCoManagerUids([" u1 ", "u1", "", null, "u2"]), ["u1", "u2"]);
});

test("thêm đồng quản lý chặn duplicate và người tạo", () => {
  assert.deepEqual(addCoManagerUid([], "u2", "u1"), ["u2"]);
  assert.throws(() => addCoManagerUid(["u2"], "u2", "u1"), /đã là đồng quản lý/);
  assert.throws(() => addCoManagerUid([], "u1", "u1"), /người tạo/);
  assert.throws(() => addCoManagerUid(Array.from({ length: 20 }, (_, index) => `u${index}`), "extra", "owner"), /tối đa 20/);
});

test("chỉ creator hoặc high Admin chỉnh danh sách đồng quản lý", () => {
  const resource = { createdByUid: "owner", coManagerUids: ["co"] };
  assert.equal(canEditResourceCoManagers(resource, "owner", false), true);
  assert.equal(canEditResourceCoManagers(resource, "admin", true), true);
  assert.equal(canEditResourceCoManagers(resource, "co", false), false);
});

test("Attendance kế thừa snapshot co-manager và sau đó độc lập Event", () => {
  const event = { coManagerUids: ["a", "b"] };
  const attendance = inheritedAttendanceCoManagerUids(event);
  attendance.pop();
  assert.deepEqual(attendance, ["a"]);
  assert.deepEqual(event.coManagerUids, ["a", "b"]);
});

test("người tạo Attendance không bị giữ lại trong danh sách co-manager kế thừa", () => {
  assert.deepEqual(inheritedAttendanceCoManagerUids({ coManagerUids: ["creator", "other"] }, "creator"), ["other"]);
});

test("scoped login và subscriptions chỉ truy vấn resource được giao", () => {
  const eventConfigStart = adminSource.indexOf("} = createAdminEventService({");
  const eventServiceConfig = adminSource.slice(eventConfigStart, adminSource.indexOf("const {", eventConfigStart + 10));
  assert.match(adminSource, /return eventAssignments\.empty && attendanceAssignments\.empty \? null : \{ role: "scoped_manager"/);
  assert.match(eventServiceConfig, /getIsScopedManager: \(\) => isScopedManager/);
  assert.match(eventServiceSource, /where\("coManagerUids", "array-contains", user\.uid\)/);
  assert.match(adminSource, /where\("coManagerUids", "array-contains", user\.uid\)/);
  assert.match(adminSource, /if \(!\["events", "attendance"\]\.includes\(button\.dataset\.pane\)\) button\.classList\.add\("hidden"\)/);
});

test("scoped-only user không có nút tạo global hoặc xóa resource", () => {
  assert.match(adminSource, /if \(isScopedManager\) \{[\s\S]*#newEventBtn[\s\S]*#newAttendanceBtn/);
  assert.match(eventServiceSource, /const canDelete = !getIsScopedManager\(\) && canManageResource\(event\)/);
  assert.match(eventServiceSource, /data-delete="\$\{event\.id\}" \$\{canDelete \? "" : "disabled"\}/);
  assert.match(adminSource, /const canDeleteAttendance = privateAttendance \? isOwner \|\| item\.createdByUid === user\?\.uid : managesResource\(item\)/);
  assert.match(adminSource, /\$\{canDeleteAttendance \? `<button class="btn btn-danger" data-delete-attendance/);
});

test("Attendance có UI chỉnh danh sách độc lập và ẩn với co-manager", () => {
  assert.match(adminHtml, /id="attendanceManageCoManagerSection"/);
  assert.match(adminHtml, /id="attendanceManageCoManagerSave"/);
  assert.match(adminSource, /const editable = item\?\.attendanceType !== "private" && canEditCoManagers\(item\)/);
  assert.match(adminSource, /classList\.toggle\("hidden", !editable\)/);
  assert.match(adminSource, /attendance\.co_managers\.update/);
});

test("create Attendance lưu snapshot coManagerUids kế thừa", () => {
  assert.match(adminSource, /attendanceCoManagerUids = inheritedAttendanceCoManagerUids\(selected, user\.uid\)/);
  assert.match(adminSource, /coManagerUids: attendancePrivateCreate \? \[\] : \[\.\.\.new Set\(attendanceCoManagerUids\)\]/);
});

test("Check-in chỉ nhận co-manager từ chính Attendance đang mở", () => {
  assert.match(checkinSource, /sessionSnapshot\.data\(\)\?\.coManagerUids\?\.includes\(currentUser\.uid\)/);
  assert.match(rulesSource, /function managesSession\(sessionId\)[\s\S]*attendanceCoManager\(sessionId\)/);
  assert.match(rulesSource, /allow create: if attendanceAccepting\(request\.resource\.data\.sessionId\)/);
});
