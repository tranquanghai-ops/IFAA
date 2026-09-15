import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocFromServer, getDocs, getCountFromServer, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, startAfter, serverTimestamp, Timestamp, runTransaction, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { getStorage, ref, getBytes, getDownloadURL, getMetadata, uploadBytes, deleteObject } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";
import { firebaseConfig, OWNER_EMAIL } from "../firebase-config.mjs";
import { activeAttendanceSessionById, activeAttendanceSessionForEvent, activeAttendanceSessions, countdown } from "../attendance-link.mjs";
import { loadFacultyDataset, publishFacultyDataset } from "../faculty-dataset.mjs";
import { createAdminEventService } from "./modules/events/event-service.mjs?v=4";
import { createEventAttachmentService } from "./modules/events/event-attachment-service.mjs?v=1";
import { createAdminExportService } from "./modules/exports/export-service.mjs?v=2";
import { createAdminGroupService } from "./modules/groups/group-service.mjs";
import { createAdminRegistrationService } from "./modules/registrations/registration-service.mjs?v=2";
import { createAdminStudentService } from "./modules/students/student-service.mjs?v=2";

const DEFAULT_FACULTY = "Khoa Mỹ thuật Công nghiệp";
const DEFAULT_PUBLIC_BASE_URL = "https://ifa.tdtu.edu.vn/dang-ky-su-kien";
const DEFAULT_ATTENDANCE_BASE_URL = "https://ifa.tdtu.edu.vn/check-in";
const EXTERNAL_CATEGORIES = new Set(["Sự kiện Trường", "Sự kiện Khoa khác"]);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const $ = (selector) => document.querySelector(selector);
const safe = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const ts = (value) => value?.toDate ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(value.toDate()) : "";
const millis = (value) => value?.toDate ? value.toDate().getTime() : (value ? new Date(value).getTime() : null);
const vietnamDate = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || "");
};

const parseVietnamDate = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  let year, month, day;
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) [, year, month, day] = match;
  else {
    match = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    if (!match) return "";
    [, day, month, year] = match;
  }
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

document.querySelectorAll(".date-vn").forEach((input) => input.addEventListener("blur", () => {
  const iso = parseVietnamDate(input.value);
  if (iso) input.value = vietnamDate(iso);
}));

function confirmAction({ title, message, verification = "", confirmLabel = "Xác nhận" }) {
  return new Promise((resolve) => {
    const dialog = $("#confirmDialog");
    const form = $("#confirmActionForm");
    const field = $("#confirmVerificationField");
    const input = $("#confirmVerificationInput");
    const submit = $("#confirmActionSubmit");
    let settled = false;

    $("#confirmActionTitle").textContent = title;
    $("#confirmActionMessage").textContent = message;
    submit.textContent = confirmLabel;
    field.classList.toggle("hidden", !verification);
    input.value = "";
    submit.disabled = Boolean(verification);

    const normalizeVerification = (value) => String(value || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/Đ/g, "D");
    const validate = () => {
      submit.disabled = Boolean(verification) && normalizeVerification(input.value) !== normalizeVerification(verification);
    };
    const finish = (approved) => {
      if (settled) return;
      settled = true;
      input.removeEventListener("input", validate);
      dialog.removeEventListener("cancel", cancel);
      if (dialog.open) dialog.close();
      resolve(approved);
    };
    const cancel = (event) => {
      event.preventDefault();
      finish(false);
    };

    input.addEventListener("input", validate);
    dialog.addEventListener("cancel", cancel);
    $("#confirmActionCancel").onclick = () => finish(false);
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!submit.disabled) finish(true);
    };
    dialog.showModal();
    if (verification) setTimeout(() => input.focus(), 0);
  });
}

let user = null;
let isOwner = false;
let currentRole = "admin";
let isSubAdmin = false;
let events = [];
let attendanceSessions = [];
let attendanceFilter = "all";
let attendanceView = localStorage.getItem("ifaa-attendance-view") === "list" ? "list" : "cards";
let attendanceCheckinCounts = new Map();
let attendanceScannerCounts = new Map();
let attendanceSummaryLoading = false;
let pendingAdminEditId = new URLSearchParams(window.location.search).get("edit") || "";
let selectedAttendanceSession = null;
let attendanceRoster = [];
let attendanceManageRows = [], attendancePage = 1, attendancePageSize = 10;
let attendancePageCursors = [null], attendancePageHasNext = false, attendanceTotalCount = 0;
let attendanceReportPage = 1, attendanceReportPageSize = 10, attendanceReportFilter = "present";
let attendanceReportLoaded = false, attendanceReportRowsSource = [], attendanceTrashLoaded = false;
let attendanceViewerScale = 1, attendanceViewerObjectUrl = "", attendanceViewerCheckinId = "";
let attendanceRosterImport = [];
let attendancePermissionMembers = [];
let favoriteScannerStudents = [];
let attendanceExpiryTimer = 0;
let attendanceRosterUnsubscribe = null;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const purgingEventIds = new Set();
const purgingGroupIds = new Set();
let admins = [];
let groups = [];
const trashSelection = { events: new Set(), attendance: new Set(), groups: new Set() };
const trashBulkBusy = { events: false, attendance: false, groups: false };

const {
  bindGroupControls,
  groupCode,
  groupPosition,
  handleGroupClick,
  permanentlyDeleteGroup,
  refreshGroupOptions,
  renderGroups,
  setLimitInputState,
  subscribeGroups
} = createAdminGroupService({
  db,
  select: $,
  safe,
  toMillis: millis,
  getGroups: () => groups,
  setGroups: (value) => { groups = value; },
  getEvents: () => events,
  getUser: () => user,
  getIsOwner: () => isOwner,
  getIsSubAdmin: () => isSubAdmin,
  getTrashSelection: () => trashSelection,
  shareCode,
  configuredPublicBaseUrl,
  copyText,
  notice,
  confirmAction,
  trashRetentionMs: TRASH_RETENTION_MS,
  getEventState: () => eventState,
  getCalendarRange: () => calendarRange,
  getCalendarStamp: () => calendarStamp,
  getPermanentlyDeleteEvent: () => permanentlyDeleteEvent,
  deleteCachedExport: (...args) => deleteCachedExport(...args),
  getFetchRegistrations: () => fetchRegistrations,
  getDownloadRegistrationExcel: () => downloadRegistrationExcel,
  onRender: () => render(),
  onGroupsUpdated: () => { if (isOwner) void cleanupExpiredTrash(); }
});

const {
  bindControls: bindEventAttachmentControls,
  cleanupEventAttachments,
  finalizeSave: finalizeAttachmentSave,
  openEvent: openEventAttachments,
  prepareSave: prepareAttachmentSave,
  rollbackSave: rollbackAttachmentSave
} = createEventAttachmentService({ storage, select: $, safe, notice });

const {
  bindRegistrationFormControls,
  calendarRange,
  calendarStamp,
  createEventLink,
  dayPeriod,
  eventPastAttendanceGrace,
  eventPosition,
  eventShareUrl,
  eventState,
  isExternalEvent,
  moveEvent,
  openEvent,
  openGoogleCalendar,
  permanentlyDeleteEvent,
  prepareEventData,
  purgeEvent,
  renderEvents,
  restoreEvent,
  setCapacityState,
  setCloseModeState,
  setEventView,
  setStatusFilter: setEventStatusFilter,
  subscribeEvents,
  syncEventVisibilityOptions,
  toggleExternalEventFields,
  trashEvent,
  updateEventCountdowns
} = createAdminEventService({
  db,
  select: $,
  safe,
  toMillis: millis,
  formatTimestamp: ts,
  formatVietnamDate: vietnamDate,
  parseVietnamDate,
  getEvents: () => events,
  setEvents: (value) => { events = value; },
  getGroups: () => groups,
  getAttendanceSessions: () => attendanceSessions,
  getUser: () => user,
  getIsOwner: () => isOwner,
  getIsSubAdmin: () => isSubAdmin,
  getTrashSelection: () => trashSelection,
  defaultFaculty: DEFAULT_FACULTY,
  externalCategories: EXTERNAL_CATEGORIES,
  trashRetentionMs: TRASH_RETENTION_MS,
  shareCode,
  groupCode,
  groupPosition,
  configuredPublicBaseUrl,
  confirmAction,
  notice,
  copyText,
  refreshGroupOptions,
  setLimitInputState,
  renderEventFaculties,
  fetchRegistrations: (...args) => fetchRegistrations(...args),
  removeRegistration: (...args) => removeRegistration(...args),
  deleteCachedExport: (...args) => deleteCachedExport(...args),
  openEventAttachments,
  cleanupEventAttachments,
  onRender: () => render()
});

const {
  fetchRegistrations,
  findLoadedRegistration,
  loadQuickRegistrationPage,
  loadRegistrationPage,
  openRegistrationDetailById,
  openQuickRegistrations,
  refreshRegistrationFilters,
  removeRegistration,
  renderRegistrations: renderRegs,
  resetRegistrationPage,
  resetSelectedEventRegistrations,
  setPageSize: setRegistrationPageSize,
  syncStatusFilters: syncRegistrationStatusFilters
} = createAdminRegistrationService({
  db,
  select: $,
  safe,
  formatTimestamp: ts,
  toMillis: millis,
  formatVietnamDate: vietnamDate,
  getEvents: () => events,
  getGroups: () => groups,
  eventState,
  eventPosition,
  groupPosition,
  isExternalEvent,
  notice,
  confirmAction
});

const {
  deleteCachedExport,
  downloadRegistrationExcel,
  downloadWorkbook,
  quickExportAttendance
} = createAdminExportService({
  db,
  storage,
  canUseStorageCache: highAdminAccess,
  getEvents: () => events,
  getGroups: () => groups,
  getAttendanceSessions: () => attendanceSessions,
  fetchRegistrations,
  notice,
  formatTimestamp: ts,
  toMillis: millis,
  formatVietnamDate: vietnamDate,
  dayPeriod,
  shareCode
});

const {
  bindStudentControls,
  getFacultyStudentDatasetMeta,
  getFacultyStudents,
  loadFacultyStudentMeta,
  normalizeSearch,
  resolveFacultyStudent,
  studentRecord,
  validStudentId
} = createAdminStudentService({
  db,
  storage,
  select: $,
  safe,
  getUser: () => user,
  hasHighAdminAccess: highAdminAccess,
  notice,
  confirmAction,
  normalizeAttendanceHeader,
  loadFacultyDataset,
  publishFacultyDataset,
  downloadWorkbook
});

bindStudentControls();
bindGroupControls();
bindRegistrationFormControls();
bindEventAttachmentControls();

async function audit(action, targetType, targetId, details = {}) {
  try {
    await addDoc(collection(db, "auditLogs"), { action, targetType, targetId: String(targetId || ""), details, actorUid: user.uid, actorEmail: user.email.toLowerCase(), actorName: user.displayName || user.email, actorRole: currentRole, createdAt: serverTimestamp() });
  } catch (error) { console.warn("Không thể ghi nhật ký quản trị:", error); }
}

function setSystemStatus(selector, text, ok = true) {
  const element = $(selector); if (!element) return;
  element.textContent = text; element.classList.toggle("status-error", !ok);
}

async function loadSystemStatus() {
  const button = $("#systemStatusRefresh"); if (button) button.disabled = true;
  setSystemStatus("#systemAuthStatus", user?.emailVerified ? "Hoạt động" : "Chưa xác thực", !!user?.emailVerified);
  $("#systemStorageCard")?.classList.toggle("hidden", isSubAdmin);
  $("#systemDatasetCard")?.classList.toggle("hidden", isSubAdmin);
  const results = await Promise.allSettled([
    getDocFromServer(doc(db, "settings", "main")),
    isSubAdmin ? Promise.resolve(null) : getMetadata(ref(storage, "datasets/faculty-students.json.gz"))
  ]);
  const storageMissingDataset = results[1].status === "rejected" && results[1].reason?.code === "storage/object-not-found";
  const storageReachable = results[1].status === "fulfilled" || storageMissingDataset;
  setSystemStatus("#systemFirestoreStatus", results[0].status === "fulfilled" ? "Kết nối tốt" : "Không truy cập được", results[0].status === "fulfilled");
  if (!isSubAdmin) {
    setSystemStatus("#systemStorageStatus", storageReachable ? "Kết nối tốt" : "Không truy cập được", storageReachable);
    setSystemStatus("#systemDatasetStatus", results[1].status === "fulfilled" ? `${Math.ceil(Number(results[1].value.size || 0) / 1024)} KB · sẵn sàng` : "Chưa có tệp nén", results[1].status === "fulfilled");
  }
  $("#systemStatusCheckedAt").textContent = `Kiểm tra lúc ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date())}`;
  if (button) button.disabled = false;
}

async function loadAuditLogs() {
  if (!highAdminAccess()) return;
  const button = $("#auditLogLoad"); button.disabled = true;
  try {
    const snapshot = await getDocs(query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(50)));
    const labels = { "event.create": "Tạo sự kiện", "event.update": "Sửa sự kiện", "attendance.create": "Tạo điểm danh", "attendance.update": "Sửa điểm danh", "attendance.end": "Kết thúc điểm danh", "attendance.finalize": "Chốt danh sách", "attendance.reopen": "Mở lại điểm danh", "attendance.trash": "Đưa điểm danh vào thùng rác", "attendance.purge": "Xóa vĩnh viễn điểm danh", "scanner.grant": "Cấp quyền quét", "scanner.remove": "Thu hồi quyền quét", "checkin.trash": "Xóa lượt điểm danh", "checkin.restore": "Khôi phục lượt điểm danh", "checkin.purge": "Xóa vĩnh viễn lượt", "checkin.trash_all": "Xóa toàn bộ lượt", "checkin.purge_all": "Dọn thùng rác lượt" };
    $("#auditLogRows").innerHTML = snapshot.docs.map((item) => { const data = item.data(); return `<tr><td>${safe(ts(data.createdAt) || "Đang đồng bộ")}</td><td>${safe(data.actorName || data.actorEmail || "")}</td><td>${safe(labels[data.action] || data.action)}</td><td>${safe(data.details?.title || data.details?.mssv || data.targetId || "")}</td></tr>`; }).join("") || '<tr><td colspan="4" class="empty">Chưa có thao tác nào được ghi nhận.</td></tr>';
  } catch (error) { notice("Không thể tải nhật ký: " + error.message, "error"); }
  finally { button.disabled = false; }
}

async function deleteAttendancePhoto(item) {
  if (!item?.photoPath) return;
  try { await deleteObject(ref(storage, item.photoPath)); } catch (error) { if (error?.code !== "storage/object-not-found") throw error; }
}

async function migrateLegacyAttendancePhotos(rows) {
  for (const item of rows.filter((row) => row.photoData && !row.photoPath)) {
    try {
      const response = await fetch(item.photoData), blob = await response.blob();
      if (!blob.type.startsWith("image/") || blob.size > 1.5 * 1024 * 1024) continue;
      const path = `attendance/${item.sessionId}/${item.id}.jpg`;
      const uploaded = await uploadBytes(ref(storage, path), blob, { contentType: "image/jpeg", cacheControl: "private,max-age=0,no-store" });
      const photoUrl = await getDownloadURL(uploaded.ref);
      await updateDoc(doc(db, "checkins", item.id), { photoPath: path, photoUrl, photoData: deleteField(), photoMigratedAt: serverTimestamp() });
      item.photoPath = path; item.photoUrl = photoUrl; delete item.photoData;
    } catch (error) { console.warn("Không thể chuyển ảnh cũ sang Storage:", item.id, error); }
  }
}
let settings = { faculties: [DEFAULT_FACULTY], publicBaseUrl: DEFAULT_PUBLIC_BASE_URL, attendancePublicBaseUrl: DEFAULT_ATTENDANCE_BASE_URL };

function shareCode(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).toUpperCase();
}

function configuredPublicBaseUrl() {
  const value = String(settings.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL).trim();
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return new URL(DEFAULT_PUBLIC_BASE_URL);
  }
}

function configuredAttendanceBaseUrl() {
  const value = String(settings.attendancePublicBaseUrl || DEFAULT_ATTENDANCE_BASE_URL).trim();
  try {
    const url = new URL(value);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return new URL(`${DEFAULT_ATTENDANCE_BASE_URL.replace(/\/+$/, "")}/`);
  }
}

function attendanceShareUrl(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) throw new Error("Phiên điểm danh chưa có mã để tạo liên kết.");
  const url = configuredAttendanceBaseUrl();
  // Dùng duy nhất tham số `e`, giống link đăng ký sự kiện.
  url.search = `?e=${encodeURIComponent(normalizedSessionId)}`;
  const link = url.toString();
  if (new URL(link).searchParams.get("e") !== normalizedSessionId) {
    throw new Error("Không thể tạo liên kết điểm danh có mã sự kiện.");
  }
  return link;
}

