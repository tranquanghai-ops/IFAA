export const FACULTY_SCOPE_ID = "mtcn";

export const DEPARTMENTS = Object.freeze([
  { id: "graphic", label: "Thiết kế Đồ họa", category: "Ngành Đồ họa" },
  { id: "industrial", label: "Thiết kế Công nghiệp", category: "Ngành Thiết kế công nghiệp" },
  { id: "interior", label: "Thiết kế Nội thất", category: "Ngành Thiết kế nội thất" },
  { id: "fashion", label: "Thiết kế Thời trang", category: "Ngành Thiết kế thời trang" },
  { id: "digital-art", label: "Nghệ thuật số", category: "Ngành Nghệ thuật số" },
  { id: "graduate", label: "Cao học / Thạc sĩ", category: "Sau đại học" }
]);

export const ROLE_LABELS = Object.freeze({
  system_admin: "Quản trị hệ thống",
  high_admin: "Admin cấp cao",
  faculty_admin: "Admin Khoa",
  department_admin: "Admin Trưởng ngành",
  sub_admin: "Sub-admin",
  scoped_manager: "Đồng quản lý"
});

export const ROLE_ORDER = Object.freeze(["system_admin", "high_admin", "faculty_admin", "department_admin", "sub_admin", "scoped_manager"]);

const EXTERNAL_CATEGORIES = new Set(["Sự kiện Trường", "Sự kiện Khoa khác"]);
const DEPARTMENT_BY_ID = new Map(DEPARTMENTS.map((item) => [item.id, item]));
const DEPARTMENT_BY_CATEGORY = new Map(DEPARTMENTS.map((item) => [item.category, item]));

// Chuẩn hóa danh sách scope: bỏ trùng, bỏ scope không nằm trong danh mục canonical.
// Bản ghi legacy chỉ có scopeId được normalize thành danh sách một phần tử khi đọc.
export function normalizeScopeIds(rawList, legacyScopeId = "") {
  const raw = Array.isArray(rawList) ? rawList : [];
  const ids = [...new Set(raw.map((value) => String(value || "").trim()).filter((value) => DEPARTMENT_BY_ID.has(value)))];
  if (ids.length) return ids;
  const legacy = String(legacyScopeId || "").trim();
  return DEPARTMENT_BY_ID.has(legacy) ? [legacy] : [];
}

export function normalizeAdminAccess(data = {}, { owner = false } = {}) {
  if (owner) return { role: "system_admin", scopeType: "global", scopeId: "", scopeIds: [], legacy: false };
  const storedRole = String(data.role || "admin");
  if (storedRole === "admin") return { role: "high_admin", scopeType: "global", scopeId: "", scopeIds: [], legacy: true };
  if (storedRole === "subadmin") return { role: "sub_admin", scopeType: "legacy", scopeId: "", scopeIds: [], legacy: true };
  const role = ["high_admin", "faculty_admin", "department_admin", "sub_admin"].includes(storedRole) ? storedRole : "";
  const scopeType = role === "high_admin" ? "global" : String(data.scopeType || "");
  const scopeIds = scopeType === "department" ? normalizeScopeIds(data.scopeIds, String(data.scopeId || "")) : [];
  const scopeId = scopeType === "faculty" ? FACULTY_SCOPE_ID : scopeType === "department" ? (scopeIds[0] || "") : "";
  return { role, scopeType, scopeId, scopeIds, legacy: false };
}

export function validAdminAccess(access) {
  if (access.role === "system_admin" || access.role === "high_admin") return access.scopeType === "global";
  if (access.role === "faculty_admin") return access.scopeType === "faculty" && access.scopeId === FACULTY_SCOPE_ID;
  if (access.role === "department_admin") return access.scopeType === "department" && access.scopeIds.length > 0;
  if (access.role === "sub_admin") return (access.scopeType === "faculty" && access.scopeId === FACULTY_SCOPE_ID)
    || (access.scopeType === "department" && access.scopeIds.length > 0)
    || access.scopeType === "legacy";
  return false;
}

export function departmentLabel(scopeId) {
  return DEPARTMENT_BY_ID.get(scopeId)?.label || "";
}

export function departmentCategory(scopeId) {
  return DEPARTMENT_BY_ID.get(scopeId)?.category || "";
}

export function scopeLabels(access) {
  if (!access) return [];
  if (access.scopeType === "global") return ["Toàn hệ thống"];
  if (access.scopeType === "faculty") return ["Khoa Mỹ thuật Công nghiệp"];
  if (access.scopeType === "department") return access.scopeIds.map((scopeId) => departmentLabel(scopeId) || scopeId);
  if (access.scopeType === "legacy") return ["Legacy · chỉ tài nguyên tự tạo"];
  return [];
}

export function accessLabel(access) {
  if (!access) return "";
  if (access.role === "sub_admin" && access.scopeType === "faculty") return "Sub-admin Khoa";
  const base = ROLE_LABELS[access.role] || access.role || "";
  const labels = scopeLabels(access);
  if (access.scopeType === "department") return labels.length > 1 ? `${base} — ${labels.join(", ")}` : `${base} — ${labels[0] || access.scopeId}`;
  if (access.scopeType === "legacy") return `${base} — phạm vi legacy (chỉ tài nguyên tự tạo)`;
  return base;
}

export function scopeLabel(access) {
  return scopeLabels(access).join(" · ") || "—";
}

export function scopeSubset(managerScopeIds, targetScopeIds) {
  const managed = new Set(managerScopeIds || []);
  return (targetScopeIds || []).every((scopeId) => managed.has(scopeId));
}

