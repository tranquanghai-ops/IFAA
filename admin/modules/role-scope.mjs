export const FACULTY_SCOPE_ID = "mtcn";

export const DEPARTMENTS = Object.freeze([
  { id: "graphic", label: "Thiết kế Đồ họa", category: "Ngành Đồ họa" },
  { id: "industrial", label: "Thiết kế Công nghiệp", category: "Ngành Thiết kế công nghiệp" },
  { id: "interior", label: "Thiết kế Nội thất", category: "Ngành Thiết kế nội thất" },
  { id: "fashion", label: "Thiết kế Thời trang", category: "Ngành Thiết kế thời trang" },
  { id: "digital-art", label: "Nghệ thuật số", category: "Ngành Nghệ thuật số" }
]);

export const ROLE_LABELS = Object.freeze({
  system_admin: "Quản trị hệ thống",
  high_admin: "Admin cấp cao",
  faculty_admin: "Admin Khoa",
  department_admin: "Admin Trưởng ngành",
  sub_admin: "Sub-admin",
  scoped_manager: "Đồng quản lý"
});

const EXTERNAL_CATEGORIES = new Set(["Sự kiện Trường", "Sự kiện Khoa khác"]);
const DEPARTMENT_BY_ID = new Map(DEPARTMENTS.map((item) => [item.id, item]));
const DEPARTMENT_BY_CATEGORY = new Map(DEPARTMENTS.map((item) => [item.category, item]));

export function normalizeAdminAccess(data = {}, { owner = false } = {}) {
  if (owner) return { role: "system_admin", scopeType: "global", scopeId: "", legacy: false };
  const storedRole = String(data.role || "admin");
  if (storedRole === "admin") return { role: "high_admin", scopeType: "global", scopeId: "", legacy: true };
  if (storedRole === "subadmin") return { role: "sub_admin", scopeType: "legacy", scopeId: "", legacy: true };
  const role = ["high_admin", "faculty_admin", "department_admin", "sub_admin"].includes(storedRole) ? storedRole : "";
  const scopeType = role === "high_admin" ? "global" : String(data.scopeType || "");
  const scopeId = scopeType === "faculty" ? FACULTY_SCOPE_ID : scopeType === "department" ? String(data.scopeId || "") : "";
  return { role, scopeType, scopeId, legacy: false };
}

export function validAdminAccess(access) {
  if (access.role === "system_admin" || access.role === "high_admin") return access.scopeType === "global";
  if (access.role === "faculty_admin") return access.scopeType === "faculty" && access.scopeId === FACULTY_SCOPE_ID;
  if (access.role === "department_admin") return access.scopeType === "department" && DEPARTMENT_BY_ID.has(access.scopeId);
  if (access.role === "sub_admin") return (access.scopeType === "faculty" && access.scopeId === FACULTY_SCOPE_ID)
    || (access.scopeType === "department" && DEPARTMENT_BY_ID.has(access.scopeId))
    || access.scopeType === "legacy";
  return false;
}

export function departmentLabel(scopeId) {
  return DEPARTMENT_BY_ID.get(scopeId)?.label || "";
}

export function accessLabel(access) {
  if (!access) return "";
  if (access.role === "sub_admin" && access.scopeType === "faculty") return "Sub-admin Khoa";
  const base = ROLE_LABELS[access.role] || access.role || "";
  if (access.scopeType === "department") return `${base} — ${departmentLabel(access.scopeId) || access.scopeId}`;
  if (access.scopeType === "legacy") return `${base} — phạm vi legacy (chỉ tài nguyên tự tạo)`;
  return base;
}

export function scopeLabel(access) {
  if (access.scopeType === "global") return "Toàn hệ thống";
  if (access.scopeType === "faculty") return "Khoa Mỹ thuật Công nghiệp";
  if (access.scopeType === "department") return departmentLabel(access.scopeId) || access.scopeId;
  if (access.scopeType === "legacy") return "Legacy · chỉ tài nguyên tự tạo";
  return "—";
}