async function copyAttendanceLink(sessionId) {
  try {
    const link = attendanceShareUrl(sessionId);
    await copyText(link, `Đã sao chép link điểm danh: ${link}`);
  } catch (error) {
    notice(error.message || "Không thể sao chép link điểm danh.", "error");
  }
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) return notice("Không thể sao chép tự động. Vui lòng thử lại.", "error");
  }
  notice(successMessage, "success");
}

function requestAdminText({ title, message = "", value = "", placeholder = "" }) {
  const dialog = $("#adminTextDialog");
  const form = $("#adminTextForm");
  const input = $("#adminTextInput");
  $("#adminTextTitle").textContent = title;
  $("#adminTextMessage").textContent = message;
  input.value = value;
  input.placeholder = placeholder;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      dialog.oncancel = null;
      form.onsubmit = null;
      $("#adminTextCancel").onclick = null;
      if (dialog.open) dialog.close();
      resolve(result);
    };
    $("#adminTextCancel").onclick = () => finish("");
    dialog.oncancel = (event) => { event.preventDefault(); finish(""); };
    form.onsubmit = (event) => { event.preventDefault(); finish(input.value.trim()); };
    dialog.showModal();
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

function notice(message, type = "") {
  const element = $("#adminNotice");
  element.textContent = message;
  element.className = `notice ${type}`;
  if (element.showPopover) { element.setAttribute("popover", "manual"); try { element.showPopover(); } catch {} }
  element.classList.remove("hidden");
  setTimeout(() => { element.classList.add("hidden"); try { element.hidePopover?.(); } catch {} }, 5000);
}

async function accessRole(currentUser) {
  if (currentUser.email.toLowerCase() === OWNER_EMAIL) return "owner";
  const snapshot = await getDoc(doc(db, "admins", currentUser.email.toLowerCase()));
  if (!snapshot.exists()) return "";
  return snapshot.data().role === "subadmin" ? "subadmin" : "admin";
}

async function syncStorageAdminAccess(currentUser, role) {
  if (role === "owner") return;
  await setDoc(doc(db, "storageAdminAccess", currentUser.uid), {
    uid: currentUser.uid,
    email: currentUser.email.toLowerCase(),
    role: role === "subadmin" ? "subadmin" : "admin",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function clearStorageAdminAccess(email) {
  if (!isOwner) return;
  const snapshot = await getDocs(query(collection(db, "storageAdminAccess"), where("email", "==", String(email).toLowerCase())));
  await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
}

function showPane(name) {
  if (name === "trash" && !highAdminAccess()) name = "events";
  if (name === "students" && !highAdminAccess()) name = "attendance";
  document.querySelectorAll(".nav-btn").forEach((item) => item.classList.toggle("active", item.dataset.pane === name));
  document.querySelectorAll(".pane").forEach((item) => item.classList.toggle("hidden", item.dataset.paneId !== name));
  if (name === "attendance") renderAttendance();
  closeMobileMenu();
}

function normalizeAttendanceSession(snapshotDoc) {
  const data = snapshotDoc.data() || {};
  return { ...data, id: snapshotDoc.id, status: data.status || "open", title: data.title || "Điểm danh sự kiện", eventId: data.eventId || "", date: data.date || "" };
}

function setMobileMenu(open) {
  document.body.classList.toggle("admin-menu-open", Boolean(open));
  $("#mobileMenuBtn")?.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeMobileMenu() { setMobileMenu(false); }

$("#mobileMenuBtn")?.addEventListener("click", () => setMobileMenu(!document.body.classList.contains("admin-menu-open")));
$("#mobileMenuClose")?.addEventListener("click", closeMobileMenu);
$("#mobileMenuBackdrop")?.addEventListener("click", closeMobileMenu);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMobileMenu(); });

function trashItems(kind) {
  if (kind === "events") return events.filter((item) => item.deletedAt);
  if (kind === "attendance") return attendanceSessions.filter((item) => item.deletedAt);
  return groups.filter((item) => item.deletedAt);
}

function canBulkPurge(kind) {
  return kind === "attendance" ? highAdminAccess() : isOwner;
}

function syncTrashBulkUi() {
  for (const kind of ["events", "attendance", "groups"]) {
    const ids = new Set(trashItems(kind).map((item) => item.id));
    for (const id of trashSelection[kind]) if (!ids.has(id)) trashSelection[kind].delete(id);
    const selected = trashSelection[kind].size;
    const button = $(kind === "events" ? "#purgeEventsSelected" : kind === "attendance" ? "#purgeAttendanceSelected" : "#purgeGroupsSelected");
    if (button) {
      button.textContent = `Xóa vĩnh viễn đã chọn (${selected})`;
      button.disabled = !canBulkPurge(kind) || !selected || trashBulkBusy[kind];
      button.classList.toggle("hidden", !canBulkPurge(kind));
    }
    const all = document.querySelector(`[data-trash-select-all="${kind}"]`);
    if (all) {
      all.checked = ids.size > 0 && selected === ids.size;
      all.indeterminate = selected > 0 && selected < ids.size;
      all.disabled = !canBulkPurge(kind) || !ids.size;
    }
  }
}

async function purgeSelectedTrash(kind) {
  if (!canBulkPurge(kind) || trashBulkBusy[kind]) return;
  const selected = trashItems(kind).filter((item) => trashSelection[kind].has(item.id));
  if (!selected.length) return;
  const labels = { events: "sự kiện", attendance: "phiên điểm danh", groups: "nhóm sự kiện" };
  const approved = await confirmAction({ title: `Xóa vĩnh viễn ${selected.length} ${labels[kind]}?`, message: `Dữ liệu sau khi xóa không thể khôi phục. Nhập XÓA một lần để xóa ${selected.length} mục.`, verification: "XÓA" });
  if (!approved) return;
  trashBulkBusy[kind] = true;
  syncTrashBulkUi();
  let succeeded = 0;
  const failed = [];
  for (const item of selected) {
    try {
      if (kind === "events") await permanentlyDeleteEvent(item);
      else if (kind === "attendance") await permanentlyDeleteAttendance(item);
      else await permanentlyDeleteGroup(item);
      trashSelection[kind].delete(item.id);
      succeeded += 1;
    } catch (error) { failed.push({ item, error }); }
  }
  trashBulkBusy[kind] = false;
  render();
  notice(failed.length ? `Đã xóa ${succeeded}/${selected.length} mục. ${failed.length} mục không thể xóa.` : `Đã xóa vĩnh viễn ${succeeded} mục.`, failed.length ? "error" : "success");
}

document.addEventListener("change", (event) => {
  const item = event.target.closest("[data-trash-select]");
  if (item) {
    const kind = item.dataset.trashSelect;
    if (!canBulkPurge(kind)) { item.checked = false; return; }
    item.checked ? trashSelection[kind].add(item.value) : trashSelection[kind].delete(item.value);
    syncTrashBulkUi();
    return;
  }
  const all = event.target.closest("[data-trash-select-all]");
  if (!all || !canBulkPurge(all.dataset.trashSelectAll)) return;
  const kind = all.dataset.trashSelectAll;
  trashSelection[kind] = all.checked ? new Set(trashItems(kind).map((item) => item.id)) : new Set();
  render();
});

$("#purgeEventsSelected").onclick = () => purgeSelectedTrash("events");
$("#purgeAttendanceSelected").onclick = () => purgeSelectedTrash("attendance");
$("#purgeGroupsSelected").onclick = () => purgeSelectedTrash("groups");

function render() {
  const { activeEvents, orderedGroups } = renderEvents();
  renderGroups({ activeEvents, orderedGroups });

  if ($("#trashAttendanceRows")) {
    const trashedAttendance = attendanceSessions.filter((item) => item.deletedAt);
    $("#trashAttendanceRows").innerHTML = highAdminAccess() && trashedAttendance.length ? trashedAttendance.map((item) => { const deletedTime = millis(item.deletedAt), purgeTime = deletedTime ? deletedTime + TRASH_RETENTION_MS : 0; return `<tr><td><input type="checkbox" data-trash-select="attendance" value="${item.id}" ${trashSelection.attendance.has(item.id) ? "checked" : ""} aria-label="Chọn ${safe(item.title)}"></td><td><b>${safe(item.title)}</b></td><td>${safe(vietnamDate(item.date))}</td><td>${deletedTime ? ts(item.deletedAt) : "—"}</td><td>${purgeTime ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short" }).format(new Date(purgeTime)) : "—"}</td><td><button class="btn btn-small btn-restore" data-restore-attendance="${item.id}">↶ Khôi phục</button> <button class="btn btn-small btn-danger" data-purge-attendance="${item.id}">Xóa vĩnh viễn</button></td></tr>`; }).join("") : '<tr><td colspan="6" class="empty">Không có phiên điểm danh trong thùng rác.</td></tr>';
  }
  refreshRegistrationFilters();
  renderRegs();
  if (isOwner) $("#adminRows").innerHTML = admins.map((admin) => `<tr><td>${safe(admin.name || "")}</td><td>${safe(admin.email)}</td><td><select class="admin-role-select" data-admin-role="${safe(admin.email)}"><option value="admin" ${(admin.role || "admin") === "admin" ? "selected" : ""}>Admin</option><option value="subadmin" ${admin.role === "subadmin" ? "selected" : ""}>Sub-admin</option></select></td><td>${ts(admin.addedAt)}</td><td><button class="btn btn-small btn-danger" data-remove-admin="${safe(admin.email)}">Xóa</button></td></tr>`).join("");
  syncTrashBulkUi();
}

function updateAdminCountdowns() {
  updateEventCountdowns();
  updateAttendanceCountdowns();
}

setInterval(updateAdminCountdowns, 1000);

function renderFacultySettings() {
  const faculties = settings.faculties || [DEFAULT_FACULTY];
  $("#facultySettingsList").innerHTML = faculties.map((faculty) => `<span class="check-chip"><span>${safe(faculty)}</span>${faculty === DEFAULT_FACULTY ? "" : `<button type="button" class="btn btn-small btn-danger" data-remove-faculty="${safe(faculty)}">×</button>`}</span>`).join("");
  const publicUrlInput = $("#publicBaseUrl");
  if (publicUrlInput && document.activeElement !== publicUrlInput) publicUrlInput.value = settings.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL;
  const attendanceUrlInput = $("#attendancePublicBaseUrl");
  if (attendanceUrlInput && document.activeElement !== attendanceUrlInput) attendanceUrlInput.value = settings.attendancePublicBaseUrl || DEFAULT_ATTENDANCE_BASE_URL;
}

function renderEventFaculties(selected = [DEFAULT_FACULTY]) {
  const faculties = settings.faculties || [DEFAULT_FACULTY];
  $("#eventFacultyList").innerHTML = faculties.map((faculty) => `<label class="check-chip"><input class="event-faculty" type="checkbox" value="${safe(faculty)}" ${selected.includes(faculty) ? "checked" : ""}> ${safe(faculty)}</label>`).join("");
}

async function permanentlyDeleteAttendance(selected) {
  if (!selected || !highAdminAccess()) throw Error("Chỉ Admin cấp cao hoặc Chủ sở hữu được xóa vĩnh viễn.");
  const collections = ["scannerAssignments", "checkins", "attendanceRoster", "attendanceGrants"];
  for (const name of collections) {
    const snap = await getDocs(query(collection(db, name), where("sessionId", "==", selected.id)));
    if (name === "checkins") await Promise.all(snap.docs.map((item) => deleteAttendancePhoto(item.data())));
    for (let offset = 0; offset < snap.docs.length; offset += 450) { const batch = writeBatch(db); snap.docs.slice(offset, offset + 450).forEach((item) => batch.delete(item.ref)); await batch.commit(); }
  }
  await deleteCachedExport(`exports/attendance/session-${selected.id}.xlsx`);
  await deleteDoc(doc(db, "attendanceSessions", selected.id));
  await audit("attendance.purge", "attendanceSession", selected.id, { title: selected.title || "" });
}

async function cleanupExpiredTrash() {
  if (!isOwner) return;
  const cutoff = Date.now() - TRASH_RETENTION_MS;
  const expired = events.filter((item) => item.deletedAt && (millis(item.deletedAt) || Infinity) <= cutoff && !purgingEventIds.has(item.id));
  for (const selected of expired) {
    purgingEventIds.add(selected.id);
    try {
      await permanentlyDeleteEvent(selected);
    } catch (error) {
      console.warn("Không thể tự xóa sự kiện hết hạn trong thùng rác:", error);
    } finally {
      purgingEventIds.delete(selected.id);
    }
  }
  const expiredGroups = groups.filter((item) => item.deletedAt && (millis(item.deletedAt) || Infinity) <= cutoff && !purgingGroupIds.has(item.id));
  for (const selected of expiredGroups) {
    purgingGroupIds.add(selected.id);
    try {
      await permanentlyDeleteGroup(selected);
    } catch (error) {
      console.warn("Không thể tự xóa nhóm hết hạn trong thùng rác:", error);
    } finally {
      purgingGroupIds.delete(selected.id);
    }
  }
  for (const selected of attendanceSessions.filter((item) => item.deletedAt && (millis(item.deletedAt) || Infinity) <= cutoff)) {
    try { await permanentlyDeleteAttendance(selected); } catch (error) { console.warn("Không thể tự xóa phiên điểm danh hết hạn:", error); }
  }
}

function listen() {
  onSnapshot(doc(db, "settings", "main"), (snapshot) => {
    if (snapshot.exists()) settings = { ...settings, ...snapshot.data() };
    settings.faculties = [...new Set([DEFAULT_FACULTY, ...(settings.faculties || [])])];
    renderFacultySettings();
  }, (error) => notice(error.message, "error"));

  subscribeGroups();

  subscribeEvents(() => {
    if (pendingAdminEditId) {
      const selected = events.find((item) => item.id === pendingAdminEditId);
      if (selected) {
        pendingAdminEditId = "";
        history.replaceState({}, "", window.location.pathname);
        showPane("events");
        openEvent(selected);
      }
    }
    if (isOwner) void cleanupExpiredTrash();
  });

  const attendanceSessionsQuery = isSubAdmin
    ? query(collection(db, "attendanceSessions"), where("createdByUid", "==", user.uid))
    : collection(db, "attendanceSessions");
  onSnapshot(attendanceSessionsQuery, (snapshot) => {
    attendanceSessions = snapshot.docs.map(normalizeAttendanceSession);
    if (selectedAttendanceSession && !activeAttendanceSessionById(attendanceSessions, selectedAttendanceSession.id)) {
      selectedAttendanceSession = null;
      attendanceRosterUnsubscribe?.(); attendanceRosterUnsubscribe = null;
      if ($("#attendanceManageDialog")?.open) $("#attendanceManageDialog").close();
    }
    renderAttendance();
    render();
    void refreshAttendanceCardCounts();
    void closeExpiredAttendanceSessions();
  }, (error) => notice("Không thể tải dữ liệu điểm danh: " + error.message, "error"));

  loadFacultyStudentMeta();
  loadFavoriteScanners();

  // Danh sách đăng ký chỉ được truy vấn sau khi Admin chọn một sự kiện.

  if (isOwner) onSnapshot(collection(db, "admins"), (snapshot) => {
    admins = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    render();
  }, (error) => notice(error.message, "error"));
}

$("#groupId").onchange = () => {
  const creating = $("#groupId").value === "__new__";
  $("#newGroupFields").classList.toggle("hidden", !creating);
  $("#newGroupName").required = creating;
  $("#newGroupMax").required = creating && !$("#newGroupUnlimited").checked;
  if (creating && !$("#newGroupMax").value) $("#newGroupMax").value = 2;
};

$("#newGroupUnlimited").onchange = () => setLimitInputState($("#newGroupUnlimited"), $("#newGroupMax"));

$("#eventHideFromPublic").onchange = syncEventVisibilityOptions;

$("#category").onchange = () => { toggleExternalEventFields(); setCapacityState(); };
$("#unlimitedCapacity").onchange = setCapacityState;
document.querySelectorAll('input[name="closeMode"]').forEach((input) => input.addEventListener("change", setCloseModeState));
let descriptionRange = null;
const descriptionEditor = $("#descriptionEditor");

function rememberDescriptionSelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (descriptionEditor.contains(range.commonAncestorContainer)) descriptionRange = range.cloneRange();
}

function runDescriptionCommand(command, value = null) {
  descriptionEditor.focus();
  if (descriptionRange) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(descriptionRange);
  }
  document.execCommand(command, false, value);
  rememberDescriptionSelection();
}

