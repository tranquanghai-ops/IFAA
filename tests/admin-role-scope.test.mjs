import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FACULTY_SCOPE_ID, accessLabel, allowedScopeForNewAdmin, assignableScopeOptions,
  canCreateCategory, canManageAdmin, canManageResource, categoryScope, creatableRoles,
  departmentCategory, filterSortAdmins, grantorLabel, normalizeAdminAccess,
  normalizeScopeIds, resourceScope, roleDocument, scopeSubset
} from "../admin/modules/role-scope.mjs";

const system = normalizeAdminAccess({}, { owner: true });
const high = normalizeAdminAccess({ role: "high_admin", scopeType: "global" });
const faculty = normalizeAdminAccess({ role: "faculty_admin", scopeType: "faculty", scopeId: "mtcn" });
const interior = normalizeAdminAccess({ role: "department_admin", scopeType: "department", scopeId: "interior" });
const graphic = normalizeAdminAccess({ role: "department_admin", scopeType: "department", scopeId: "graphic" });
const facultySub = normalizeAdminAccess({ role: "sub_admin", scopeType: "faculty", scopeId: "mtcn" });
const interiorSub = normalizeAdminAccess({ role: "sub_admin", scopeType: "department", scopeId: "interior" });
const digitalGradHead = normalizeAdminAccess({ role: "department_admin", scopeType: "department", scopeId: "digital-art", scopeIds: ["digital-art", "graduate"] });
const multiSub = normalizeAdminAccess({ role: "sub_admin", scopeType: "department", scopeId: "interior", scopeIds: ["interior", "graduate", "digital-art"] });

test("Owner legacy được map thành Quản trị hệ thống", () => {
  assert.equal(system.role, "system_admin");
  assert.equal(accessLabel(system), "Quản trị hệ thống");
});

test("legacy Admin và Sub-admin không crash, giữ mapping tương thích", () => {
  assert.deepEqual(normalizeAdminAccess({ role: "admin" }), { role: "high_admin", scopeType: "global", scopeId: "", scopeIds: [], legacy: true });
  assert.equal(normalizeAdminAccess({ role: "subadmin" }).scopeType, "legacy");
});

test("Legacy scopeId đơn được normalize thành scopeIds một phần tử khi đọc", () => {
  const legacy = normalizeAdminAccess({ role: "department_admin", scopeType: "department", scopeId: "interior" });
  assert.deepEqual(legacy.scopeIds, ["interior"]);
  assert.equal(legacy.scopeId, "interior");
  assert.deepEqual(normalizeScopeIds(null, "interior"), ["interior"]);
  assert.deepEqual(normalizeScopeIds([], "graduate"), ["graduate"]);
  assert.deepEqual(normalizeScopeIds([], "khong-hople"), []);
});

