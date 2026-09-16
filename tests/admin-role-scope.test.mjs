import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FACULTY_SCOPE_ID, accessLabel, allowedScopeForNewAdmin, canCreateCategory,
  canManageAdmin, canManageResource, categoryScope, creatableRoles,
  normalizeAdminAccess, resourceScope, roleDocument
} from "../admin/modules/role-scope.mjs";

const system = normalizeAdminAccess({}, { owner: true });
const high = normalizeAdminAccess({ role: "high_admin", scopeType: "global" });
const faculty = normalizeAdminAccess({ role: "faculty_admin", scopeType: "faculty", scopeId: "mtcn" });
const interior = normalizeAdminAccess({ role: "department_admin", scopeType: "department", scopeId: "interior" });
const graphic = normalizeAdminAccess({ role: "department_admin", scopeType: "department", scopeId: "graphic" });
const facultySub = normalizeAdminAccess({ role: "sub_admin", scopeType: "faculty", scopeId: "mtcn" });
const interiorSub = normalizeAdminAccess({ role: "sub_admin", scopeType: "department", scopeId: "interior" });

test("Owner legacy được map thành Quản trị hệ thống", () => {
  assert.equal(system.role, "system_admin");
  assert.equal(accessLabel(system), "Quản trị hệ thống");
});

test("legacy Admin và Sub-admin không crash, giữ mapping tương thích", () => {
  assert.deepEqual(normalizeAdminAccess({ role: "admin" }), { role: "high_admin", scopeType: "global", scopeId: "", legacy: true });
  assert.equal(normalizeAdminAccess({ role: "subadmin" }).scopeType, "legacy");
});

test("System admin thấy đủ bốn role có thể cấp", () => {
  assert.deepEqual(creatableRoles(system), ["high_admin", "faculty_admin", "department_admin", "sub_admin"]);
});

test("High admin không thể tạo/quản lý High admin", () => {
  assert.deepEqual(creatableRoles(high), ["faculty_admin", "department_admin", "sub_admin"]);
  assert.equal(canManageAdmin(high, high), false);
});

test("High admin tạo Faculty/Department admin", () => {
  assert.equal(canManageAdmin(high, faculty), true);
  assert.equal(canManageAdmin(high, interior), true);
});

test("Faculty admin chỉ tạo Sub-admin, không tạo Department admin", () => {
  assert.deepEqual(creatableRoles(faculty), ["sub_admin"]);
  assert.equal(canManageAdmin(faculty, interiorSub), true);
  assert.equal(canManageAdmin(faculty, interior), false);
});

test("Department admin chỉ quản lý Sub-admin ngành mình", () => {
  assert.equal(canManageAdmin(interior, interiorSub), true);
  assert.equal(canManageAdmin(graphic, interiorSub), false);
  assert.equal(allowedScopeForNewAdmin(interior, interiorSub), true);
});

test("Sub-admin không có role management UI", () => {
  assert.deepEqual(creatableRoles(facultySub), []);
  assert.deepEqual(creatableRoles(interiorSub), []);
});

test("Role và scope combination được validation", () => {
  assert.deepEqual(roleDocument("sub_admin", "faculty"), { role: "sub_admin", scopeType: "faculty", scopeId: FACULTY_SCOPE_ID });
  assert.throws(() => roleDocument("department_admin", "faculty"));
  assert.throws(() => roleDocument("sub_admin", "department", "unknown"));
});

test("Department admin chỉ quản lý Event đúng ngành", () => {
  assert.equal(canManageResource(interior, { scopeType: "department", scopeId: "interior", createdByUid: "sub" }, "head"), true);
  assert.equal(canManageResource(interior, { scopeType: "department", scopeId: "graphic", createdByUid: "sub" }, "head"), false);
});

test("Legacy Event taxonomy ngành được nhận diện mà không migration", () => {
  assert.deepEqual(resourceScope({ category: "Ngành Thiết kế nội thất" }), { scopeType: "department", scopeId: "interior", legacy: true });
  assert.equal(canManageResource(interior, { category: "Ngành Thiết kế nội thất", createdByUid: "sub" }, "head"), true);
});

test("Legacy Group không rõ scope giữ creator-only cho Department admin", () => {
  assert.equal(canManageResource(interior, { createdByUid: "head" }, "head"), true);
  assert.equal(canManageResource(interior, { createdByUid: "other" }, "head"), false);
});

test("Sub-admin Khoa và Ngành hiển thị đúng scope", () => {
  assert.equal(accessLabel(facultySub), "Sub-admin Khoa");
  assert.equal(accessLabel(interiorSub), "Sub-admin — Thiết kế Nội thất");
});

test("Mọi Sub-admin được tạo External Event nhưng Event thường bị giới hạn theo ngành", () => {
  assert.equal(canCreateCategory(interiorSub, "Sự kiện Trường"), true);
  assert.equal(canCreateCategory(interiorSub, "Sự kiện Khoa khác"), true);
  assert.equal(canCreateCategory(interiorSub, "Ngành Đồ họa"), false);
  assert.equal(canCreateCategory(interiorSub, "Ngành Thiết kế nội thất"), true);
});

test("Sub-admin Khoa tạo được Event ngành, legacy Sub-admin giữ scope creator-only", () => {
  assert.deepEqual(categoryScope("Ngành Thiết kế nội thất", facultySub), { scopeType: "department", scopeId: "interior" });
  assert.deepEqual(categoryScope("Ngành Thiết kế nội thất", normalizeAdminAccess({ role: "subadmin" })), { scopeType: "legacy", scopeId: "" });
});

test("External Event giữ scope creator để không shared sang Sub-admin khác", () => {
  const scope = categoryScope("Sự kiện Khoa khác", interiorSub);
  const event = { ...scope, createdByUid: "interior-sub" };
  assert.equal(canManageResource(interiorSub, event, "interior-sub"), true);
  assert.equal(canManageResource(normalizeAdminAccess({ role: "sub_admin", scopeType: "department", scopeId: "graphic" }), event, "graphic-sub"), false);
  assert.equal(canManageResource(interior, event, "head"), true);
  assert.equal(canManageResource(faculty, event, "faculty"), true);
});

test("Attendance/Event create lưu scope và UI role dùng module canonical", () => {
  const adminSource = readFileSync("admin/admin.mjs", "utf8");
  const eventSource = readFileSync("admin/modules/events/event-service.mjs", "utf8");
  assert.match(eventSource, /Object\.assign\(data, getCategoryScope\(data\.category\)\)/);
  assert.match(adminSource, /const attendanceScope = sourceEvent\?\.scopeType/);
  assert.match(adminSource, /\.\.\.attendanceScope/);
});

test("Co-manager và Hidden Group behavior vẫn độc lập", () => {
  const adminSource = readFileSync("admin/admin.mjs", "utf8");
  const resourceSource = readFileSync("admin/modules/resource-ui.mjs", "utf8");
  assert.match(adminSource, /isResourceCoManager/);
  assert.match(resourceSource, /export function eventsVisibleInAdmin/);
  assert.match(resourceSource, /hiddenGroupIds/);
});

test("Firestore/Storage có enforcement role, scope và escalation protection", () => {
  const rules = readFileSync("firestore.rules", "utf8");
  const storage = readFileSync("storage.rules", "utf8");
  assert.match(rules, /function canManageAdminData/);
  assert.match(rules, /adminEmail != email\(\)/);
  assert.match(rules, /validEventScope/);
  assert.match(rules, /scopeFieldsUnchanged/);
  assert.match(storage, /function managesResource/);
});