descriptionEditor.addEventListener("keyup", rememberDescriptionSelection);
descriptionEditor.addEventListener("mouseup", rememberDescriptionSelection);
descriptionEditor.addEventListener("input", rememberDescriptionSelection);
document.querySelectorAll(".rich-toolbar button,.rich-toolbar select,.rich-toolbar input").forEach((control) => control.addEventListener("pointerdown", rememberDescriptionSelection));
document.querySelectorAll("[data-format]").forEach((button) => button.addEventListener("click", () => runDescriptionCommand(button.dataset.format)));
$("#descriptionBlock").onchange = (event) => runDescriptionCommand("formatBlock", `<${event.target.value}>`);
$("#descriptionSize").onchange = (event) => runDescriptionCommand("fontSize", event.target.value);
$("#descriptionColor").oninput = (event) => runDescriptionCommand("foreColor", event.target.value);
$("#descriptionBackgroundColor").oninput = (event) => runDescriptionCommand("hiliteColor", event.target.value);
$("#insertDescriptionLink").onclick = async () => {
  rememberDescriptionSelection();
  const url = await requestAdminText({ title: "Chèn liên kết", message: "Nhập địa chỉ trang đích bắt đầu bằng https://", value: "https://", placeholder: "https://..." });
  if (!url) return;
  if (!/^https:\/\//i.test(url)) return notice("Liên kết phải bắt đầu bằng https://", "error");
  runDescriptionCommand("createLink", url);
};
$("#insertDescriptionImage").onclick = () => $("#descriptionImageFile").click();
$("#descriptionImageFile").onchange = (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 650000) {
    notice("Hình mô tả phải nhỏ hơn 650 KB.", "error");
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    runDescriptionCommand("insertImage", reader.result);
    event.target.value = "";
  };
  reader.readAsDataURL(file);
};