export function creatableRoles(actor) {
  if (actor.role === "system_admin") return ["high_admin", "faculty_admin", "department_admin", "sub_admin"];
  if (actor.role === "high_admin") return ["faculty_admin", "department_admin", "sub_admin"];
  if (actor.role === "faculty_admin" || actor.role === "department_admin") return ["sub_admin"];
  return [];
}

// Trưởng ngành chỉ quản lý Sub-admin có scopeIds là tập con của scopeIds mình.
export function canManageAdmin(actor, target) {
  if (!actor || !target || target.role === "system_admin") return false;
  if (actor.role === "system_admin") return true;
  if (actor.role === "high_admin") return ["faculty_admin", "department_admin", "sub_admin"].includes(target.role);
  if (actor.role === "faculty_admin") return target.role === "sub_admin"
    && ((target.scopeType === "faculty" && target.scopeId === FACULTY_SCOPE_ID) || target.scopeType === "department");
  if (actor.role === "department_admin") return target.role === "sub_admin"
    && target.scopeType === "department" && scopeSubset(actor.scopeIds, target.scopeIds);
  return false;
}

export function allowedScopeForNewAdmin(actor, target) {
  if (!validAdminAccess(target) || !canManageAdmin(actor, target)) return false;
  if (actor.role === "department_admin") return scopeSubset(actor.scopeIds, target.scopeIds);
  return target.scopeType !== "legacy";
}

// Danh sách scope canonical mà actor được phép gán cho tài khoản mới/sửa.
export function assignableScopeOptions(actor) {
  if (!actor) return [];
  if (actor.role === "department_admin") return DEPARTMENTS.filter((item) => actor.scopeIds.includes(item.id));
  if (["system_admin", "high_admin", "faculty_admin"].includes(actor.role)) return [...DEPARTMENTS];
  return [];
}

export function categoryScope(category, actor) {
  if (actor?.scopeType === "legacy") return { scopeType: "legacy", scopeId: "" };
  const department = DEPARTMENT_BY_CATEGORY.get(category);
  if (department) return { scopeType: "department", scopeId: department.id };
  if (EXTERNAL_CATEGORIES.has(category)) {
    if (actor?.scopeType === "department") return { scopeType: "department", scopeId: actor.scopeIds[0] || actor.scopeId };
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
    return (scope.scopeType === "department" && actor.scopeIds.includes(scope.scopeId))
      || (scope.scopeType === "legacy" && resource.createdByUid === uid);
  }
  return false;
}

export function canCreateCategory(actor, category) {
  if (!actor || actor.role === "scoped_manager") return false;
  if (actor.role === "department_admin" || (actor.role === "sub_admin" && actor.scopeType === "department")) {
    return EXTERNAL_CATEGORIES.has(category) || actor.scopeIds.includes(DEPARTMENT_BY_CATEGORY.get(category)?.id);
  }
  return true;
}

export function defaultResourceScope(actor) {
  if (actor?.scopeType === "department") return { scopeType: "department", scopeId: actor.scopeIds[0] || actor.scopeId };
  if (actor?.scopeType === "legacy") return { scopeType: "legacy", scopeId: "" };
  return { scopeType: "faculty", scopeId: FACULTY_SCOPE_ID };
}

export function roleDocument(role, scopeType, scopeIds = [], legacyScopeId = "") {
  const list = normalizeScopeIds(scopeIds, legacyScopeId);
  const access = normalizeAdminAccess({ role, scopeType, scopeIds: list, scopeId: list[0] || "" });
  if (!validAdminAccess(access) || access.role === "system_admin" || access.scopeType === "legacy") throw Error("Tổ hợp vai trò và phạm vi không hợp lệ.");
  if (access.scopeType === "department") {
    // scopeId (phần tử đầu) được lưu kèm để truy vấn/hiển thị tương thích dữ liệu cũ.
    return { role: access.role, scopeType: access.scopeType, scopeId: access.scopeIds[0], scopeIds: [...access.scopeIds] };
  }
  return { role: access.role, scopeType: access.scopeType, scopeId: access.scopeId };
}

export function adminMatchesScopeFilter(access, scopeFilter) {
  if (!access) return false;
  if (scopeFilter === "all") return true;
  if (scopeFilter === "global") return access.scopeType === "global";
  if (scopeFilter === "faculty") return access.scopeType === "faculty";
  return access.scopeType === "department" && access.scopeIds.includes(scopeFilter);
}

export function adminRoleSortKey(role) {
  const index = ROLE_ORDER.indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

// Lọc và sắp xếp danh sách Admin: mặc định theo thứ bậc vai trò rồi tên A-Z.
export function filterSortAdmins(entries, { roleFilter = "all", scopeFilter = "all", sort = "default" } = {}) {
  const rows = entries.filter((entry) => (roleFilter === "all" || entry.access?.role === roleFilter)
    && adminMatchesScopeFilter(entry.access, scopeFilter));
  const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "vi");
  return rows.sort(sort === "name"
    ? byName
    : (a, b) => adminRoleSortKey(a.access?.role) - adminRoleSortKey(b.access?.role) || byName(a, b));
}

// Hiển thị "Người cấp quyền": ưu tiên displayName, rồi email; không bao giờ lộ UID thô.
export function grantorLabel(record, profileOf = () => null) {
  if (!record) return "—";
  const profile = record.addedByUid ? profileOf(record.addedByUid) : null;
  return profile?.name || profile?.displayName || record.addedByEmail || profile?.email || "—";
}
