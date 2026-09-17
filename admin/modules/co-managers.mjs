export function normalizeCoManagerUids(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((uid) => typeof uid === "string").map((uid) => uid.trim()).filter(Boolean))];
}

export function isResourceCoManager(resource, uid) {
  return Boolean(uid && normalizeCoManagerUids(resource?.coManagerUids).includes(uid));
}

export function canEditResourceCoManagers(resource, uid, highAdmin = false) {
  return Boolean(highAdmin || (uid && resource?.createdByUid === uid));
}

export function addCoManagerUid(current, uid, ownerUid = "") {
  const normalized = normalizeCoManagerUids(current);
  const candidate = String(uid || "").trim();
  if (!candidate) throw Error("Không tìm thấy tài khoản đồng quản lý.");
  if (candidate === ownerUid) throw Error("Không thể thêm người tạo làm đồng quản lý.");
  if (normalized.includes(candidate)) throw Error("Email này đã là đồng quản lý.");
  if (normalized.length >= 20) throw Error("Mỗi sự kiện chỉ có tối đa 20 đồng quản lý.");
  return [...normalized, candidate];
}

export function inheritedAttendanceCoManagerUids(event, creatorUid = "") {
  return normalizeCoManagerUids(event?.coManagerUids).filter((uid) => uid !== creatorUid);
}