test("Multi-scope giữ nguyên thứ tự và loại bỏ trùng lặp", () => {
  assert.deepEqual(normalizeScopeIds(["interior", "graduate", "interior"]), ["interior", "graduate"]);
  assert.deepEqual(normalizeScopeIds(["interior", "unknown-scope"], "graduate"), ["interior"]);
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
  assert.equal(canManageAdmin(high, digitalGradHead), true);
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

test("Trưởng ngành multi-scope quản lý Sub-admin có scopeIds là tập con", () => {
  const subsetSub = normalizeAdminAccess({ role: "sub_admin", scopeType: "department", scopeId: "graduate", scopeIds: ["graduate"] });
  const bothSub = normalizeAdminAccess({ role: "sub_admin", scopeType: "department", scopeId: "digital-art", scopeIds: ["digital-art", "graduate"] });
  const outsideSub = normalizeAdminAccess({ role: "sub_admin", scopeType: "department", scopeId: "digital-art", scopeIds: ["digital-art", "interior"] });
  assert.equal(canManageAdmin(digitalGradHead, subsetSub), true);
  assert.equal(canManageAdmin(digitalGradHead, bothSub), true);
  assert.equal(canManageAdmin(digitalGradHead, outsideSub), false);
  assert.equal(allowedScopeForNewAdmin(digitalGradHead, subsetSub), true);
  assert.equal(allowedScopeForNewAdmin(digitalGradHead, outsideSub), false);
  assert.deepEqual(scopeSubset(["digital-art", "graduate"], ["graduate"]), true);
  assert.deepEqual(scopeSubset(["digital-art"], ["digital-art", "graduate"]), false);
});

test("Sub-admin không có role management UI", () => {
  assert.deepEqual(creatableRoles(facultySub), []);
  assert.deepEqual(creatableRoles(multiSub), []);
});

test("Role và scope combination được validation, multi-scope ghi cả scopeId và scopeIds", () => {
  assert.deepEqual(roleDocument("sub_admin", "faculty", []), { role: "sub_admin", scopeType: "faculty", scopeId: FACULTY_SCOPE_ID });
  assert.throws(() => roleDocument("department_admin", "faculty", []));
  assert.throws(() => roleDocument("sub_admin", "department", ["unknown"]));
  assert.throws(() => roleDocument("department_admin", "department", []));
  assert.deepEqual(roleDocument("department_admin", "department", ["digital-art", "graduate"]), {
    role: "department_admin", scopeType: "department", scopeId: "digital-art", scopeIds: ["digital-art", "graduate"]
  });
  assert.deepEqual(roleDocument("sub_admin", "department", [], "interior"), {
    role: "sub_admin", scopeType: "department", scopeId: "interior", scopeIds: ["interior"]
  });
});

test("Trưởng ngành multi-scope quản lý Event thuộc bất kỳ scope nào của mình", () => {
  assert.equal(canManageResource(digitalGradHead, { scopeType: "department", scopeId: "digital-art", createdByUid: "sub" }, "head"), true);
  assert.equal(canManageResource(digitalGradHead, { scopeType: "department", scopeId: "graduate", createdByUid: "sub" }, "head"), true);
  assert.equal(canManageResource(digitalGradHead, { scopeType: "department", scopeId: "interior", createdByUid: "sub" }, "head"), false);
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
  assert.equal(accessLabel(multiSub), "Sub-admin — Thiết kế Nội thất, Cao học / Thạc sĩ, Nghệ thuật số");
});

test("Cao học / Thạc sĩ là scope canonical, có category riêng", () => {
  assert.equal(departmentCategory("graduate"), "Sau đại học");
  assert.deepEqual(categoryScope("Sau đại học", facultySub), { scopeType: "department", scopeId: "graduate" });
  assert.equal(canCreateCategory(digitalGradHead, "Sau đại học"), true);
  assert.equal(canCreateCategory(digitalGradHead, "Ngành Thiết kế nội thất"), false);
  assert.equal(canManageResource(digitalGradHead, { category: "Sau đại học", createdByUid: "sub" }, "head"), true);
});

test("assignableScopeOptions giới hạn scope của trưởng ngành", () => {
  assert.deepEqual(assignableScopeOptions(digitalGradHead).map((item) => item.id), ["graphic", "industrial", "interior", "fashion", "digital-art", "graduate"].filter((id) => ["digital-art", "graduate"].includes(id)));
  assert.equal(assignableScopeOptions(system).length, 6);
  assert.equal(assignableScopeOptions(interiorSub).length, 0);
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
  assert.match(rules, /canonicalScopeIds/);
  assert.match(rules, /hasOnly\(actorScopeIds\(\)\)/);
  assert.match(storage, /function managesResource/);
  assert.match(storage, /departmentScopeIds/);
});

test("Filter/sort Admin: theo role, theo scope multi, mặc định theo thứ bậc role", () => {
  const entries = [
    { name: "Trần B", access: normalizeAdminAccess({ role: "sub_admin", scopeType: "department", scopeId: "graduate", scopeIds: ["graduate"] }) },
    { name: "Nguyễn A", access: normalizeAdminAccess({ role: "department_admin", scopeType: "department", scopeId: "digital-art", scopeIds: ["digital-art", "graduate"] }) },
    { name: "Lê C", access: normalizeAdminAccess({ role: "sub_admin", scopeType: "department", scopeId: "digital-art", scopeIds: ["interior", "digital-art"] }) },
    { name: "Phạm D", access: normalizeAdminAccess({ role: "faculty_admin", scopeType: "faculty", scopeId: "mtcn" }) }
  ];
  const byRole = filterSortAdmins(entries, {});
  assert.deepEqual(byRole.map((item) => item.name), ["Phạm D", "Nguyễn A", "Lê C", "Trần B"]);
  const graduateFilter = filterSortAdmins(entries, { scopeFilter: "graduate" });
  assert.deepEqual(graduateFilter.map((item) => item.name).sort(), ["Nguyễn A", "Trần B"]);
  const digitalFilter = filterSortAdmins(entries, { scopeFilter: "digital-art" });
  assert.deepEqual(digitalFilter.map((item) => item.name).sort(), ["Lê C", "Nguyễn A"]);
  const roleFilter = filterSortAdmins(entries, { roleFilter: "sub_admin" });
  assert.deepEqual(roleFilter.map((item) => item.name).sort(), ["Lê C", "Trần B"]);
  const byName = filterSortAdmins(entries, { sort: "name" });
  assert.deepEqual(byName.map((item) => item.name), ["Lê C", "Nguyễn A", "Phạm D", "Trần B"]);
});

test("Người cấp quyền hiển thị tên/email, không bao giờ lộ UID thô", () => {
  const profiles = { "uid-name": { name: "Nguyễn Văn A", email: "a@tdtu.edu.vn" }, "uid-email": { name: "", email: "b@tdtu.edu.vn" } };
  const profileOf = (uid) => profiles[uid] || null;
  assert.equal(grantorLabel({ addedByUid: "uid-name", addedByEmail: "a@tdtu.edu.vn" }, profileOf), "Nguyễn Văn A");
  assert.equal(grantorLabel({ addedByUid: "uid-email", addedByEmail: "b@tdtu.edu.vn" }, profileOf), "b@tdtu.edu.vn");
  assert.equal(grantorLabel({ addedByUid: "unknown", addedByEmail: "c@tdtu.edu.vn" }, profileOf), "c@tdtu.edu.vn");
  assert.equal(grantorLabel({ addedByUid: "unknown" }, profileOf), "—");
  assert.equal(grantorLabel({}, profileOf), "—");
});

test("UI admin không render raw UID người cấp quyền và dùng checkbox multi-scope", () => {
  const adminSource = readFileSync("admin/admin.mjs", "utf8");
  assert.doesNotMatch(adminSource, /record\.addedByEmail \|\| record\.addedByUid/);
  assert.match(adminSource, /admin-scope-option/);
  assert.match(adminSource, /loadAdminGrantorProfiles/);
  assert.match(adminSource, /adminRoleFilter/);
  assert.match(adminSource, /adminScopeFilter/);
  const html = readFileSync("admin/index.html", "utf8");
  assert.match(html, /adminDepartmentList/);
  assert.match(html, /adminRoleFilter/);
  assert.match(html, /adminScopeFilter/);
  assert.match(html, /Sau đại học/);
});