export function creatableRoles(actor) {
  if (actor.role === "system_admin") return ["high_admin", "faculty_admin", "department_admin", "sub_admin"];
  if (actor.role === "high_admin") return ["faculty_admin", "department_admin", "sub_admin"];
  if (actor.role === "faculty_admin" || actor.role === "department_admin") return ["sub_admin"];
  return [];
}

export function canManageAdmin(actor, target) {
  if (!actor || !target || target.role === "system_admin") return false;
  if (actor.role === "system_admin") return true;
  if (actor.role === "high_admin") return ["faculty_admin", "department_admin", "sub_admin"].includes(target.role);
  if (actor.role === "faculty_admin") return target.role === "sub_admin"
    && ((target.scopeType === "faculty" && target.scopeId === FACULTY_SCOPE_ID) || target.scopeType === "department");
  if (actor.role === "department_admin") return target.role === "sub_admin"
    && target.scopeType === "department" && target.scopeId === actor.scopeId;
  return false;
}

export function allowedScopeForNewAdmin(actor, target) {
  if (!validAdminAccess(target) || !canManageAdmin(actor, target)) return false;
  if (actor.role === "department_admin") return target.scopeId === actor.scopeId;
  return target.scopeType !== "legacy";
}

export function categoryScope(category, actor) {
  if (actor?.scopeType === "legacy") return { scopeType: "legacy", scopeId: "" };
  const department = DEPARTMENT_BY_CATEGORY.get(category);
  if (department) return { scopeType: "department", scopeId: department.id };
  if (EXTERNAL_CATEGORIES.has(category)) {
    if (actor?.scopeType === "department") return { scopeType: "department", scopeId: actor.scopeId };
  }
  return { scopeType: "faculty", scopeId: FACULTY_SCOPE_ID };
}

export function resourceScope(resource = {}) {
  if (resource.scopeType) return { scopeType: resource.scopeType, scopeId: resource.scopeId || "" };
  const department = DEPARTMENT_BY_CATEGORY.get(resource.category);
  if (department) return { scopeType: "department", scopeId: department.id, legacy: true };
  return { scopeType: "legacy", scopeId: "", legacy: true };
}

export function canManageResource(actor, resource, uid) {
  if (!actor || !resource) return false;
  if (["system_admin", "high_admin"].includes(actor.role)) return true;
  if (actor.role === "faculty_admin") return true;
  if (actor.role === "sub_admin") return resource.createdByUid === uid;
  if (actor.role === "department_admin") {
    const scope = resourceScope(resource);
    return (scope.scopeType === "department" && scope.scopeId === actor.scopeId)
      || (scope.scopeType === "legacy" && resource.createdByUid === uid);
  }
  return false;
}

export function canCreateCategory(actor, category) {
  if (!actor || actor.role === "scoped_manager") return false;
  if (actor.role === "department_admin" || (actor.role === "sub_admin" && actor.scopeType === "department")) {
    return EXTERNAL_CATEGORIES.has(category) || DEPARTMENT_BY_CATEGORY.get(category)?.id === actor.scopeId;
  }
  return true;
}

export function defaultResourceScope(actor) {
  if (actor?.scopeType === "department") return { scopeType: "department", scopeId: actor.scopeId };
  if (actor?.scopeType === "legacy") return { scopeType: "legacy", scopeId: "" };
  return { scopeType: "faculty", scopeId: FACULTY_SCOPE_ID };
}

export function roleDocument(role, scopeType, scopeId = "") {
  const access = normalizeAdminAccess({ role, scopeType, scopeId });
  if (!validAdminAccess(access) || access.role === "system_admin" || access.scopeType === "legacy") throw Error("Tổ hợp vai trò và phạm vi không hợp lệ.");
  return { role: access.role, scopeType: access.scopeType, scopeId: access.scopeId };
}