$("#eventForm").onsubmit = async (event) => {
  event.preventDefault();
  const submit = event.submitter || $("#saveEventBtn");
  const error = $("#eventFormError");
  submit.disabled = true;
  submit.textContent = "Đang lưu…";
  error.classList.add("hidden");
  const id = $("#eventId").value;
  try {
    const data = await prepareEventData(id, submit);
    if (!data) return;
    let selectedGroup = $("#groupId").value;
    let group = null;
    if (selectedGroup === "__new__") {
      const name = $("#newGroupName").value.trim();
      const unlimited = $("#newGroupUnlimited").checked;
      const maxRegistrations = Number($("#newGroupMax").value || 2);
      if (!name || (!unlimited && (!Number.isInteger(maxRegistrations) || maxRegistrations < 1 || maxRegistrations > 20))) throw Error("Tên nhóm và giới hạn từ 1 đến 20 là bắt buộc.");
      const code = shareCode(name);
      if (groups.some((item) => groupCode(item) === code)) throw Error(`Mã liên kết ${code} đã được một nhóm khác sử dụng.`);
      const groupPositions = groups.map(groupPosition).filter(Number.isFinite);
      const groupSortOrder = groupPositions.length ? Math.min(...groupPositions) - 1 : 0;
      const groupRef = await addDoc(collection(db, "eventGroups"), { name, shareCode: code, sortOrder: groupSortOrder, maxRegistrations: unlimited ? 2 : maxRegistrations, unlimited, linkOnly: false, createdByUid: user.uid, createdByEmail: user.email.toLowerCase(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      selectedGroup = groupRef.id;
      group = { id: groupRef.id, name, maxRegistrations: unlimited ? 2 : maxRegistrations, unlimited };
    } else if (selectedGroup) {
      group = groups.find((item) => item.id === selectedGroup);
      if (!group) throw Error("Nhóm sự kiện không tồn tại.");
    }
    data.groupId = group?.id || "";
    data.groupName = group?.name || "";
    data.groupMaxRegistrations = group?.maxRegistrations || 0;
    if (id) {
      const old = events.find((item) => item.id === id);
      if (!old) throw Error("Không tìm thấy sự kiện.");
      if (data.capacity < (old.registeredCount || 0)) throw Error("Sức chứa không thể nhỏ hơn số đã đăng ký.");
      if ((old.registeredCount || 0) > 0 && data.groupId !== (old.groupId || "")) throw Error("Không thể đổi nhóm khi sự kiện đã có người đăng ký.");
      const syncFields = [...document.querySelectorAll(".group-sync-field:checked")].map((input) => input.value);
      const siblingEvents = syncFields.length && data.groupId ? events.filter((item) => item.groupId === data.groupId && item.id !== id) : [];
      if (syncFields.includes("capacity")) {
        const invalidCapacityEvent = siblingEvents.find((item) => data.capacity < (item.registeredCount || 0));
        if (invalidCapacityEvent) throw Error(`Không thể áp dụng sức chứa ${data.capacity}; sự kiện “${invalidCapacityEvent.title}” đã có ${invalidCapacityEvent.registeredCount || 0} người đăng ký.`);
      }
      const syncLabels = { description: "Mô tả", location: "Địa điểm", capacity: "Sức chứa", openAt: "Thời gian mở đăng ký", closeAt: "Thời gian đóng đăng ký" };
      if (siblingEvents.length && !(await confirmAction({ title: "Áp dụng cho cả nhóm?", message: `Áp dụng ${syncFields.map((field) => syncLabels[field]).join(", ")} cho ${siblingEvents.length} sự kiện khác trong nhóm “${data.groupName}”?` }))) {
        throw Error("Đã hủy thao tác áp dụng cho nhóm. Sự kiện chưa được lưu.");
      }
      const attachmentSave = await prepareAttachmentSave(id);
      data.attachments = attachmentSave.attachments;
      try { await updateDoc(doc(db, "events", id), data); }
      catch (error) { await rollbackAttachmentSave(attachmentSave).catch(() => {}); throw error; }
      await finalizeAttachmentSave(attachmentSave, id);
      await audit("event.update", "event", id, { title: data.title });
      if (siblingEvents.length) {
        const sharedData = { updatedAt: serverTimestamp() };
        if (syncFields.includes("description")) Object.assign(sharedData, { description: data.description, descriptionHtml: data.descriptionHtml });
        if (syncFields.includes("location")) sharedData.location = data.location;
        if (syncFields.includes("capacity")) sharedData.capacity = data.capacity;
        if (syncFields.includes("openAt")) sharedData.openAt = data.openAt;
        if (syncFields.includes("closeAt")) Object.assign(sharedData, { closeAt: data.closeAt, closeMode: data.closeMode, autoCloseRegistration: false });
        await Promise.all(siblingEvents.map((item) => updateDoc(doc(db, "events", item.id), sharedData)));
      }
      $("#eventDialog").close();
      notice(siblingEvents.length ? `Đã lưu và áp dụng ${syncFields.length} nội dung cho ${siblingEvents.length} sự kiện khác trong nhóm.` : "Đã lưu sự kiện.", "success");
    } else {
      const siblingPositions = events.filter((item) => (item.groupId || "") === data.groupId).map(eventPosition).filter(Number.isFinite);
      const sortOrder = siblingPositions.length ? Math.min(...siblingPositions) - 1 : 0;
      const eventRef = await addDoc(collection(db, "events"), { ...data, attachments: [], sortOrder, registeredCount: 0, createdByUid: user.uid, createdByEmail: user.email.toLowerCase(), createdByName: user.displayName || "", createdAt: serverTimestamp() });
      let attachmentSave = null;
      try {
        attachmentSave = await prepareAttachmentSave(eventRef.id);
        await updateDoc(eventRef, { attachments: attachmentSave.attachments, updatedAt: serverTimestamp() });
      } catch (error) {
        if (attachmentSave) await rollbackAttachmentSave(attachmentSave).catch(() => {});
        await deleteDoc(eventRef).catch(() => {});
        throw error;
      }
      await finalizeAttachmentSave(attachmentSave, eventRef.id);
      await audit("event.create", "event", eventRef.id, { title: data.title });
      $("#eventDialog").close();
      notice("Đã lưu sự kiện.", "success");
    }
  } catch (saveError) {
    error.textContent = saveError.message || "Không thể lưu sự kiện.";
    error.className = "notice error";
    error.classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.textContent = "Lưu sự kiện";
    delete submit.dataset.immediateOpenBase;
  }
};

$("#addFacultyBtn").onclick = () => {
  const name = $("#newFaculty").value.trim();
  if (!name) return;
  settings.faculties = [...new Set([...(settings.faculties || [DEFAULT_FACULTY]), name])];
  $("#newFaculty").value = "";
  renderFacultySettings();
};

$("#settingsForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const publicUrl = new URL($("#publicBaseUrl").value.trim());
    if (publicUrl.protocol !== "https:") throw Error("Đường dẫn công khai phải bắt đầu bằng https://");
    publicUrl.search = "";
    publicUrl.hash = "";
    settings.publicBaseUrl = publicUrl.toString().replace(/\/$/, "");
    const attendanceUrl = new URL($("#attendancePublicBaseUrl").value.trim());
    if (attendanceUrl.protocol !== "https:") throw Error("Đường dẫn điểm danh phải bắt đầu bằng https://");
    attendanceUrl.search = "";
    attendanceUrl.hash = "";
    settings.attendancePublicBaseUrl = attendanceUrl.toString();
    await setDoc(doc(db, "settings", "main"), { faculties: settings.faculties || [DEFAULT_FACULTY], publicBaseUrl: settings.publicBaseUrl, attendancePublicBaseUrl: settings.attendancePublicBaseUrl, participantDomains: ["student.tdtu.edu.vn", "tdtu.edu.vn"], updatedBy: user.email, updatedAt: serverTimestamp() }, { merge: true });
    renderFacultySettings();
    notice("Đã lưu thiết lập. Các nút Copy link đã dùng đường dẫn mới.", "success");
  } catch (error) {
    notice(error.message, "error");
  }
};

$("#adminForm").onsubmit = async (event) => {
  event.preventDefault();
  const email = $("#adminEmail").value.trim().toLowerCase();
  const role = $("#adminRole").value === "subadmin" ? "subadmin" : "admin";
  try {
    await setDoc(doc(db, "admins", email), { email, name: $("#adminName").value.trim(), role, addedByUid: user.uid, addedAt: serverTimestamp() });
    event.target.reset();
    $("#adminRole").value = "admin";
    notice(`Đã thêm ${role === "subadmin" ? "Sub-admin" : "Admin"}.`, "success");
  } catch (error) {
    notice(error.message, "error");
  }
};

document.addEventListener("change", async (event) => {
  const attendanceRole = event.target.closest("[data-attendance-assignment-role]");
  if (attendanceRole) {
    try {
      const role = attendanceRole.value === "leader" ? "leader" : "scanner";
      await updateDoc(doc(db, "scannerAssignments", attendanceRole.dataset.attendanceAssignmentRole), { role, updatedAt: serverTimestamp() });
      await audit("scanner.role", "attendanceSession", selectedAttendanceSession?.id || "", { assignmentId: attendanceRole.dataset.attendanceAssignmentRole, role });
      await loadAttendanceManage();
      notice("Đã cập nhật nhanh vai trò sinh viên.", "success");
    } catch (error) { notice(error.message || "Không thể đổi vai trò.", "error"); }
    return;
  }
  const select = event.target.closest("[data-admin-role]");
  if (!select || !isOwner) return;
  try {
    await updateDoc(doc(db, "admins", select.dataset.adminRole), { role: select.value === "subadmin" ? "subadmin" : "admin", updatedAt: serverTimestamp() });
    await clearStorageAdminAccess(select.dataset.adminRole);
    notice("Đã cập nhật quyền quản trị.", "success");
  } catch (error) {
    notice(error.message || "Không thể cập nhật quyền.", "error");
    render();
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (await handleGroupClick(button)) return;
  if (button.dataset.pane) showPane(button.dataset.pane);
  if (button.dataset.eventFilter) {
    setEventStatusFilter(button.dataset.eventFilter);
    document.querySelectorAll(".admin-filter").forEach((item) => item.classList.toggle("active", item.dataset.adminFilter === button.dataset.eventFilter));
    showPane("events");
    render();
  }
  if (button.dataset.registrationFilter !== undefined) showPane("registrations");
  if (button.dataset.registrationDetail) openRegistrationDetailById(button.dataset.registrationDetail);
  if (button.dataset.adminFilter) {
    setEventStatusFilter(button.dataset.adminFilter);
    document.querySelectorAll(".admin-filter").forEach((item) => item.classList.toggle("active", item === button));
    render();
  }
  if (button.dataset.eventView) {
    setEventView(button.dataset.eventView);
    render();
  }
  if (button.dataset.moveEvent) await moveEvent(button.dataset.moveEvent, Number(button.dataset.direction));
  if (button.dataset.newEvent !== undefined) openEvent();
  if (button.dataset.close !== undefined) $("#eventDialog").close();
  if (button.dataset.edit) openEvent(events.find((item) => item.id === button.dataset.edit));
  if (button.dataset.copyEvent) openEvent(events.find((item) => item.id === button.dataset.copyEvent), true);
  if (button.dataset.calendarEvent) {
    const selectedEvent = events.find((item) => item.id === button.dataset.calendarEvent);
    if (selectedEvent) openGoogleCalendar(selectedEvent);
  }
  if (button.dataset.createEventLink) {
    const selectedEvent = events.find((item) => item.id === button.dataset.createEventLink);
    await createEventLink(selectedEvent, button);
  }
  if (button.dataset.copyEventLink) {
    const selectedEvent = events.find((item) => item.id === button.dataset.copyEventLink);
    if (selectedEvent?.shareCode) await copyText(eventShareUrl(selectedEvent), "Đã sao chép liên kết sự kiện.");
  }
  if (button.dataset.quickRegistrations) await openQuickRegistrations(button.dataset.quickRegistrations);
  if (button.dataset.exportEvent) await downloadRegistrationExcel(button.dataset.exportEvent, "", button);
  if (button.dataset.closeQuick !== undefined) $("#quickRegistrationDialog").close();
  if (button.dataset.closeRegistrationDetail !== undefined) $("#registrationDetailDialog").close();
  if (button.dataset.delete) {
    const selected = events.find((item) => item.id === button.dataset.delete);
    await trashEvent(selected, button);
  }
  if (button.dataset.restoreEvent) {
    const selected = events.find((item) => item.id === button.dataset.restoreEvent && item.deletedAt);
    await restoreEvent(selected, button);
  }
  if (button.dataset.purgeEvent) {
    const selected = events.find((item) => item.id === button.dataset.purgeEvent && item.deletedAt);
    await purgeEvent(selected, button);
  }
  if (button.dataset.deleteRegistration) {
    const registration = findLoadedRegistration(button.dataset.deleteRegistration);
    if (registration && await confirmAction({ title: "Xóa đăng ký?", message: `Xóa đăng ký của ${registration.name || registration.email} khỏi sự kiện “${registration.eventTitle}”?` })) try {
      button.disabled = true;
      await removeRegistration(registration);
      await loadRegistrationPage(0);
      notice("Đã xóa thành viên khỏi sự kiện.", "success");
    } catch (error) {
      button.disabled = false;
      notice(error.message, "error");
    }
  }
  if (button.dataset.removeAdmin && await confirmAction({ title: "Xóa quyền Admin?", message: `Tài khoản ${button.dataset.removeAdmin} sẽ không còn quyền quản trị.` })) try {
    await clearStorageAdminAccess(button.dataset.removeAdmin);
    await deleteDoc(doc(db, "admins", button.dataset.removeAdmin));
    notice("Đã xóa Admin.", "success");
  } catch (error) {
    notice(error.message, "error");
  }
  if (button.dataset.removeFaculty) {
    settings.faculties = (settings.faculties || []).filter((faculty) => faculty !== button.dataset.removeFaculty);
    renderFacultySettings();
  }
});

document.querySelectorAll(".registration-status-filter").forEach((checkbox) => {
  checkbox.onchange = () => {
    syncRegistrationStatusFilters([...document.querySelectorAll(".registration-status-filter:checked")].map((item) => item.value));
    $("#eventFilter").value = "";
    resetRegistrationPage();
    refreshRegistrationFilters();
    renderRegs();
  };
});
$("#registrationPageSize").onchange = async () => {
  setRegistrationPageSize($("#registrationPageSize").value);
  resetRegistrationPage();
  await loadRegistrationPage(0);
};

$("#eventFilter").onchange = async () => {
  resetRegistrationPage();
  await loadRegistrationPage(0);
};
$("#groupFilter").onchange = () => {
  $("#eventFilter").value = "";
  resetRegistrationPage();
  refreshRegistrationFilters();
  renderRegs();
};
$("#registrationPrev").onclick = () => loadRegistrationPage(-1);
$("#registrationNext").onclick = () => loadRegistrationPage(1);
$("#quickRegistrationPrev").onclick = () => loadQuickRegistrationPage(-1);
$("#quickRegistrationNext").onclick = () => loadQuickRegistrationPage(1);

$("#resetEventBtn").onclick = () => resetSelectedEventRegistrations();

$("#exportBtn").onclick = async () => {
  const eventId = $("#eventFilter").value;
  const groupId = $("#groupFilter").value;
  if (!eventId && !groupId) {
    notice("Vui lòng chọn một sự kiện hoặc nhóm sự kiện trước khi tải danh sách.", "error");
    return;
  }
  await downloadRegistrationExcel(eventId, eventId ? "" : groupId, $("#exportBtn"));
};


function attendanceStatusLabel(status) {
  return status === "scheduled" ? "Sắp mở" : status === "open" ? "Đang mở" : status === "ended" ? "Đã kết thúc" : "Đã chốt danh sách";
}
function attendanceStartMillis(item) {
  if (item?.startAt?.toDate) return item.startAt.toDate().getTime();
  if (!item?.date) return -Infinity;
  return new Date(`${item.date}T${item.startTime || "00:00"}:00`).getTime();
}
function attendanceStartTimestamp(date, startTime) {
  return Timestamp.fromMillis(attendanceStartMillis({ date, startTime }));
}
function attendanceEndTimestamp(endDate, endTime) {
  return Timestamp.fromMillis(attendanceDeadlineMillis({ endDate, endTime }));
}
function attendanceDeadlineMillis(item) {
  const endDate = item?.endDate || item?.date;
  if (endDate && item?.endTime) return new Date(`${endDate}T${item.endTime}:00`).getTime() + 30 * 60000;
  return millis(item?.endAt) || (endDate ? new Date(`${endDate}T23:59:59`).getTime() : Infinity);
}
function attendanceExpired(item) {
  return item?.status === "open" && attendanceDeadlineMillis(item) <= Date.now();
}
function attendanceRuntimeState(item) {
  if (item?.status === "finalized") return "finalized";
  if (item?.status === "ended" || attendanceDeadlineMillis(item) <= Date.now()) return "ended";
  if (attendanceStartMillis(item) > Date.now()) return "scheduled";
  return "open";
}
function attendanceTimingStatus(item) {
  const state = attendanceRuntimeState(item);
  if (state === "scheduled") return `Mở điểm danh lúc ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(attendanceStartMillis(item)))} · Còn ${countdown(attendanceStartMillis(item))}`;
  if (state === "open") return `Đang mở điểm danh${Number.isFinite(attendanceDeadlineMillis(item)) ? ` · Còn ${countdown(attendanceDeadlineMillis(item))}` : ""}`;
  return attendanceStatusLabel(state);
}
async function closeExpiredAttendanceSessions() {
  clearTimeout(attendanceExpiryTimer);
  const expired = attendanceSessions.filter(attendanceExpired);
  expired.forEach((item) => { item.status = "ended"; item.endAt = Timestamp.fromMillis(attendanceDeadlineMillis(item)); item.endedAt = item.endAt; item.endedAutomatically = true; });
  renderAttendance();
  await Promise.all(expired.map((item) => updateDoc(doc(db, "attendanceSessions", item.id), {
    status: "ended", endedAt: item.endAt, endedAutomatically: true, updatedAt: serverTimestamp()
  }).catch((error) => console.warn("Không thể tự đóng điểm danh:", error))));
  const nextEnd = attendanceSessions.filter((item) => item.status === "open").map(attendanceDeadlineMillis).filter((value) => Number.isFinite(value) && value > Date.now()).sort((a, b) => a - b)[0];
  if (nextEnd) attendanceExpiryTimer = window.setTimeout(() => void closeExpiredAttendanceSessions(), Math.min(nextEnd - Date.now() + 250, 2147483647));
}
function attendanceHasRegistrationRoster(item) {
  return Boolean(item?.eventId || item?.hasRegistrationRoster === true);
}

function highAdminAccess() { return isOwner || currentRole === "admin"; }
function canReopenAttendance(item) {
  if (!item || !["ended", "finalized"].includes(item.status)) return false;
  if (highAdminAccess()) return true;
  const endedAt = millis(item.endedAt);
  return isSubAdmin && item.createdByUid === user?.uid && endedAt && Date.now() <= endedAt + 5 * 86400000;
}
function mergeAttendancePermissions(records) {
  const map = new Map(attendancePermissionMembers.map((item) => [item.mssv, item]));
  records.forEach((value) => { const item = studentRecord(value); if (validStudentId(item.mssv) && item.name) map.set(item.mssv, { ...map.get(item.mssv), ...item, role: value.role === "leader" ? "leader" : "scanner" }); });
  attendancePermissionMembers = [...map.values()];
  renderAttendancePermissions();
}
function renderAttendancePermissions() {
  const sorted = attendancePermissionMembers.slice().sort((a, b) => Number(b.role === "leader") - Number(a.role === "leader"));
  $("#attendancePermissionRows").innerHTML = sorted.map((item) => `<tr class="${item.role === "leader" ? "attendance-leader-row" : ""}"><td><b>${safe(item.mssv)}</b></td><td>${safe(item.name)}</td><td><select class="attendance-role-select" data-attendance-role="${safe(item.mssv)}"><option value="scanner" ${item.role !== "leader" ? "selected" : ""}>SV quét</option><option value="leader" ${item.role === "leader" ? "selected" : ""}>SV Leader</option></select></td><td><button type="button" class="btn btn-small btn-danger" data-remove-attendance-permission="${safe(item.mssv)}">Xóa</button></td></tr>`).join("") || '<tr><td colspan="4" class="empty">Chưa cấp quyền cho sinh viên.</td></tr>';
}
function normalizeFavoriteScanner(value = {}) {
  return { ...studentRecord(value), role: value.role === "leader" ? "leader" : "scanner" };
}
function renderFavoriteScanners() {
  const rows = favoriteScannerStudents.slice().sort((a, b) => a.name.localeCompare(b.name, "vi") || a.mssv.localeCompare(b.mssv));
  document.querySelectorAll("[data-favorite-scanner-panel]").forEach((panel) => {
    const target = panel.dataset.favoriteScannerPanel;
    const count = panel.querySelector("[data-favorite-scanner-count]");
    const body = panel.querySelector("[data-favorite-scanner-rows]");
    if (count) count.textContent = `${rows.length} SV`;
    if (!body) return;
    body.innerHTML = rows.map((item) => `<tr><td><input type="checkbox" aria-label="Chọn ${safe(item.mssv)}" data-favorite-scanner-check="${target}" value="${safe(item.mssv)}"></td><td><b>${safe(item.mssv)}</b></td><td>${safe(item.name || "Không có dữ liệu")}</td><td><select class="attendance-role-select" data-favorite-scanner-role="${safe(item.mssv)}"><option value="scanner" ${item.role !== "leader" ? "selected" : ""}>SV quét</option><option value="leader" ${item.role === "leader" ? "selected" : ""}>SV Leader</option></select></td><td class="actions"><button type="button" class="btn btn-small btn-primary" data-favorite-add-one="${safe(item.mssv)}" data-favorite-target="${target}">＋ Thêm</button><button type="button" class="btn btn-small btn-danger" data-favorite-remove="${safe(item.mssv)}">Xóa</button></td></tr>`).join("") || '<tr><td colspan="5" class="empty">Chưa có sinh viên hỗ trợ yêu thích.</td></tr>';
  });
}
async function loadFavoriteScanners() {
  if (!user) return;
  try {
    const snapshot = await getDoc(doc(db, "favoriteScannerLists", user.uid));
    favoriteScannerStudents = snapshot.exists() ? (snapshot.data().students || []).map(normalizeFavoriteScanner).filter((item) => validStudentId(item.mssv)) : [];
  } catch (error) {
    favoriteScannerStudents = [];
    notice("Không thể tải danh sách SV hỗ trợ yêu thích: " + error.message, "error");
  }
  renderFavoriteScanners();
}
async function saveFavoriteScanners(message = "Đã cập nhật danh sách SV hỗ trợ yêu thích.") {
  const unique = [...new Map(favoriteScannerStudents.map(normalizeFavoriteScanner).filter((item) => validStudentId(item.mssv)).map((item) => [item.mssv, item])).values()].slice(0, 100);
  favoriteScannerStudents = unique;
  await setDoc(doc(db, "favoriteScannerLists", user.uid), { ownerUid: user.uid, ownerEmail: user.email, students: unique, updatedAt: serverTimestamp() }, { merge: true });
  renderFavoriteScanners();
  notice(message, "success");
}
async function saveFavoriteScannerFrom(inputSelector, roleSelector) {
  const input = $(inputSelector);
  const student = await resolvePermissionStudent(input.value);
  if (!student) return notice("MSSV không hợp lệ; cần 8–12 chữ hoặc số.", "error");
  const item = normalizeFavoriteScanner({ ...student, role: $(roleSelector).value });
  const map = new Map(favoriteScannerStudents.map((value) => [value.mssv, value]));
  map.set(item.mssv, item);
  favoriteScannerStudents = [...map.values()];
  input.value = "";
  await saveFavoriteScanners(`Đã lưu ${item.mssv} vào danh sách yêu thích.`);
}
async function grantFavoriteScanners(records) {
  if (!selectedAttendanceSession || selectedAttendanceSession.status !== "open") throw Error("Chỉ có thể cấp quyền khi điểm danh đang mở.");
  const members = [...new Map(records.map(normalizeFavoriteScanner).map((item) => [item.mssv, item])).values()];
  const writes = members.flatMap((item) => {
    const email = item.email || item.mssv.toLowerCase() + "@student.tdtu.edu.vn";
    const assignmentId = selectedAttendanceSession.id + "_" + email;
    return [
      { ref: doc(db, "scannerAssignments", assignmentId), data: { sessionId: selectedAttendanceSession.id, email, mssv: item.mssv, name: item.name || "Không có dữ liệu", role: item.role, active: true, grantedAt: serverTimestamp() } },
      { ref: doc(db, "attendanceGrants", assignmentId), data: { sessionId: selectedAttendanceSession.id, assignmentId, grantedAt: serverTimestamp(), grantedByEmail: user.email, grantedByName: user.displayName || user.email } }
    ];
  });
  for (let offset = 0; offset < writes.length; offset += 450) {
    const batch = writeBatch(db);
    writes.slice(offset, offset + 450).forEach((entry) => batch.set(entry.ref, entry.data));
    await batch.commit();
  }
  const scannerCount = (await getCountFromServer(query(collection(db, "scannerAssignments"), where("sessionId", "==", selectedAttendanceSession.id)))).data().count;
  await updateDoc(doc(db, "attendanceSessions", selectedAttendanceSession.id), { scannerCount, updatedAt: serverTimestamp() });
  await audit("scanner.grant", "attendanceSession", selectedAttendanceSession.id, { count: members.length, source: "favorites" });
  await loadAttendanceManage();
  notice(`Đã cấp quyền nhanh cho ${members.length} sinh viên.`, "success");
}
async function addFavoriteScannersToTarget(target, records) {
  if (!records.length) return notice("Chưa chọn sinh viên hỗ trợ.", "error");
  if (target === "create") {
    mergeAttendancePermissions(records);
    return notice(`Đã thêm ${records.length} sinh viên yêu thích vào danh sách cấp quyền.`, "success");
  }
  await grantFavoriteScanners(records);
}
function selectedFavoriteScanners(target) {
  const selectedIds = new Set([...document.querySelectorAll(`[data-favorite-scanner-check="${target}"]:checked`)].map((input) => input.value));
  return favoriteScannerStudents.filter((item) => selectedIds.has(item.mssv));
}
function populatePermissionCopyOptions() {
  const select = $("#attendanceCopyPermissionsFrom");
  if (!select) return;
  select.innerHTML = '<option value="">— Copy quyền từ sự kiện khác —</option>' + attendanceSessions.map((item) => `<option value="${item.id}">${safe(item.title)} · ${safe(vietnamDate(item.date))}</option>`).join("");
}

function renderAttendance() {
  const target = $("#attendanceRows");
  if (!target) return;
  const list = activeAttendanceSessions(attendanceSessions)
    .filter((item) => attendanceFilter === "all" || attendanceRuntimeState(item) === attendanceFilter)
    .sort((a, b) => (millis(b.createdAt) || 0) - (millis(a.createdAt) || 0));
  target.className = `att-grid attendance-view-${attendanceView}`;
  document.querySelectorAll("[data-attendance-view]").forEach((button) => button.classList.toggle("active", button.dataset.attendanceView === attendanceView));
  target.innerHTML = list.length ? list.map((item) => {
    const runtimeState = attendanceRuntimeState(item);
    const hasRoster = attendanceHasRegistrationRoster(item);
    const sourceEvent = item.eventId ? events.find((event) => event.id === item.eventId) : null;
    const rosterCount = sourceEvent ? Number(sourceEvent.registeredCount || 0) : Number(item.rosterCount || 0);
    const rosterMeta = hasRoster ? ` · ${rosterCount} sinh viên đăng ký` : "";
    const checkinCount = attendanceCheckinCounts.get(item.id) || 0;
    const scannerCount = attendanceScannerCounts.get(item.id) || 0;
    const pendingCount = Number(item.pendingCount || 0);
    return `<article class="att-row">
    <div><span class="att-badge ${safe(runtimeState)}" data-attendance-state="${item.id}" data-runtime-state="${safe(runtimeState)}">${safe(attendanceStatusLabel(runtimeState))}</span>
    <h3>${safe(item.title)}</h3><div class="att-meta">${safe(vietnamDate(item.date))}${item.location ? ` · ${safe(item.location)}` : ""}${rosterMeta}</div><div class="att-meta attendance-timing" data-attendance-timing="${item.id}">${safe(attendanceTimingStatus(item))}</div><div class="attendance-card-stats"><span><b>${checkinCount}</b> SV đã điểm danh</span><span><b>${scannerCount}</b> SV được cấp quyền quét</span>${pendingCount ? `<button type="button" class="attendance-pending-stat" data-attendance-open-pending="${item.id}"><b>${pendingCount}</b> hình cần nhập MSSV</button>` : ""}</div></div>
    <div class="att-actions attendance-card-actions"><button class="btn" data-attendance-manage="${item.id}">Quản lý</button><button class="btn" data-attendance-copy="${item.id}">Copy link</button><button class="btn btn-success" data-attendance-quick-export="${item.id}">↓ Danh sách</button><button class="btn btn-danger" data-delete-attendance="${item.id}">Xóa</button></div>
  </article>`;
  }).join("") : '<div class="card empty">Không có sự kiện điểm danh trong bộ lọc này.</div>';
}

function updateAttendanceCountdowns() {
  let stateChanged = false;
  document.querySelectorAll("[data-attendance-state]").forEach((node) => {
    const item = attendanceSessions.find((value) => value.id === node.dataset.attendanceState);
    if (item && node.dataset.runtimeState !== attendanceRuntimeState(item)) stateChanged = true;
  });
  if (stateChanged) renderAttendance();
  else document.querySelectorAll("[data-attendance-timing]").forEach((node) => {
    const item = attendanceSessions.find((value) => value.id === node.dataset.attendanceTiming);
    if (item) node.textContent = attendanceTimingStatus(item);
  });
  if (selectedAttendanceSession && $("#attendanceManageDialog")?.open) {
    $("#attendanceManageMeta").textContent = `${attendanceTimingStatus(selectedAttendanceSession)} · ${vietnamDate(selectedAttendanceSession.date)}`;
  }
}

async function refreshAttendanceCardCounts() {
  if (attendanceSummaryLoading) return;
  attendanceSummaryLoading = true;
  try {
    const visible = attendanceSessions.filter((item) => !item.deletedAt);
    const results = await Promise.all(visible.map(async (item) => {
      if (Number.isInteger(item.checkinCount) && Number.isInteger(item.scannerCount)) return [item.id, item.checkinCount, item.scannerCount];
      const [checkins, scanners] = await Promise.all([
        getCountFromServer(query(collection(db, "checkins"), where("sessionId", "==", item.id), where("deletedAt", "==", null))),
        getCountFromServer(query(collection(db, "scannerAssignments"), where("sessionId", "==", item.id)))
      ]);
      const counts = { checkinCount: checkins.data().count, scannerCount: scanners.data().count, pendingCount: Number(item.pendingCount || 0), updatedAt: serverTimestamp() };
      try { await updateDoc(doc(db, "attendanceSessions", item.id), counts); } catch {}
      return [item.id, counts.checkinCount, counts.scannerCount];
    }));
    attendanceCheckinCounts = new Map(results.map(([id, count]) => [id, count]));
    attendanceScannerCounts = new Map(results.map(([id, , count]) => [id, count]));
    renderAttendance();
  } catch (error) {
    console.warn("Không thể tải thống kê điểm danh tiết kiệm:", error);
  } finally { attendanceSummaryLoading = false; }
}

function populateAttendanceEventOptions(selectedId = "") {
  const select = $("#attendanceSourceEvent");
  if (!select) return;
    const existing = new Set(attendanceSessions.filter((item) => !item.deletedAt).map((item) => item.eventId));
  const eligible = events.filter((item) => attendanceSourceEligible(item) && !existing.has(item.id));
  select.innerHTML = '<option value="">— Điểm danh độc lập —</option>' + eligible.map((item) =>
    `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${safe(item.title)} · ${safe(vietnamDate(item.date))}</option>`
  ).join("");
}

function attendanceSourceEligible(item) {
  return !!item && !item.deletedAt && item.status !== "hidden" && !isExternalEvent(item)
    && Array.isArray(item.allowedFaculties) && item.allowedFaculties.includes(DEFAULT_FACULTY);
}

function attendanceCode() {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return (values[0].toString(36) + values[1].toString(36)).slice(0, 9).toUpperCase();
}

function attendanceNameMissing(value) {
  const name = normalizeSearch(value);
  return !name || name === "không có dữ liệu" || name === "chưa có dữ liệu";
}
async function enrichAttendanceStudentNames() {
  const rows = attendanceManageRows.filter((item) => item.mssv && attendanceNameMissing(item.name));
  if (!rows.length) return;
  const directory = new Map(attendanceRoster.filter((item) => item.mssv && !attendanceNameMissing(item.name)).map((item) => [String(item.mssv).toUpperCase(), item]));
  try {
    const dataset = await loadFacultyDataset(storage, getFacultyStudentDatasetMeta());
    dataset.forEach((item) => { if (item.mssv && item.name) directory.set(String(item.mssv).toUpperCase(), item); });
  } catch {
    // Nếu chưa có file nén, chỉ tra các MSSV còn thiếu ở Firestore bên dưới.
  }
  const missingIds = [...new Set(rows.map((item) => String(item.mssv).trim().toUpperCase()).filter((mssv) => !directory.has(mssv)))];
  for (let offset = 0; offset < missingIds.length; offset += 25) {
    const results = await Promise.all(missingIds.slice(offset, offset + 25).map(async (mssv) => {
      try {
        const snapshot = await getDocFromServer(doc(db, "facultyStudents", mssv));
        return snapshot.exists() ? [mssv, studentRecord({ ...snapshot.data(), mssv: snapshot.id })] : null;
      } catch { return null; }
    }));
    results.filter(Boolean).forEach(([mssv, student]) => directory.set(mssv, student));
  }
  const repaired = [];
  rows.forEach((item) => {
    const student = directory.get(String(item.mssv).trim().toUpperCase());
    if (!student?.name) return;
    item.name = student.name; item.email = student.email || item.email || ""; item.studentUid = student.uid || item.studentUid || "";
    repaired.push(item);
  });
  if (!repaired.length || selectedAttendanceSession?.status === "finalized") return;
  for (let offset = 0; offset < repaired.length; offset += 450) {
    const batch = writeBatch(db);
    repaired.slice(offset, offset + 450).forEach((item) => batch.update(doc(db, "checkins", item.id), { name: item.name, email: item.email || "", studentUid: item.studentUid || "" }));
    try { await batch.commit(); } catch {}
  }
  try { await updateDoc(doc(db, "attendanceSessions", selectedAttendanceSession.id), { updatedAt: serverTimestamp() }); } catch {}
}

async function loadAttendanceManage() {
  if (!selectedAttendanceSession) return;
  const sessionId = selectedAttendanceSession.id;
  const cursor = attendancePageCursors[attendancePage - 1];
  const pageQueryParts = [collection(db, "checkins"), where("sessionId", "==", sessionId)];
  if (cursor) pageQueryParts.push(startAfter(cursor));
  pageQueryParts.push(limit(attendancePageSize + 1));
  const [assignmentSnapshot, checkinSnapshot, pendingSnapshot, grantSnapshot] = await Promise.all([
    getDocs(query(collection(db, "scannerAssignments"), where("sessionId", "==", sessionId))),
    getDocs(query(...pageQueryParts)),
    getDocs(query(collection(db, "checkins"), where("sessionId", "==", sessionId), where("mssv", "==", ""))),
    isSubAdmin ? Promise.resolve({ docs: [] }) : getDocs(query(collection(db, "attendanceGrants"), where("sessionId", "==", sessionId)))
  ]);
  attendancePageHasNext = checkinSnapshot.docs.length > attendancePageSize;
  const pageDocs = checkinSnapshot.docs.slice(0, attendancePageSize);
  if (attendancePageHasNext && pageDocs.length) attendancePageCursors[attendancePage] = pageDocs[pageDocs.length - 1];
  const pageRows = pageDocs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => !item.deletedAt).sort((a, b) => attendanceCheckedMillis(b) - attendanceCheckedMillis(a));
  const pendingRows = pendingSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => !item.deletedAt && !pageRows.some((row) => row.id === item.id));
  const preservedTrash = attendanceTrashLoaded ? attendanceManageRows.filter((item) => item.deletedAt) : [];
  attendanceManageRows = [...pageRows, ...pendingRows, ...preservedTrash];
  attendanceTotalCount = Number(selectedAttendanceSession.checkinCount || pageRows.filter((item) => item.mssv).length);
  await migrateLegacyAttendancePhotos([...pageRows, ...pendingRows]);
  await enrichAttendanceStudentNames();
  const grants = new Map(grantSnapshot.docs.map((item) => [item.id, item.data()]));
  $("#attendanceGrantedByHead").classList.toggle("hidden", isSubAdmin);
  $("#attendanceScannerRows").innerHTML = assignmentSnapshot.docs.map((item) => {
    const data = item.data();
    const grant = grants.get(item.id) || {};
    return `<tr class="${data.role === "leader" ? "attendance-leader-row" : ""}"><td>${safe(data.mssv)}</td><td>${safe(data.name)}</td><td><select class="attendance-role-select" data-attendance-assignment-role="${item.id}"><option value="scanner" ${data.role !== "leader" ? "selected" : ""}>SV quét</option><option value="leader" ${data.role === "leader" ? "selected" : ""}>SV Leader</option></select></td>
      <td class="${isSubAdmin ? "hidden" : ""}">${safe(grant.grantedByName || grant.grantedByEmail || "")}</td>
      <td><div class="actions"><button class="btn btn-small favorite-star-btn" title="Lưu vào danh sách yêu thích" data-save-scanner-favorite="${item.id}">★</button><button class="btn btn-small btn-danger" data-attendance-remove-scanner="${item.id}" ${selectedAttendanceSession.status === "finalized" ? "disabled" : ""}>Xóa</button></div></td></tr>`;
  }).join("") || '<tr><td colspan="5" class="empty">Chưa cấp quyền cho sinh viên quét.</td></tr>';
  renderAttendanceManageRows();
}

function attendanceCheckedMillis(item) { return millis(item.checkedAt) || 0; }
function attendanceActiveRows() { return attendanceManageRows.filter((item) => !item.deletedAt).sort((a, b) => attendanceCheckedMillis(b) - attendanceCheckedMillis(a)); }
function attendanceReportData() {
  const completed = (attendanceReportLoaded ? attendanceReportRowsSource : attendanceActiveRows()).filter((item) => item.mssv && !item.deletedAt);
  const attended = new Map(completed.map((item) => [String(item.mssv).toUpperCase(), item]));
  const registered = attendanceRoster.map((item) => ({ ...item, state: attended.has(String(item.mssv).toUpperCase()) ? "present" : "absent" }));
  const rosterIds = new Set(attendanceRoster.map((item) => String(item.mssv).toUpperCase()));
  const outside = completed.filter((item) => !rosterIds.has(String(item.mssv).toUpperCase())).map((item) => ({ ...item, state: "outside" }));
  return { present: registered.filter((item) => item.state === "present"), absent: registered.filter((item) => item.state === "absent"), outside };
}
function renderAttendanceManageRows() {
  const active = attendanceActiveRows(), pending = active.filter((item) => !item.mssv && (item.photoPath || item.photoData)), completed = active.filter((item) => item.mssv), trashed = attendanceTrashLoaded ? attendanceManageRows.filter((item) => item.deletedAt).sort((a, b) => (millis(b.deletedAt) || 0) - (millis(a.deletedAt) || 0)) : [];
  $("#attendancePendingSection").classList.toggle("hidden", !pending.length);
  $("#attendancePendingPhotoCount").textContent = pending.length + " ảnh";
  $("#attendanceTabPendingBadge").textContent = pending.length;
  $("#attendanceTabPendingBadge").classList.toggle("hidden", !pending.length);
  $("#attendancePendingPhotoRows").innerHTML = pending.map((item, index) => `<tr><td>${pending.length - index}</td><td><button type="button" class="attendance-photo-link" data-attendance-view-photo="${item.id}">Xem hình</button></td><td>${safe(item.scannerName || item.scannerMssv || "")}</td><td>${safe(ts(item.checkedAt))}</td><td><input class="attendance-inline-mssv" data-attendance-pending-input="${item.id}" maxlength="12" placeholder="Nhập MSSV" ${selectedAttendanceSession?.status === "finalized" ? "disabled" : ""}></td><td><button type="button" class="btn btn-primary" data-attendance-label-photo="${item.id}" ${selectedAttendanceSession?.status === "finalized" ? "disabled" : ""}>Lưu MSSV</button> <button type="button" class="btn btn-danger" data-attendance-delete-checkin="${item.id}" ${selectedAttendanceSession?.status === "finalized" ? "disabled" : ""}>Xóa</button></td></tr>`).join("");

  const totalPages = Math.max(attendancePage, Math.ceil(attendanceTotalCount / attendancePageSize), 1);
  $("#attendanceCheckinCount").textContent = attendanceTotalCount + " lượt";
  $("#attendanceDeleteAll").disabled = attendanceTotalCount === 0 || selectedAttendanceSession?.status === "finalized";
  $("#attendanceCheckinRows").innerHTML = completed.map((item, index) => `<tr><td>${Math.max(1, attendanceTotalCount - ((attendancePage - 1) * attendancePageSize + index))}</td><td>${item.photoPath || item.photoData ? `<button type="button" class="attendance-photo-link" data-attendance-view-photo="${item.id}">${safe(item.mssv)}</button>` : safe(item.mssv)}</td><td>${safe(item.name || "Không có dữ liệu")}</td><td>${safe(item.scannerName || item.scannerMssv || "")}</td><td>${safe(ts(item.checkedAt))}</td><td><button type="button" class="btn btn-small btn-danger" data-attendance-delete-checkin="${item.id}" ${selectedAttendanceSession?.status === "finalized" ? "disabled" : ""}>Xóa</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">Chưa có lượt điểm danh.</td></tr>';
  $("#attendancePageInfo").textContent = `Trang ${attendancePage}/${totalPages} · ${attendanceTotalCount} lượt`;
  $("#attendancePrev").disabled = attendancePage <= 1; $("#attendanceNext").disabled = !attendancePageHasNext;

  if (attendanceTrashLoaded) $("#attendanceTrashCount").textContent = trashed.length + " lượt";
  $("#attendanceTrashDeleteAll").disabled = !trashed.length || !highAdminAccess();
  $("#attendanceTrashRows").innerHTML = trashed.map((item) => `<tr><td>${safe(item.mssv || "Ảnh chưa nhập MSSV")}</td><td>${safe(item.name || "")}</td><td>${safe(item.deletedByEmail || item.deletedByUid || "")}</td><td><div class="actions"><button class="btn btn-small" data-attendance-restore-checkin="${item.id}" ${selectedAttendanceSession?.status === "finalized" ? "disabled" : ""}>Khôi phục</button>${highAdminAccess() ? `<button class="btn btn-small btn-danger" data-attendance-purge-checkin="${item.id}">Xóa vĩnh viễn</button>` : ""}</div></td></tr>`).join("") || '<tr><td colspan="4" class="empty">Thùng rác đang trống.</td></tr>';

  const report = attendanceReportData(), hasRoster = attendanceHasRegistrationRoster(selectedAttendanceSession);
  $("#attendanceReportSection").classList.toggle("hidden", !hasRoster);
  $("#attendanceReportContent").classList.toggle("hidden", !attendanceReportLoaded);
  $("#attendanceExportReport").classList.toggle("hidden", !attendanceReportLoaded);
  $("#attendanceLoadReport").classList.toggle("hidden", attendanceReportLoaded);
  if (hasRoster && attendanceReportLoaded) {
    $("#attendancePresentCount").textContent = report.present.length; $("#attendanceAbsentCount").textContent = report.absent.length; $("#attendanceOutsideCount").textContent = report.outside.length;
    document.querySelectorAll("[data-attendance-report-filter]").forEach((button) => button.classList.toggle("active", button.dataset.attendanceReportFilter === attendanceReportFilter));
    const reportRows = report[attendanceReportFilter] || report.present, reportPages = Math.max(1, Math.ceil(reportRows.length / attendanceReportPageSize)); attendanceReportPage = Math.min(attendanceReportPage, reportPages);
    const reportPageRows = reportRows.slice((attendanceReportPage - 1) * attendanceReportPageSize, attendanceReportPage * attendanceReportPageSize);
    const labels = { present: "Có mặt", absent: "Vắng", outside: "Ngoài danh sách" };
    $("#attendanceReportRows").innerHTML = reportPageRows.map((item) => `<tr><td><b>${safe(item.mssv)}</b></td><td>${safe(item.name || "Không có dữ liệu")}</td><td>${safe(labels[item.state])}</td></tr>`).join("") || '<tr><td colspan="3" class="empty">Không có sinh viên trong nhóm này.</td></tr>';
    $("#attendanceReportPageInfo").textContent = `Trang ${attendanceReportPage}/${reportPages} · ${reportRows.length} dòng`;
    $("#attendanceReportPrev").disabled = attendanceReportPage <= 1; $("#attendanceReportNext").disabled = attendanceReportPage >= reportPages;
  }
}

function setAttendanceManageTab(tab = "info") {
  const selected = ["info", "scanners", "checkins"].includes(tab) ? tab : "info";
  $("#attendanceManageDialog").dataset.activeTab = selected;
  document.querySelectorAll("[data-attendance-manage-tab]").forEach((button) => button.classList.toggle("active", button.dataset.attendanceManageTab === selected));
  $(".attendance-event-editor")?.classList.toggle("attendance-tab-hidden", selected !== "info");
  const scannerSection = $("#attendanceScannerForm")?.closest("section");
  scannerSection?.classList.toggle("attendance-tab-hidden", selected !== "scanners");
  ["#attendanceReportSection", "#attendancePendingSection", "#attendanceCheckinRows", "#attendanceTrashSection"].forEach((selector) => {
    const node = $(selector);
    const panel = node?.closest("section") || node;
    panel?.classList.toggle("attendance-tab-hidden", selected !== "checkins");
  });
}

async function openAttendanceManage(sessionId) {
  attendanceRosterUnsubscribe?.(); attendanceRosterUnsubscribe = null;
  selectedAttendanceSession = activeAttendanceSessionById(attendanceSessions, sessionId);
  if (!selectedAttendanceSession) return;
  attendancePage = 1; attendancePageCursors = [null]; attendanceReportPage = 1; attendanceReportFilter = "present"; attendanceReportLoaded = false; attendanceReportRowsSource = []; attendanceTrashLoaded = false; attendanceRoster = [];
  $("#attendanceManageTitle").textContent = selectedAttendanceSession.title;
  $("#attendanceManageMeta").textContent = `${attendanceTimingStatus(selectedAttendanceSession)} · ${vietnamDate(selectedAttendanceSession.date)}`;
  populateAttendanceEditForm(selectedAttendanceSession);
  $("#attendanceEnd").classList.toggle("hidden", selectedAttendanceSession.status !== "open");
  $("#attendanceFinalize").disabled = !highAdminAccess() || selectedAttendanceSession.status === "finalized";
  $("#attendanceReopen").classList.toggle("hidden", !canReopenAttendance(selectedAttendanceSession));
  $("#attendanceScannerForm").classList.toggle("hidden", selectedAttendanceSession.status !== "open");
  $("#attendanceFavoriteManageTools").classList.toggle("hidden", selectedAttendanceSession.status !== "open");
  setAttendanceManageTab("info");
  $("#attendanceManageDialog").showModal();
  await loadAttendanceManage();
}

async function loadAttendanceReport() {
  if (!selectedAttendanceSession || attendanceReportLoaded) return;
  const sessionId = selectedAttendanceSession.id, shouldLoadRoster = attendanceHasRegistrationRoster(selectedAttendanceSession);
  const [checkins, roster] = await Promise.all([
    getDocs(query(collection(db, "checkins"), where("sessionId", "==", sessionId), where("deletedAt", "==", null))),
    selectedAttendanceSession.eventId ? getDocs(query(collection(db, "registrations"), where("eventId", "==", selectedAttendanceSession.eventId))) : shouldLoadRoster ? getDocs(query(collection(db, "attendanceRoster"), where("sessionId", "==", sessionId))) : Promise.resolve({ docs: [] })
  ]);
  attendanceReportRowsSource = checkins.docs.map((item) => ({ id: item.id, ...item.data() }));
  attendanceRoster = roster.docs.map((item) => { const data = item.data(); return selectedAttendanceSession.eventId ? { ...data, mssv: String(data.identifier || data.mssv || "").trim().toUpperCase() } : data; });
  attendanceReportLoaded = true; renderAttendanceManageRows();
}

async function loadAttendanceTrash() {
  if (!selectedAttendanceSession || attendanceTrashLoaded) return;
  const snapshot = await getDocs(query(collection(db, "checkins"), where("sessionId", "==", selectedAttendanceSession.id)));
  const activeIds = new Set(attendanceManageRows.map((item) => item.id));
  attendanceManageRows.push(...snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.deletedAt && !activeIds.has(item.id)));
  attendanceTrashLoaded = true; renderAttendanceManageRows();
}
function populateAttendanceEditForm(item) {
  if (!item) return;
  $("#attendanceEditTitle").value = item.title || ""; $("#attendanceEditDate").value = vietnamDate(item.date); $("#attendanceEditEndDate").value = vietnamDate(item.endDate || item.date); $("#attendanceEditLocation").value = item.location || ""; $("#attendanceEditStartTime").value = item.startTime || ""; $("#attendanceEditEndTime").value = item.endTime || "";
  const linked = !!item.eventId; $("#attendanceEditHint").textContent = linked ? "Phiên lấy từ sự kiện đăng ký: chỉ được sửa thời gian điểm danh và danh sách SV hỗ trợ quét." : "Có thể sửa thông tin phiên điểm danh tự tạo.";
  ["#attendanceEditTitle", "#attendanceEditDate", "#attendanceEditLocation"].forEach((selector) => { $(selector).disabled = linked; });
}

function normalizeAttendanceHeader(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function attendanceRowsFromSheet(rows) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]);
  const byNames = (...names) => keys.find((key) => names.includes(normalizeAttendanceHeader(key)));
  const mssvKey = byNames("mssv", "masv", "masinhvien", "studentid", "identifier");
  const nameKey = byNames("hoten", "hovaten", "name", "fullname");
  const familyKey = byNames("holot", "hovatenlot", "ho");
  const givenKey = byNames("ten", "tensinhvien");
  const emailKey = byNames("email", "mail");
  if (!mssvKey) throw Error("Không tìm thấy cột MSSV hoặc Mã SV trong tệp.");
  const map = new Map();
  for (const row of rows) {
    const mssv = String(row[mssvKey] || "").trim().toUpperCase();
    if (!/^(?=.{8,12}$)(?=.*\d)[A-Z0-9]+$/.test(mssv)) continue;
    const name = String(nameKey ? row[nameKey] || "" : [row[familyKey], row[givenKey]].filter(Boolean).join(" ")).trim().replace(/\s+/g, " ");
    const email = String(emailKey ? row[emailKey] || "" : "").trim().toLowerCase() || mssv.toLowerCase() + "@student.tdtu.edu.vn";
    map.set(mssv, { mssv, name, email, uid: "" });
  }
  return [...map.values()];
}

async function readAttendanceRosterFile(file) {
  if (!file) return [];
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return attendanceRowsFromSheet(XLSX.utils.sheet_to_json(sheet, { defval: "" }));
}

async function readPermissionFile(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]), find = (...names) => keys.find((key) => names.includes(normalizeAttendanceHeader(key)));
  const mssvKey = find("mssv", "masv", "masinhvien", "studentid"), nameKey = find("hoten", "hovaten", "name", "fullname"), roleKey = keys.find((key) => /^(vaitro|role|quyen)/.test(normalizeAttendanceHeader(key)));
  if (!mssvKey) throw Error("File cấp quyền cần có cột MSSV.");
  return rows.map((row) => {
    const mssv = String(row[mssvKey] || "").trim().toUpperCase(), known = getFacultyStudents().find((item) => item.mssv === mssv), roleText = normalizeSearch(row[roleKey]);
    return { mssv, name: String(row[nameKey] || known?.name || "").trim(), email: known?.email || "", role: /leader|truong|nhom/.test(roleText) ? "leader" : "scanner" };
  }).filter((item) => validStudentId(item.mssv) && item.name);
}

function fillAttendanceForm(eventId = "") {
  populateAttendanceEventOptions(eventId);
  const selected = events.find((item) => item.id === eventId);
  const today = new Date().toISOString().slice(0, 10);
  $("#attendanceSourceEvent").value = selected?.id || "";
  $("#attendanceStandaloneTitle").value = selected?.title || "";
  $("#attendanceStandaloneDate").value = vietnamDate(selected?.date || today);
  $("#attendanceStandaloneEndDate").value = vietnamDate(selected?.date || today);
  $("#attendanceStandaloneLocation").value = selected?.location || "";
  $("#attendanceStandaloneStartTime").value = selected?.startTime || "";
  $("#attendanceStandaloneEndTime").value = selected?.endTime || "";
  attendancePermissionMembers = [];
  renderAttendancePermissions();
  populatePermissionCopyOptions();
  $("#attendancePermissionLookup").value = "";
  attendanceRosterImport = [];
  $("#attendanceRosterFile").value = "";
  $("#attendanceRosterFileName").textContent = "Chưa chọn tệp (không bắt buộc)";
}

function resetAttendanceCreateState() {
  selectedAttendanceSession = null;
  attendanceRosterUnsubscribe?.();
  attendanceRosterUnsubscribe = null;
  attendancePermissionMembers = [];
  attendanceRosterImport = [];
}

function openAttendanceCreate(eventId = "") {
  resetAttendanceCreateState();
  if ($("#attendanceManageDialog")?.open) $("#attendanceManageDialog").close();
  $("#attendanceCreateForm").reset();
  fillAttendanceForm(eventId);
  $("#attendanceCreateDialog").showModal();
}

async function createStandaloneAttendance() {
  const eventId = $("#attendanceSourceEvent").value;
  const title = $("#attendanceStandaloneTitle").value.trim();
  const date = parseVietnamDate($("#attendanceStandaloneDate").value);
  const endDate = parseVietnamDate($("#attendanceStandaloneEndDate").value);
  const location = $("#attendanceStandaloneLocation").value.trim();
  const startTime = $("#attendanceStandaloneStartTime").value;
  const endTime = $("#attendanceStandaloneEndTime").value;
  if (!title || !date || !endDate) throw Error("Vui lòng nhập tên, ngày tổ chức và ngày kết thúc điểm danh.");
  const startDay = new Date(date + "T12:00:00"), finishDay = new Date(endDate + "T12:00:00");
  if (finishDay < startDay) throw Error("Ngày kết thúc không được trước ngày tổ chức.");
  if ((finishDay - startDay) / 86400000 > 5) throw Error("Ngày kết thúc điểm danh tối đa 5 ngày sau ngày tổ chức.");
  if (startTime && endTime && endTime <= startTime && date === endDate) throw Error("Giờ kết thúc phải sau giờ bắt đầu.");
  if (activeAttendanceSessionForEvent(attendanceSessions, eventId)) throw Error("Sự kiện này đã có phiên điểm danh.");
  if (eventId && !attendanceSourceEligible(events.find((item) => item.id === eventId))) throw Error("Sự kiện nguồn phải thuộc khoa và đang hiển thị.");
  const sessionId = attendanceCode();
  const rosterMap = new Map();
  attendanceRosterImport.forEach((item) => {
    if (/^(?=.{8,12}$)(?=.*\d)[A-Z0-9]+$/.test(item.mssv || "")) rosterMap.set(item.mssv, { ...rosterMap.get(item.mssv), ...item });
  });
  const roster = [...rosterMap.values()];
  const hasRegistrationRoster = Boolean(eventId) || roster.length > 0;
  const permissionMembers = attendancePermissionMembers;
  const writes = [
    { ref: doc(db, "attendanceSessions", sessionId), data: { eventId, source: eventId ? "registration" : "standalone", hasRegistrationRoster, liveRegistrationRoster: Boolean(eventId), title, date, endDate, startAt: attendanceStartTimestamp(date, startTime), endAt: attendanceEndTimestamp(endDate, endTime), location, startTime, endTime, status: "open", rosterCount: eventId ? Number(events.find((item) => item.id === eventId)?.registeredCount || 0) : roster.length, checkinCount: 0, pendingCount: 0, scannerCount: permissionMembers.length, createdByUid: user.uid, createdByEmail: user.email, createdByName: user.displayName || "", createdAt: serverTimestamp() } },
    ...roster.map((item) => ({ ref: doc(db, "attendanceRoster", sessionId + "_" + item.mssv), data: { sessionId, eventId, mssv: item.mssv, name: item.name || "", email: item.email || item.mssv.toLowerCase() + "@student.tdtu.edu.vn", uid: item.uid || "", createdAt: serverTimestamp() } }))
  ];
  const assignmentWrites = permissionMembers.flatMap((item) => {
      const email = item.email || item.mssv.toLowerCase() + "@student.tdtu.edu.vn", id = sessionId + "_" + email;
      return [
        { ref: doc(db, "scannerAssignments", id), data: { sessionId, email, mssv: item.mssv, name: item.name || "", role: item.role === "leader" ? "leader" : "scanner", active: true, grantedAt: serverTimestamp() } },
        { ref: doc(db, "attendanceGrants", id), data: { sessionId, assignmentId: id, grantedAt: serverTimestamp(), grantedByEmail: user.email, grantedByName: user.displayName || user.email } }
      ];
    });
  for (let offset = 0; offset < writes.length; offset += 450) {
    const batch = writeBatch(db);
    writes.slice(offset, offset + 450).forEach((entry) => batch.set(entry.ref, entry.data));
    await batch.commit();
  }
  for (let offset = 0; offset < assignmentWrites.length; offset += 450) {
    const batch = writeBatch(db);
    assignmentWrites.slice(offset, offset + 450).forEach((entry) => batch.set(entry.ref, entry.data));
    await batch.commit();
  }
  notice(eventId ? `Đã tạo điểm danh dùng chung danh sách đăng ký và cấp quyền cho ${permissionMembers.length} tài khoản.` : `Đã tạo điểm danh với ${roster.length} sinh viên và ${permissionMembers.length} tài khoản được cấp quyền.`, "success");
  await audit("attendance.create", "attendanceSession", sessionId, { title, scannerCount: permissionMembers.length, rosterCount: roster.length });
  showPane("attendance");
}

$("#attendanceCreateForm").onsubmit = async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  try {
    await createStandaloneAttendance();
    event.target.reset();
    $("#attendanceCreateDialog").close();
  } catch (error) {
    notice(error.message || "Không thể tạo điểm danh.", "error");
  } finally {
    if (submit) submit.disabled = false;
  }
};

$("#attendanceCreateDialog").addEventListener("close", resetAttendanceCreateState);

$("#attendanceSourceEvent").onchange = (event) => {
  const selected = events.find((item) => item.id === event.target.value);
  if (!selected) return;
  $("#attendanceStandaloneTitle").value = selected.title || "";
  $("#attendanceStandaloneDate").value = vietnamDate(selected.date);
  $("#attendanceStandaloneEndDate").value = vietnamDate(selected.date);
  $("#attendanceStandaloneLocation").value = selected.location || "";
  $("#attendanceStandaloneStartTime").value = selected.startTime || "";
  $("#attendanceStandaloneEndTime").value = selected.endTime || "";
};

$("#attendanceRosterFile").onchange = async (event) => {
  const file = event.target.files?.[0];
  attendanceRosterImport = [];
  $("#attendanceRosterFileName").textContent = file ? "Đang đọc " + file.name + "…" : "Chưa chọn tệp (không bắt buộc)";
  if (!file) return;
  try {
    attendanceRosterImport = await readAttendanceRosterFile(file);
    $("#attendanceRosterFileName").textContent = `${file.name} · ${attendanceRosterImport.length} sinh viên`;
  } catch (error) {
    event.target.value = "";
    $("#attendanceRosterFileName").textContent = "Không đọc được tệp";
    notice(error.message, "error");
  }
};

async function resolvePermissionStudent(value) {
  const key = String(value || "").trim().toUpperCase();
  if (validStudentId(key)) {
    const snap = await getDoc(doc(db, "facultyStudents", key));
    return snap.exists() ? studentRecord({ ...snap.data(), mssv: snap.id }) : studentRecord({ mssv: key, name: "Không có dữ liệu" });
  }
  return resolveFacultyStudent(value);
}
$("#attendancePermissionAdd").onclick = async () => {
  const student = await resolvePermissionStudent($("#attendancePermissionLookup").value);
  if (!student) {
    return notice("MSSV không hợp lệ; cần 8–12 chữ hoặc số.", "error");
  }
  mergeAttendancePermissions([{ ...student, role: $("#attendancePermissionRole").value }]);
  $("#attendancePermissionLookup").value = "";
};
$("#attendancePermissionRows").onclick = (event) => {
  const button = event.target.closest("[data-remove-attendance-permission]");
  if (!button) return;
  attendancePermissionMembers = attendancePermissionMembers.filter((item) => item.mssv !== button.dataset.removeAttendancePermission);
  renderAttendancePermissions();
};
$("#attendancePermissionRows").onchange = (event) => {
  const select = event.target.closest("[data-attendance-role]"); if (!select) return;
  const item = attendancePermissionMembers.find((value) => value.mssv === select.dataset.attendanceRole); if (item) { item.role = select.value === "leader" ? "leader" : "scanner"; renderAttendancePermissions(); }
};
$("#attendanceCopyPermissions").onclick = async () => {
  const sessionId = $("#attendanceCopyPermissionsFrom").value;
  if (!sessionId) return notice("Vui lòng chọn sự kiện cần copy danh sách cấp quyền.", "error");
  const snapshot = await getDocs(query(collection(db, "scannerAssignments"), where("sessionId", "==", sessionId)));
  mergeAttendancePermissions(snapshot.docs.map((item) => item.data()));
  notice(`Đã copy ${snapshot.size} sinh viên được cấp quyền.`, "success");
};
$("#attendancePermissionFile").onchange = async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try { const rows = await readPermissionFile(file); mergeAttendancePermissions(rows); notice(`Đã nhập ${rows.length} sinh viên được cấp quyền.`, "success"); }
  catch (error) { notice(error.message, "error"); }
  event.target.value = "";
};
$("#attendancePermissionTemplate").onclick = () => downloadWorkbook("MAU_DANH_SACH_CAP_QUYEN_QUET.xlsx", "Cap quyen quet", [{ MSSV: "12300325", "Họ và tên": "Nguyễn Văn A", "Vai trò (scanner/leader)": "scanner" }, { MSSV: "12300326", "Họ và tên": "Trần Văn B", "Vai trò (scanner/leader)": "leader" }]);
$("#attendancePermissionFavoriteSave").onclick = () => saveFavoriteScannerFrom("#attendancePermissionLookup", "#attendancePermissionRole").catch((error) => notice(error.message, "error"));
$("#attendanceScannerFavoriteSave").onclick = () => saveFavoriteScannerFrom("#attendanceScannerLookup", "#attendanceScannerRole").catch((error) => notice(error.message, "error"));

document.addEventListener("change", (event) => {
  const role = event.target.closest("[data-favorite-scanner-role]");
  if (!role) return;
  const item = favoriteScannerStudents.find((value) => value.mssv === role.dataset.favoriteScannerRole);
  if (!item) return;
  item.role = role.value === "leader" ? "leader" : "scanner";
  saveFavoriteScanners(`Đã đổi vai trò mặc định của ${item.mssv}.`).catch((error) => notice(error.message, "error"));
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const target = button.dataset.favoriteTarget || button.dataset.favoriteSelectAll || button.dataset.favoriteClearSelection || button.dataset.favoriteAddSelected || button.dataset.favoriteAddAll;
  if (button.dataset.favoriteSelectAll) {
    document.querySelectorAll(`[data-favorite-scanner-check="${target}"]`).forEach((input) => { input.checked = true; });
  } else if (button.dataset.favoriteClearSelection) {
    document.querySelectorAll(`[data-favorite-scanner-check="${target}"]`).forEach((input) => { input.checked = false; });
  } else if (button.dataset.favoriteAddOne) {
    const item = favoriteScannerStudents.find((value) => value.mssv === button.dataset.favoriteAddOne);
    addFavoriteScannersToTarget(target, item ? [item] : []).catch((error) => notice(error.message, "error"));
  } else if (button.dataset.favoriteAddSelected) {
    addFavoriteScannersToTarget(target, selectedFavoriteScanners(target)).catch((error) => notice(error.message, "error"));
  } else if (button.dataset.favoriteAddAll) {
    addFavoriteScannersToTarget(target, favoriteScannerStudents).catch((error) => notice(error.message, "error"));
  } else if (button.dataset.favoriteRemove) {
    favoriteScannerStudents = favoriteScannerStudents.filter((item) => item.mssv !== button.dataset.favoriteRemove);
    saveFavoriteScanners(`Đã xóa ${button.dataset.favoriteRemove} khỏi danh sách yêu thích.`).catch((error) => notice(error.message, "error"));
  }
});

async function resolveAttendanceStudent(rawMssv) {
  const mssv = String(rawMssv || "").trim().toUpperCase();
  const rosterStudent = attendanceRoster.find((item) => String(item.mssv).toUpperCase() === mssv);
  if (rosterStudent) return rosterStudent;
  const snapshot = await getDoc(doc(db, "facultyStudents", mssv));
  return snapshot.exists() ? { mssv, ...snapshot.data() } : { mssv, name: "Không có dữ liệu", email: mssv.toLowerCase() + "@student.tdtu.edu.vn", uid: "" };
}

async function labelPendingAttendancePhoto(id, rawMssv) {
  const mssv = String(rawMssv || "").trim().toUpperCase();
  if (!/^(?=.{8,12}$)(?=.*\d)[A-Z0-9]+$/.test(mssv)) throw Error("MSSV không hợp lệ; cần 8–12 chữ hoặc số.");
  const student = await resolveAttendanceStudent(mssv);
  const sessionId = selectedAttendanceSession.id;
  const canonicalId = sessionId + "_" + mssv;
  let result;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const legacy = await getDocs(query(collection(db, "checkins"), where("sessionId", "==", sessionId), where("mssv", "==", mssv)));
    const activeLegacy = legacy.docs.find((item) => item.id !== canonicalId && item.id !== id && !item.data().deletedAt);
    if (activeLegacy) throw Error(`MSSV ${mssv} đã có trong dữ liệu điểm danh cũ (${activeLegacy.id}).`);
    const canonicalSnapshot = legacy.docs.find((item) => item.id === canonicalId) || null;
    try {
      result = await runTransaction(db, async (transaction) => {
    const pendingRef = doc(db, "checkins", id);
    const canonicalRef = doc(db, "checkins", canonicalId);
    const sessionRef = doc(db, "attendanceSessions", sessionId);
    const [pendingSnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(pendingRef), transaction.get(sessionRef)
    ]);
    if (!pendingSnapshot.exists() || pendingSnapshot.data().deletedAt) throw Error("Ảnh chờ không còn hoạt động.");
    if (pendingSnapshot.data().mssv) throw Error("Ảnh này đã được gắn MSSV.");
    if (!sessionSnapshot.exists()) throw Error("Phiên điểm danh không còn tồn tại.");
    const canonicalActive = Boolean(canonicalSnapshot && !canonicalSnapshot.data().deletedAt);
    const pending = pendingSnapshot.data();
    if (!canonicalActive) {
      transaction.set(canonicalRef, {
        ...pending,
        mssv,
        name: student.name || "Không có dữ liệu",
        email: student.email || "",
        studentUid: student.uid || "",
        deletedAt: null,
        deletedByUid: "",
        deletedByEmail: ""
      });
    }
    const sourceUpdate = { deletedAt: serverTimestamp(), deletedByUid: user.uid, deletedByEmail: user.email };
    if (!canonicalActive) Object.assign(sourceUpdate, { photoPath: deleteField(), photoUrl: deleteField(), photoData: deleteField() });
    transaction.update(pendingRef, sourceUpdate);
    const counters = sessionSnapshot.data();
    transaction.update(sessionRef, {
      checkinCount: Number(counters.checkinCount || 0) + (canonicalActive ? 0 : 1),
      pendingCount: Math.max(0, Number(counters.pendingCount || 0) - 1),
      counterMutationId: canonicalId,
      counterSourceId: id,
      updatedAt: serverTimestamp()
    });
    return { canonicalActive, name: canonicalActive ? canonicalSnapshot.data().name || "" : student.name || "" };
      });
      break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  notice(result.canonicalActive
    ? `${mssv} đã điểm danh; ảnh chờ đã được đóng mà không tăng bộ đếm.`
    : `Đã lưu ${mssv} · ${result.name || "Không có dữ liệu"}.`,
  result.canonicalActive ? "warn" : "success");
  await loadAttendanceManage();
}

async function openAttendanceImage(id) {
  const item = attendanceManageRows.find((row) => row.id === id);
  if (!item?.photoPath && !item?.photoUrl && !item?.photoData) return notice("Không tìm thấy hình điểm danh.", "error");
  const dialog = $("#attendanceImageDialog"), image = $("#attendanceViewerImage"), status = $("#attendanceImageStatus");
  attendanceViewerCheckinId = id;
  $("#attendanceImageMssv").value = item.mssv || "";
  $("#attendanceImageMssvField").classList.toggle("hidden", Boolean(item.mssv) || selectedAttendanceSession?.status === "finalized");
  if (!dialog.open) dialog.showModal();
  image.removeAttribute("src"); status.textContent = "Đang tải hình…"; status.classList.remove("hidden");
  try {
    let source = item.photoUrl || item.photoData || "";
    if (!source && item.photoPath) {
      const photoRef = ref(storage, item.photoPath);
      try {
        source = await getDownloadURL(photoRef);
        item.photoUrl = source;
        await updateDoc(doc(db, "checkins", item.id), { photoUrl: source });
      } catch (urlError) {
        try {
          const bytes = await getBytes(photoRef, 1.5 * 1024 * 1024);
          if (attendanceViewerObjectUrl) URL.revokeObjectURL(attendanceViewerObjectUrl);
          attendanceViewerObjectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })); source = attendanceViewerObjectUrl;
        } catch { throw urlError; }
      }
    }
    attendanceViewerScale = 1; image.style.width = "100%";
    image.onload = () => status.classList.add("hidden");
    image.onerror = () => { status.textContent = "Trình duyệt không hiển thị được tệp hình này."; status.classList.remove("hidden"); };
    image.src = source;
  } catch (error) {
    status.textContent = "Không tải được hình: " + (error.message || "Storage từ chối truy cập.");
    notice("Không tải được hình: " + (error.message || "Vui lòng kiểm tra quyền Storage."), "error");
  }
}
function setAttendanceImageScale(value) {
  attendanceViewerScale = Math.min(3, Math.max(.5, value)); $("#attendanceViewerImage").style.width = `${attendanceViewerScale * 100}%`;
}
$("#attendanceScannerForm").onsubmit = async (event) => {
  event.preventDefault();
  const raw = $("#attendanceScannerLookup").value.trim();
  const keyword = raw.toLocaleLowerCase("vi");
  const student = attendanceRoster.find((item) => String(item.mssv || "").toLocaleLowerCase("vi") === keyword || String(item.name || "").toLocaleLowerCase("vi") === keyword) || await resolvePermissionStudent(raw);
  if (!student) return notice("MSSV không hợp lệ; cần 8–12 chữ hoặc số.", "error");
  const email = student.email || student.mssv.toLowerCase() + "@student.tdtu.edu.vn";
  const assignmentId = selectedAttendanceSession.id + "_" + email;
  await setDoc(doc(db, "scannerAssignments", assignmentId), { sessionId: selectedAttendanceSession.id, email, mssv: student.mssv, name: student.name, role: $("#attendanceScannerRole").value, active: true, grantedAt: serverTimestamp() });
  await setDoc(doc(db, "attendanceGrants", assignmentId), { sessionId: selectedAttendanceSession.id, assignmentId, grantedAt: serverTimestamp(), grantedByEmail: user.email, grantedByName: user.displayName || user.email });
  const scannerCount = (await getCountFromServer(query(collection(db, "scannerAssignments"), where("sessionId", "==", selectedAttendanceSession.id)))).data().count;
  await updateDoc(doc(db, "attendanceSessions", selectedAttendanceSession.id), { scannerCount, updatedAt: serverTimestamp() });
  await audit("scanner.grant", "attendanceSession", selectedAttendanceSession.id, { mssv: student.mssv, role: $("#attendanceScannerRole").value });
  $("#attendanceScannerLookup").value = "";
  await loadAttendanceManage();
  notice("Đã cấp quyền quét.", "success");
};

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "newAttendanceBtn") {
    openAttendanceCreate();
  }
  if (button.dataset.closeAttendanceCreate !== undefined) $("#attendanceCreateDialog").close();
  if (button.dataset.closeAttendanceManage !== undefined) { attendanceRosterUnsubscribe?.(); attendanceRosterUnsubscribe = null; $("#attendanceManageDialog").close(); }
  if (button.dataset.closeAttendanceImage !== undefined) { $("#attendanceImageDialog").close(); attendanceViewerCheckinId = ""; if (attendanceViewerObjectUrl) { URL.revokeObjectURL(attendanceViewerObjectUrl); attendanceViewerObjectUrl = ""; } }
  if (button.dataset.attendanceFilter) {
    attendanceFilter = button.dataset.attendanceFilter;
    document.querySelectorAll(".attendance-filter").forEach((item) => item.classList.toggle("active", item === button));
    renderAttendance();
  }
  if (button.dataset.attendanceView) {
    attendanceView = button.dataset.attendanceView === "list" ? "list" : "cards";
    localStorage.setItem("ifaa-attendance-view", attendanceView);
    renderAttendance();
  }
  if (button.dataset.attendanceEvent) {
    const existing = activeAttendanceSessionForEvent(attendanceSessions, button.dataset.attendanceEvent);
    if (existing) await openAttendanceManage(existing.id);
    else {
      const sourceEvent = events.find((item) => item.id === button.dataset.attendanceEvent);
      if (!attendanceSourceEligible(sourceEvent)) return notice("Chỉ tạo điểm danh từ sự kiện của khoa đang hiển thị.", "error");
      openAttendanceCreate(button.dataset.attendanceEvent);
    }
  }
  if (button.dataset.attendanceManage) await openAttendanceManage(button.dataset.attendanceManage);
  if (button.dataset.attendanceManageTab) setAttendanceManageTab(button.dataset.attendanceManageTab);
  if (button.dataset.attendanceOpenPending) {
    await openAttendanceManage(button.dataset.attendanceOpenPending);
    setAttendanceManageTab("checkins");
    $("#attendancePendingSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (button.dataset.attendanceCopy) await copyAttendanceLink(button.dataset.attendanceCopy);
  if (button.dataset.attendanceQuickExport) await quickExportAttendance(button.dataset.attendanceQuickExport, button);
  if (button.dataset.attendanceReportFilter) { attendanceReportFilter = button.dataset.attendanceReportFilter; attendanceReportPage = 1; renderAttendanceManageRows(); }
  if (button.dataset.attendanceViewPhoto) await openAttendanceImage(button.dataset.attendanceViewPhoto);
  if (button.dataset.attendanceLabelPhoto) {
    const id = button.dataset.attendanceLabelPhoto, input = document.querySelector(`[data-attendance-pending-input="${CSS.escape(id)}"]`), mssv = input?.value.trim().toUpperCase() || "";
    try { await labelPendingAttendancePhoto(id, mssv); }
    catch (error) { notice(error.message, "error"); }
  }
  if (button.dataset.saveScannerFavorite) {
    const row = button.closest("tr");
    const mssv = row?.cells?.[0]?.textContent?.trim() || "";
    const name = row?.cells?.[1]?.textContent?.trim() || "Không có dữ liệu";
    const role = row?.querySelector("[data-attendance-assignment-role]")?.value || "scanner";
    if (mssv) {
      const map = new Map(favoriteScannerStudents.map((item) => [item.mssv, item]));
      map.set(mssv, normalizeFavoriteScanner({ mssv, name, role }));
      favoriteScannerStudents = [...map.values()];
      await saveFavoriteScanners(`Đã lưu ${mssv} vào danh sách SV hỗ trợ yêu thích.`);
    }
  }
  if (button.dataset.attendanceDeleteCheckin) {
    const item = attendanceManageRows.find((row) => row.id === button.dataset.attendanceDeleteCheckin); if (!item || selectedAttendanceSession.status === "finalized") return;
    await runTransaction(db, async (transaction) => {
      const checkinRef = doc(db, "checkins", item.id), sessionRef = doc(db, "attendanceSessions", selectedAttendanceSession.id);
      const [checkinSnapshot, sessionSnapshot] = await Promise.all([transaction.get(checkinRef), transaction.get(sessionRef)]);
      if (!checkinSnapshot.exists() || checkinSnapshot.data().deletedAt || !sessionSnapshot.exists()) return;
      const liveCheckin = checkinSnapshot.data(), counters = sessionSnapshot.data();
      transaction.update(checkinRef, { deletedAt: serverTimestamp(), deletedByUid: user.uid, deletedByEmail: user.email });
      transaction.update(sessionRef, liveCheckin.mssv
        ? { checkinCount: Math.max(0, Number(counters.checkinCount || 0) - 1), pendingCount: Number(counters.pendingCount || 0), counterMutationId: item.id, updatedAt: serverTimestamp() }
        : { checkinCount: Number(counters.checkinCount || 0), pendingCount: Math.max(0, Number(counters.pendingCount || 0) - 1), counterMutationId: item.id, updatedAt: serverTimestamp() });
    });
    await audit("checkin.trash", "checkin", item.id, { sessionId: selectedAttendanceSession.id, mssv: item.mssv || "" }); notice("Đã chuyển lượt điểm danh vào thùng rác.", "success"); await loadAttendanceManage();
  }
  if (button.dataset.attendanceRestoreCheckin) {
    const item = attendanceManageRows.find((row) => row.id === button.dataset.attendanceRestoreCheckin); if (!item || selectedAttendanceSession.status === "finalized") return;
    await runTransaction(db, async (transaction) => {
      const checkinRef = doc(db, "checkins", item.id), sessionRef = doc(db, "attendanceSessions", selectedAttendanceSession.id);
      const [checkinSnapshot, sessionSnapshot] = await Promise.all([transaction.get(checkinRef), transaction.get(sessionRef)]);
      if (!checkinSnapshot.exists() || !checkinSnapshot.data().deletedAt || !sessionSnapshot.exists()) return;
      const liveCheckin = checkinSnapshot.data(), counters = sessionSnapshot.data();
      transaction.update(checkinRef, { deletedAt: null, deletedByUid: "", deletedByEmail: "" });
      transaction.update(sessionRef, liveCheckin.mssv
        ? { checkinCount: Number(counters.checkinCount || 0) + 1, pendingCount: Number(counters.pendingCount || 0), counterMutationId: item.id, updatedAt: serverTimestamp() }
        : { checkinCount: Number(counters.checkinCount || 0), pendingCount: Number(counters.pendingCount || 0) + 1, counterMutationId: item.id, updatedAt: serverTimestamp() });
    });
    await audit("checkin.restore", "checkin", item.id, { sessionId: selectedAttendanceSession.id, mssv: item.mssv || "" }); notice("Đã khôi phục lượt điểm danh.", "success"); await loadAttendanceManage();
  }
  if (button.dataset.attendancePurgeCheckin) {
    const item = attendanceManageRows.find((row) => row.id === button.dataset.attendancePurgeCheckin); if (!item?.deletedAt || !highAdminAccess()) return;
    if (!(await confirmAction({ title: "Xóa vĩnh viễn lượt điểm danh?", message: `Dữ liệu ${item.mssv || "ảnh chưa nhập MSSV"} sẽ bị xóa hoàn toàn.`, verification: "XÓA" }))) return;
    await deleteAttendancePhoto(item); await deleteDoc(doc(db, "checkins", item.id)); await audit("checkin.purge", "checkin", item.id, { sessionId: selectedAttendanceSession.id, mssv: item.mssv || "" }); notice("Đã xóa vĩnh viễn lượt điểm danh.", "success"); attendanceTrashLoaded = false; await loadAttendanceTrash();
  }
  if (button.dataset.deleteAttendance) {
    const selected = attendanceSessions.find((item) => item.id === button.dataset.deleteAttendance);
    if (!selected || (isSubAdmin && selected.createdByUid !== user.uid)) return notice("Bạn không có quyền xóa phiên điểm danh này.", "error");
    if (!(await confirmAction({ title: "Đưa điểm danh vào thùng rác?", message: "Phiên điểm danh sẽ được giữ 30 ngày. Nhập XÓA để tiếp tục.", verification: "XÓA" }))) return;
    await updateDoc(doc(db, "attendanceSessions", selected.id), { deletedAt: serverTimestamp(), deletedByUid: user.uid, deletedByEmail: user.email });
    if (selectedAttendanceSession?.id === selected.id) {
      selectedAttendanceSession = null;
      attendanceRosterUnsubscribe?.(); attendanceRosterUnsubscribe = null;
      if ($("#attendanceManageDialog")?.open) $("#attendanceManageDialog").close();
    }
    await audit("attendance.trash", "attendanceSession", selected.id, { title: selected.title || "" });
    notice("Đã đưa phiên điểm danh vào thùng rác.", "success");
  }
  if (button.dataset.restoreAttendance) {
    const selected = attendanceSessions.find((item) => item.id === button.dataset.restoreAttendance); if (!selected || !highAdminAccess()) return;
    await updateDoc(doc(db, "attendanceSessions", selected.id), { deletedAt: null, deletedByUid: "", deletedByEmail: "" }); notice("Đã khôi phục phiên điểm danh.", "success");
  }
  if (button.dataset.purgeAttendance) {
    const selected = attendanceSessions.find((item) => item.id === button.dataset.purgeAttendance); if (!selected || !highAdminAccess()) return;
    if (!(await confirmAction({ title: "Xóa vĩnh viễn?", message: "Toàn bộ dữ liệu điểm danh và danh sách liên quan sẽ bị xóa không thể khôi phục.", verification: "XÓA" }))) return;
    await permanentlyDeleteAttendance(selected); notice("Đã xóa vĩnh viễn phiên điểm danh.", "success");
  }
  if (button.dataset.attendanceRemoveScanner) {
    await deleteDoc(doc(db, "scannerAssignments", button.dataset.attendanceRemoveScanner));
    if (highAdminAccess()) await deleteDoc(doc(db, "attendanceGrants", button.dataset.attendanceRemoveScanner));
    const scannerCount = (await getCountFromServer(query(collection(db, "scannerAssignments"), where("sessionId", "==", selectedAttendanceSession.id)))).data().count;
    await updateDoc(doc(db, "attendanceSessions", selectedAttendanceSession.id), { scannerCount, updatedAt: serverTimestamp() });
    await audit("scanner.remove", "attendanceSession", selectedAttendanceSession.id, { assignmentId: button.dataset.attendanceRemoveScanner });
    await loadAttendanceManage();
  }
});

$("#attendanceCopyLink").onclick = async () => {
  await copyAttendanceLink(selectedAttendanceSession.id);
};
$("#attendancePrev").onclick = async () => { if (attendancePage > 1) { attendancePage -= 1; await loadAttendanceManage(); } };
$("#attendanceNext").onclick = async () => { if (attendancePageHasNext) { attendancePage += 1; await loadAttendanceManage(); } };
$("#attendancePageSize").onchange = async (event) => { attendancePageSize = Number(event.target.value || 10); attendancePage = 1; attendancePageCursors = [null]; await loadAttendanceManage(); };
$("#attendanceLoadReport").onclick = async () => { $("#attendanceLoadReport").disabled = true; try { await loadAttendanceReport(); } finally { $("#attendanceLoadReport").disabled = false; } };
$("#attendanceTrashSection").addEventListener("toggle", () => { if ($("#attendanceTrashSection").open) void loadAttendanceTrash(); });
$("#attendanceReportPrev").onclick = () => { if (attendanceReportPage > 1) { attendanceReportPage -= 1; renderAttendanceManageRows(); } };
$("#attendanceReportNext").onclick = () => { attendanceReportPage += 1; renderAttendanceManageRows(); };
$("#attendanceReportPageSize").onchange = (event) => { attendanceReportPageSize = Number(event.target.value || 10); attendanceReportPage = 1; renderAttendanceManageRows(); };
$("#attendanceExportExcel").onclick = async (event) => quickExportAttendance(selectedAttendanceSession.id, event.currentTarget);
$("#attendanceExportReport").onclick = () => {
  const report = attendanceReportData(), labels = { present: "Có mặt", absent: "Vắng", outside: "Ngoài danh sách" };
  const rows = [...report.present, ...report.absent, ...report.outside].map((item, index) => ({ STT: index + 1, MSSV: item.mssv, "Họ và tên": item.name || "Không có dữ liệu", "Đối chiếu": labels[item.state] }));
  downloadWorkbook(`DOI_CHIEU_${shareCode(selectedAttendanceSession?.title)}.xlsx`, "Doi chieu", rows);
};
$("#attendanceDeleteAll").onclick = async () => {
  if (selectedAttendanceSession?.status === "finalized") return;
  const snapshot = await getDocs(query(collection(db, "checkins"), where("sessionId", "==", selectedAttendanceSession.id), where("deletedAt", "==", null)));
  const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); if (!rows.length) return;
  if (!(await confirmAction({ title: "Xóa toàn bộ lượt điểm danh?", message: `${rows.length} lượt sẽ chuyển vào thùng rác và có thể khôi phục. Nhập XÓA để tiếp tục.`, verification: "XÓA" }))) return;
  let deleted = 0, skipped = 0;
  const failed = [];
  for (const item of rows) {
    try {
      const changed = await runTransaction(db, async (transaction) => {
        const checkinRef = doc(db, "checkins", item.id);
        const sessionRef = doc(db, "attendanceSessions", selectedAttendanceSession.id);
        const [checkinSnapshot, sessionSnapshot] = await Promise.all([transaction.get(checkinRef), transaction.get(sessionRef)]);
        if (!checkinSnapshot.exists() || checkinSnapshot.data().deletedAt || !sessionSnapshot.exists()) return false;
        const liveCheckin = checkinSnapshot.data();
        const counters = sessionSnapshot.data();
        transaction.update(checkinRef, { deletedAt: serverTimestamp(), deletedByUid: user.uid, deletedByEmail: user.email });
        transaction.update(sessionRef, liveCheckin.mssv
          ? { checkinCount: Math.max(0, Number(counters.checkinCount || 0) - 1), counterMutationId: item.id, updatedAt: serverTimestamp() }
          : { pendingCount: Math.max(0, Number(counters.pendingCount || 0) - 1), counterMutationId: item.id, updatedAt: serverTimestamp() });
        return true;
      });
      if (changed) deleted += 1; else skipped += 1;
    } catch (error) {
      failed.push({ id: item.id, error: String(error.message || error) });
    }
  }
  await audit("checkin.trash_all", "attendanceSession", selectedAttendanceSession.id, { requested: rows.length, deleted, skipped, failed: failed.slice(0, 20) });
  if (failed.length) notice(`Đã chuyển ${deleted}/${rows.length} lượt vào thùng rác; ${failed.length} lượt lỗi, ${skipped} lượt đã thay đổi trước đó. Hãy tải lại và thử lại các lượt còn lại.`, "error");
  else if (skipped) notice(`Đã chuyển ${deleted} lượt vào thùng rác; bỏ qua ${skipped} lượt đã được xử lý đồng thời.`, "warn");
  else notice(`Đã chuyển toàn bộ ${deleted} lượt điểm danh vào thùng rác.`, "success");
  await loadAttendanceManage();
};
$("#attendanceTrashDeleteAll").onclick = async () => {
  const rows = attendanceManageRows.filter((item) => item.deletedAt); if (!rows.length || !highAdminAccess()) return;
  if (!(await confirmAction({ title: "Xóa vĩnh viễn toàn bộ thùng rác?", message: `${rows.length} lượt điểm danh sẽ bị xóa hoàn toàn và không thể khôi phục.`, verification: "XÓA" }))) return;
  await Promise.all(rows.map((item) => deleteAttendancePhoto(item)));
  for (let offset = 0; offset < rows.length; offset += 450) { const batch = writeBatch(db); rows.slice(offset, offset + 450).forEach((item) => batch.delete(doc(db, "checkins", item.id))); await batch.commit(); }
  await audit("checkin.purge_all", "attendanceSession", selectedAttendanceSession.id, { count: rows.length }); notice("Đã xóa vĩnh viễn toàn bộ lượt trong thùng rác.", "success"); attendanceTrashLoaded = false; await loadAttendanceTrash();
};
$("#attendanceImageZoomOut").onclick = () => setAttendanceImageScale(attendanceViewerScale - .25);
$("#attendanceImageZoomReset").onclick = () => setAttendanceImageScale(1);
$("#attendanceImageZoomIn").onclick = () => setAttendanceImageScale(attendanceViewerScale + .25);
$("#attendanceImageSaveMssv").onclick = async () => {
  if (!attendanceViewerCheckinId) return;
  const button = $("#attendanceImageSaveMssv");
  button.disabled = true;
  try {
    await labelPendingAttendancePhoto(attendanceViewerCheckinId, $("#attendanceImageMssv").value);
    $("#attendanceImageDialog").close();
    attendanceViewerCheckinId = "";
  } catch (error) { notice(error.message, "error"); }
  finally { button.disabled = false; }
};
$("#attendanceEditForm").onsubmit = async (event) => {
  event.preventDefault(); const item = selectedAttendanceSession; if (!item || (isSubAdmin && item.createdByUid !== user.uid)) return notice("Bạn không có quyền chỉnh sửa phiên điểm danh này.", "error");
  const id = item.id;
  const date = parseVietnamDate($("#attendanceEditDate").value), endDate = parseVietnamDate($("#attendanceEditEndDate").value); if (!date || !endDate) return notice("Ngày không hợp lệ. Vui lòng nhập theo dạng ngày/tháng/năm.", "error"); if (endDate < date) return notice("Ngày kết thúc không được trước ngày tổ chức.", "error");
  const endTime = $("#attendanceEditEndTime").value;
  const startTime = $("#attendanceEditStartTime").value;
  const update = { date, endDate, startTime, endTime, startAt: attendanceStartTimestamp(date, startTime), endAt: attendanceEndTimestamp(endDate, endTime), updatedAt: serverTimestamp() };
  if (!item.eventId) { update.title = $("#attendanceEditTitle").value.trim(); update.location = $("#attendanceEditLocation").value.trim(); }
  await updateDoc(doc(db, "attendanceSessions", id), update);
  await audit("attendance.update", "attendanceSession", id, { title: item.title || "" });
  Object.assign(item, update); $("#attendanceManageTitle").textContent = item.title; $("#attendanceManageMeta").textContent = `${attendanceTimingStatus(item)} · ${vietnamDate(item.date)}`;
  notice(endTime ? "Đã lưu. Điểm danh sẽ tự đóng sau giờ kết thúc 30 phút." : "Đã lưu thay đổi phiên điểm danh.", "success");
};
$("#attendanceEnd").onclick = async () => {
  const approved = await confirmAction({ title: "Kết thúc sự kiện?", message: "Sau khi kết thúc, sinh viên sẽ không thể quét thêm. Chủ sở hữu/Admin cấp cao luôn có thể mở lại; Sub-admin có 5 ngày để mở lại sự kiện do mình tạo." });
  if (!approved) return;
  await updateDoc(doc(db, "attendanceSessions", selectedAttendanceSession.id), { status: "ended", endedAt: serverTimestamp(), endedByUid: user.uid, endedByEmail: user.email });
  await audit("attendance.end", "attendanceSession", selectedAttendanceSession.id, { title: selectedAttendanceSession.title || "" });
  $("#attendanceManageDialog").close();
};
$("#attendanceFinalize").onclick = async () => {
  const approved = await confirmAction({ title: "Chốt danh sách điểm danh?", message: "Sau khi chốt sẽ không thể chỉnh sửa danh sách. Bạn có chắc muốn tiếp tục?" });
  if (!approved) return;
  await updateDoc(doc(db, "attendanceSessions", selectedAttendanceSession.id), { status: "finalized", finalizedAt: serverTimestamp(), finalizedBy: user.email });
  await audit("attendance.finalize", "attendanceSession", selectedAttendanceSession.id, { title: selectedAttendanceSession.title || "" });
  $("#attendanceManageDialog").close();
};
$("#attendanceReopen").onclick = async () => {
  if (!canReopenAttendance(selectedAttendanceSession)) return notice("Bạn không còn quyền mở lại sự kiện này.", "error");
  const update = { status: "open", endedAt: null, endedByUid: "", endedByEmail: "", finalizedAt: null, finalizedBy: "", reopenedAt: serverTimestamp(), reopenedBy: user.email };
  if ((millis(selectedAttendanceSession.endAt) || 0) <= Date.now()) {
    const now = new Date(), local = new Date(now.getTime() - now.getTimezoneOffset() * 60000), endDate = local.toISOString().slice(0, 10);
    update.endDate = endDate;
    update.endAt = Timestamp.fromDate(new Date(endDate + "T23:59:59"));
  }
  await updateDoc(doc(db, "attendanceSessions", selectedAttendanceSession.id), update);
  await audit("attendance.reopen", "attendanceSession", selectedAttendanceSession.id, { title: selectedAttendanceSession.title || "" });
  $("#attendanceManageDialog").close();
};

function showAdminLoginNotice(message = "") {
  const box = $("#adminLoginNotice");
  const text = $("#adminLoginNoticeText");
  if (!box || !text) return;
  text.textContent = message;
  box.classList.toggle("hidden", !message);
}

$("#loginBtn").onclick = async () => {
  showAdminLoginNotice();
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (["auth/popup-blocked", "auth/popup-timeout", "auth/operation-not-supported-in-this-environment"].includes(error?.code)) {
      showAdminLoginNotice("Trình duyệt đang chặn cửa sổ Google. Hệ thống đang chuyển sang trang đăng nhập an toàn…");
      try { await signInWithRedirect(auth, provider); }
      catch (redirectError) { showAdminLoginNotice(`Không thể chuyển trang đăng nhập: ${redirectError?.message || error.message}`); }
      return;
    }
    if (error?.code === "auth/unauthorized-domain") {
      showAdminLoginNotice("Tên miền hiện tại chưa được thêm vào Firebase Authorized domains.");
      return;
    }
    if (error?.code !== "auth/popup-closed-by-user" && error?.code !== "auth/cancelled-popup-request") {
      const code = error?.code || "auth/unknown";
      showAdminLoginNotice(`Lỗi đăng nhập (${code}): ${error?.message || "Không xác định được nguyên nhân."}`);
    }
  }
};
$("#logoutBtn").onclick = () => signOut(auth);

getRedirectResult(auth).catch((error) => {
  if (error?.code === "auth/unauthorized-domain") showAdminLoginNotice("Tên miền hiện tại chưa được thêm vào Firebase Authorized domains.");
  else if (error?.code && error.code !== "auth/popup-closed-by-user") showAdminLoginNotice(`Không thể hoàn tất đăng nhập: ${error.message || error.code}`);
});

onAuthStateChanged(auth, async (currentUser) => {
  if (!currentUser) {
    $("#adminLogin").classList.remove("hidden");
    $("#adminApp").classList.add("hidden");
    return;
  }
  const resolvedRole = currentUser.emailVerified ? await accessRole(currentUser) : "";
  if (!resolvedRole) {
    await signOut(auth);
    showAdminLoginNotice(`Google đã chọn tài khoản ${currentUser.email || "(không có email)"}, nhưng tài khoản này chưa có quyền quản trị IFA+A.`);
    return;
  }
  showAdminLoginNotice();
  user = currentUser;
  currentRole = resolvedRole;
  isOwner = currentRole === "owner";
  isSubAdmin = currentRole === "subadmin";
  $("#accountEmail").textContent = currentUser.email;
  $("#roleText").textContent = `Quyền hiện tại: ${isOwner ? "Chủ sở hữu" : isSubAdmin ? "Sub-admin · chỉ quản lý sự kiện tự tạo" : "Admin"}`;
  $("#adminLogin").classList.add("hidden");
  $("#adminApp").classList.remove("hidden");
  $("#logoutBtn").classList.remove("hidden");
  $("#adminNav").classList.toggle("hidden", !isOwner);
  $("#settingsNav").classList.toggle("hidden", !isOwner);
  $("#trashNav").classList.toggle("hidden", !highAdminAccess());
  $("#studentsNav").classList.toggle("hidden", !highAdminAccess());
  $("#auditLogSection").classList.toggle("hidden", !highAdminAccess());
  listen();
  void loadSystemStatus();
});

$("#systemStatusRefresh").onclick = loadSystemStatus;
$("#auditLogLoad").onclick = loadAuditLogs;
