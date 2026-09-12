import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, getCountFromServer, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, startAfter, serverTimestamp, Timestamp, runTransaction, writeBatch } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { firebaseConfig, OWNER_EMAIL } from "../firebase-config.mjs";

const DEFAULT_FACULTY = "Khoa Mỹ thuật Công nghiệp";
const DEFAULT_PUBLIC_BASE_URL = "https://ifa.tdtu.edu.vn/dang-ky-su-kien";
const DEFAULT_ATTENDANCE_BASE_URL = "https://ifa-activities.web.app/check-in/";
const EXTERNAL_CATEGORIES = new Set(["Sự kiện Trường", "Sự kiện Khoa khác"]);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
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

function confirmAction({ title, message, verification = "" }) {
  return new Promise((resolve) => {
    const dialog = $("#confirmDialog");
    const form = $("#confirmActionForm");
    const field = $("#confirmVerificationField");
    const input = $("#confirmVerificationInput");
    const submit = $("#confirmActionSubmit");
    let settled = false;

    $("#confirmActionTitle").textContent = title;
    $("#confirmActionMessage").textContent = message;
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
let attendanceFilter = "open";
let selectedAttendanceSession = null;
let attendanceRoster = [];
let attendanceRosterImport = [];
let attendancePermissionMembers = [];
let facultyStudents = [];
const FACULTY_MAJORS = ["Thiết kế đồ họa", "Thiết kế công nghiệp", "Thiết kế nội thất", "Thiết kế thời trang", "Nghệ thuật số"];
let facultyStudentPage = 1, facultyStudentCursor = null, facultyStudentHasNext = false, facultyStudentTotal = 0, expiredFacultyStudents = [];
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const purgingEventIds = new Set();
const purgingGroupIds = new Set();
let regs = [];
let admins = [];
let groups = [];
let settings = { faculties: [DEFAULT_FACULTY], publicBaseUrl: DEFAULT_PUBLIC_BASE_URL, attendancePublicBaseUrl: DEFAULT_ATTENDANCE_BASE_URL };
let adminStatusFilter = "all";
let adminEventView = localStorage.getItem("ifaa-admin-event-view") === "list" ? "list" : "cards";
let registrationPageSize = 20;
const registrationStatusFilters = new Set(["open", "ended"]);
let registrationPageIndex = 0;
let registrationPageCursors = [null];
let registrationHasNext = false;
let registrationLoading = false;
let registrationLoadedEventId = "";
let registrationRequestId = 0;
let quickRegistrationEventId = "";
let quickRegistrationPageIndex = 0;
let quickRegistrationPageCursors = [null];
let quickRegistrationHasNext = false;
let quickRegistrationLoading = false;
let quickRegistrationRequestId = 0;
let quickRegistrationRows = [];

function shareCode(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).toUpperCase();
}

function groupCode(group) {
  return shareCode(group?.shareCode || group?.name) || group?.id || "NHOM";
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
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return new URL(DEFAULT_ATTENDANCE_BASE_URL);
  }
}

function attendanceShareUrl(sessionId) {
  const url = configuredAttendanceBaseUrl();
  url.searchParams.set("event", sessionId);
  return url.toString();
}

function groupShareUrl(group) {
  const url = configuredPublicBaseUrl();
  url.searchParams.set("e", groupCode(group));
  return url.toString();
}

function createUniqueEventCode(length = 7) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const used = new Set([
    ...events.map((item) => shareCode(item.shareCode)),
    ...groups.map((item) => groupCode(item))
  ].filter(Boolean));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const values = crypto.getRandomValues(new Uint32Array(length));
    const code = Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
    if (!used.has(code)) return code;
  }
  throw new Error("Không thể tạo mã liên kết. Vui lòng thử lại.");
}

function eventShareUrl(event) {
  const url = configuredPublicBaseUrl();
  url.searchParams.set("x", shareCode(event?.shareCode));
  return url.toString();
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

function calendarStamp(value, dateOnly = false) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return dateOnly ? day : `${day}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function calendarRange(event) {
  if (!event.startTime) {
    const start = new Date(`${event.date}T00:00:00`);
    if (!Number.isFinite(start.getTime())) return null;
    const end = new Date(start.getTime() + 86400000);
    return { start, end, allDay: true, value: `${calendarStamp(start, true)}/${calendarStamp(end, true)}` };
  }
  const start = new Date(`${event.date}T${event.startTime}:00`);
  let end = new Date(`${event.date}T${event.endTime || event.startTime}:00`);
  if (!Number.isFinite(start.getTime())) return null;
  if (!Number.isFinite(end.getTime()) || end <= start) end = new Date(start.getTime() + 3600000);
  return { start, end, allDay: false, value: `${calendarStamp(start)}/${calendarStamp(end)}` };
}

function eventCalendarUrl(event) {
  const range = calendarRange(event);
  if (!range) return "";
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", event.title || "Sự kiện IFA+A");
  url.searchParams.set("dates", range.value);
  url.searchParams.set("ctz", "Asia/Ho_Chi_Minh");
  url.searchParams.set("location", event.location || "");
  url.searchParams.set("details", [event.description || "", "Thông tin từ hệ thống quản lý sự kiện IFA+A."].filter(Boolean).join("\n\n").slice(0, 1800));
  return url.toString();
}

function openGoogleCalendar(event) {
  const url = eventCalendarUrl(event);
  if (!url) return notice("Ngày hoặc giờ sự kiện chưa hợp lệ.", "error");
  window.open(url, "_blank", "noopener,noreferrer");
}

function escapeIcs(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function downloadGroupCalendar(groupId) {
  const group = groups.find((item) => item.id === groupId);
  const groupEvents = events.filter((item) => item.groupId === groupId && calendarRange(item)).sort((a, b) => `${a.date}T${a.startTime || ""}`.localeCompare(`${b.date}T${b.startTime || ""}`));
  if (!group || !groupEvents.length) return notice("Nhóm này chưa có sự kiện hợp lệ để thêm vào lịch.", "error");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const blocks = groupEvents.map((item) => {
    const range = calendarRange(item);
    const starts = range.allDay ? `DTSTART;VALUE=DATE:${calendarStamp(range.start, true)}` : `DTSTART;TZID=Asia/Ho_Chi_Minh:${calendarStamp(range.start)}`;
    const ends = range.allDay ? `DTEND;VALUE=DATE:${calendarStamp(range.end, true)}` : `DTEND;TZID=Asia/Ho_Chi_Minh:${calendarStamp(range.end)}`;
    return ["BEGIN:VEVENT", `UID:${escapeIcs(item.id)}@ifaa`, `DTSTAMP:${stamp}`, starts, ends, `SUMMARY:${escapeIcs(item.title)}`, `LOCATION:${escapeIcs(item.location)}`, `DESCRIPTION:${escapeIcs(item.description || "Sự kiện IFA+A")}`, "END:VEVENT"].join("\r\n");
  });
  const calendar = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IFAA//Event Registration//VI", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...blocks, "END:VCALENDAR", ""].join("\r\n");
  const blob = new Blob(["\uFEFF", calendar], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `IFAA_${shareCode(group.name) || "NHOM-SU-KIEN"}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
  notice(`Đã tạo tệp lịch gồm ${groupEvents.length} sự kiện. Mở tệp để nhập một lần vào Google Calendar.`, "success");
}

function notice(message, type = "") {
  const element = $("#adminNotice");
  element.textContent = message;
  element.className = `notice ${type}`;
  element.classList.remove("hidden");
  setTimeout(() => element.classList.add("hidden"), 5000);
}

async function accessRole(currentUser) {
  if (currentUser.email.toLowerCase() === OWNER_EMAIL) return "owner";
  const snapshot = await getDoc(doc(db, "admins", currentUser.email.toLowerCase()));
  if (!snapshot.exists()) return "";
  return snapshot.data().role === "subadmin" ? "subadmin" : "admin";
}

function eventEnd(event) {
  const date = new Date(`${event.date}T${event.endTime || event.startTime || "23:59"}:00`);
  return Number.isNaN(date.getTime()) ? Infinity : date.getTime();
}

function dayPeriod(time) {
  const hour = Number(String(time || "").slice(0, 2));
  if (!Number.isFinite(hour)) return "";
  if (hour >= 5 && hour < 11) return "Buổi sáng";
  if (hour >= 11 && hour < 13) return "Buổi trưa";
  if (hour >= 13 && hour < 18) return "Buổi chiều";
  return "Buổi tối";
}

function formatEventDate(event) {
  try {
    return new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${event.date}T00:00:00`));
  } catch {
    return vietnamDate(event.date);
  }
}

function eventSchedule(event) {
  if (!event.startTime) return `${formatEventDate(event)} · Cả ngày`;
  return `${formatEventDate(event)} · ${event.startTime}${event.endTime ? `–${event.endTime}` : ""}${dayPeriod(event.startTime) ? ` · ${dayPeriod(event.startTime)}` : ""}`;
}

function countdown(target) {
  const difference = Math.max(0, target - Date.now());
  const days = Math.floor(difference / 86400000);
  const totalHours = Math.floor(difference / 3600000);
  const remainingHours = totalHours % 24;
  const minutes = Math.floor((difference % 3600000) / 60000);
  const seconds = Math.floor((difference % 60000) / 1000);
  const clock = `${String(totalHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (!days) return clock;
  const detail = [`${days} ngày`];
  if (remainingHours) detail.push(`${remainingHours} giờ`);
  if (minutes) detail.push(`${String(minutes).padStart(2, "0")} phút`);
  return `${clock} (${detail.join(" ")})`;
}

function adminTimingStatus(event) {
  const now = Date.now();
  const openAt = millis(event.openAt);
  const closeAt = millis(event.closeAt);
  if (now > eventEnd(event)) return "Sự kiện đã kết thúc";
  if (event.status === "hidden" || event.status === "draft") return "Sự kiện đang được ẩn";
  if (openAt && now < openAt) return `Mở đăng ký lúc ${ts(event.openAt)} · Còn ${countdown(openAt)}`;
  if (event.status === "closed" || (closeAt && now > closeAt)) return closeAt ? `Đã đóng đăng ký lúc ${ts(event.closeAt)}` : "Đăng ký đã được Admin đóng";
  if (!closeAt) return "Đang mở đăng ký · Admin sẽ đóng đăng ký";
  return `Đóng đăng ký lúc ${ts(event.closeAt)} · Còn ${countdown(closeAt)}`;
}

function eventIsFull(event) {
  return !isExternalEvent(event) && !event.unlimitedCapacity && Number(event.capacity || 0) > 0 && Number(event.registeredCount || 0) >= Number(event.capacity || 0);
}

function isNewEvent(event) {
  const created = millis(event.createdAt);
  return event.showAsNew !== false && !!created && Date.now() - created >= 0 && Date.now() - created < 86400000;
}

function isExternalEvent(event) {
  return event.externalRegistration === true || EXTERNAL_CATEGORIES.has(event.category);
}

function eventPosition(event) {
  const position = Number(event.sortOrder);
  return Number.isFinite(position) ? position : -(millis(event.createdAt) || 0);
}

function groupPosition(group) {
  const position = Number(group.sortOrder);
  return Number.isFinite(position) ? position : -(millis(group.createdAt) || 0);
}

function eventState(event) {
  if (event.status === "hidden" || event.status === "draft") return "hidden";
  const now = Date.now();
  if (event.status === "closed" || now > eventEnd(event) || now > (millis(event.closeAt) ?? Infinity)) return "ended";
  if (now < (millis(event.openAt) ?? 0)) return "upcoming";
  return "open";
}

function statusLabel(event) {
  const state = eventState(event);
  if (state === "open" && eventIsFull(event)) return ["full", "ĐÃ ĐỦ"];
  return {
    upcoming: ["upcoming", "SẮP MỞ"],
    open: ["open", "ĐANG MỞ"],
    ended: ["admin-ended", "KẾT THÚC"],
    hidden: ["closed", "ĐÃ ẨN"]
  }[state];
}

function showPane(name) {
  if (name === "trash" && !isOwner) name = "events";
  if (name === "students" && !highAdminAccess()) name = "attendance";
  document.querySelectorAll(".nav-btn").forEach((item) => item.classList.toggle("active", item.dataset.pane === name));
  document.querySelectorAll(".pane").forEach((item) => item.classList.toggle("hidden", item.dataset.paneId !== name));
}

function render() {
  const activeEvents = events.filter((item) => !item.deletedAt);
  const trashedEvents = events.filter((item) => item.deletedAt);
  const activeGroups = groups.filter((item) => !item.deletedAt);
  const trashedGroups = groups.filter((item) => item.deletedAt);
  const counts = activeEvents.reduce((result, item) => {
    result[eventState(item)] += 1;
    return result;
  }, { upcoming: 0, open: 0, ended: 0, hidden: 0 });
  $("#metricEvents").textContent = activeEvents.length;
  $("#metricUpcoming").textContent = counts.upcoming;
  $("#metricOpen").textContent = counts.open;
  $("#metricEnded").textContent = counts.ended;
  $("#metricHidden").textContent = counts.hidden;
  $("#metricRegs").textContent = activeEvents.reduce((total, item) => total + Number(item.registeredCount || 0), 0);

  const filteredEvents = (adminStatusFilter === "all" ? activeEvents.filter((event) => eventState(event) !== "hidden") : activeEvents.filter((event) => eventState(event) === adminStatusFilter))
    .slice().sort((a, b) => Number(isExternalEvent(a)) - Number(isExternalEvent(b)) || eventPosition(a) - eventPosition(b));
  const orderedGroups = activeGroups.slice().sort((a, b) => groupPosition(a) - groupPosition(b));
  $("#eventRows").className = `admin-event-groups view-${adminEventView}`;
  document.querySelectorAll("[data-event-view]").forEach((button) => button.classList.toggle("active", button.dataset.eventView === adminEventView));
  const groupedAdminEvents = new Map();
  filteredEvents.forEach((event) => {
    const key = event.groupId || "__ungrouped__";
    if (!groupedAdminEvents.has(key)) groupedAdminEvents.set(key, []);
    groupedAdminEvents.get(key).push(event);
  });
  const adminEventCard = (event, siblingItems) => {
    const canManage = !isSubAdmin || event.createdByUid === user.uid;
    const [statusClass, statusText] = statusLabel(event);
    const state = eventState(event);
    const orderedSiblings = activeEvents.filter((item) => (item.groupId || "__ungrouped__") === (event.groupId || "__ungrouped__") && isExternalEvent(item) === isExternalEvent(event)).sort((a, b) => eventPosition(a) - eventPosition(b));
    const eventIndex = orderedSiblings.findIndex((item) => item.id === event.id);
    const hotTag = event.isHot ? '<span class="tag hot">🔥 HOT</span>' : "";
    const newTag = isNewEvent(event) ? '<span class="tag new">NEW</span>' : "";
    const used = Number(event.registeredCount || 0);
    const capacity = Number(event.capacity || 0);
    const full = eventIsFull(event);
    const percent = event.unlimitedCapacity ? 0 : capacity ? Math.min(100, used / capacity * 100) : 0;
    const hasRegistrations = !isExternalEvent(event) && used > 0;
    let registrationProgress = '<div class="admin-registration-progress external-registration-progress"><span>Sự kiện đăng ký ở trang bên ngoài</span></div>';
    if (!isExternalEvent(event) && event.unlimitedCapacity) {
      registrationProgress = `<div class="admin-registration-progress"><div class="capacity capacity-unlimited"><span><b>${used}</b> người đã đăng ký · Không giới hạn</span></div></div>`;
    } else if (!isExternalEvent(event)) {
      registrationProgress = `<div class="admin-registration-progress"><div class="progress"><i style="width:${percent}%"></i></div><div class="capacity"><span>${used}/${capacity} người tham gia</span><b class="${full ? "full-seats" : ""}">${full ? "Đã đủ" : `Còn ${Math.max(0, capacity - used)} chỗ`}</b></div></div>`;
    }
    return `<article class="card event admin-event-card event-${state}">
      <div class="event-top admin-event-top"><div class="admin-event-heading"><div class="admin-event-badges"><span class="tag event-category">${safe(event.category || "Sự kiện Khoa")}</span><span class="tag ${statusClass}">${statusText}</span>${hotTag}${newTag}</div><h3>${safe(event.title)}</h3></div><div class="admin-card-position"><div class="admin-position-controls"><span>${eventIndex + 1}/${orderedSiblings.length}</span><button class="btn btn-small" title="Đưa sự kiện lên" aria-label="Đưa sự kiện lên" data-move-event="${event.id}" data-direction="-1" ${eventIndex <= 0 ? "disabled" : ""}>↑</button><button class="btn btn-small" title="Đưa sự kiện xuống" aria-label="Đưa sự kiện xuống" data-move-event="${event.id}" data-direction="1" ${eventIndex >= orderedSiblings.length - 1 ? "disabled" : ""}>↓</button></div>${event.shareCode ? `<button class="btn btn-small btn-copy-link admin-event-link" data-copy-event-link="${event.id}">🔗 Copy link</button>` : `<button class="btn btn-small btn-soft admin-event-link" data-create-event-link="${event.id}" ${canManage ? "" : "disabled"}>＋ Tạo link</button>`}</div></div>
      <div class="meta"><span class="event-schedule"><b>Ngày sự kiện:</b> ${safe(eventSchedule(event))}</span><span class="event-location"><b>Địa điểm sự kiện:</b> ${safe(event.location || "Chưa cập nhật")}</span><span class="countdown" data-admin-timing="${event.id}" data-admin-state="${state}">${safe(adminTimingStatus(event))}</span><span><b>Người tạo:</b> ${safe(event.createdByName || event.createdByEmail)}</span></div>
      ${registrationProgress}
      <div class="event-actions admin-card-actions"><button class="btn" data-edit="${event.id}" ${canManage ? "" : "disabled"}>Sửa</button><button class="btn btn-soft" data-copy-event="${event.id}">Sao chép</button><button class="btn btn-soft" data-quick-registrations="${event.id}" ${hasRegistrations ? "" : "disabled"}>Xem danh sách</button><button class="btn btn-download-list" data-export-event="${event.id}" ${hasRegistrations ? "" : "disabled"}><span class="sheet-icon" aria-hidden="true">▦</span> Tải danh sách</button>${!isExternalEvent(event) ? `<button class="btn btn-calendar" data-attendance-event="${event.id}">${attendanceSessions.some((item) => item.eventId === event.id) ? "Quản lý điểm danh" : "＋ Điểm danh sự kiện"}</button>` : ""}<button class="btn btn-danger" data-delete="${event.id}" ${canManage ? "" : "disabled"}>Xóa</button></div>
    </article>`;
  };
  let adminTone = 0;
  $("#eventRows").innerHTML = filteredEvents.length ? [...groupedAdminEvents.entries()].sort(([a], [b]) => {
    if (a === "__ungrouped__") return 1;
    if (b === "__ungrouped__") return -1;
    return groupPosition(groups.find((item) => item.id === a) || {}) - groupPosition(groups.find((item) => item.id === b) || {});
  }).map(([groupId, items]) => {
    const eventGroup = groups.find((item) => item.id === groupId);
    const title = groupId === "__ungrouped__" ? "Sự kiện không thuộc nhóm" : (eventGroup?.name || items[0]?.groupName || "Nhóm sự kiện");
    const limit = groupId === "__ungrouped__" ? "" : eventGroup?.unlimited ? "" : `Tối đa ${eventGroup?.maxRegistrations || items[0]?.groupMaxRegistrations || 1}/sự kiện`;
    const toneClass = groupId === "__ungrouped__" ? "admin-group-ungrouped" : `group-tone-${adminTone++ % 5}`;
    const groupIndex = orderedGroups.findIndex((item) => item.id === groupId);
    const groupRegistrationCount = activeEvents.filter((item) => item.groupId === groupId).reduce((total, item) => total + Number(item.registeredCount || 0), 0);
    const groupMove = groupId === "__ungrouped__" ? `<b>${items.length} sự kiện</b>` : `<div class="admin-group-move"><b>${items.length} sự kiện · ${groupRegistrationCount} lượt đăng ký</b><button class="btn btn-small btn-download-list" data-export-group="${groupId}" ${groupRegistrationCount ? "" : "disabled"}><span class="sheet-icon" aria-hidden="true">▦</span> Tải danh sách nhóm</button>${eventGroup?.shareCode ? `<button class="btn btn-small btn-copy-link" data-copy-group-link="${groupId}">🔗 Sao chép link nhóm</button>` : ""}<button class="btn btn-small" data-move-group="${groupId}" data-direction="-1" ${groupIndex <= 0 ? "disabled" : ""}>↑ Lên</button><button class="btn btn-small" data-move-group="${groupId}" data-direction="1" ${groupIndex < 0 || groupIndex >= orderedGroups.length - 1 ? "disabled" : ""}>↓ Xuống</button></div>`;
    return `<section class="admin-event-group ${toneClass}"><div class="admin-event-group-head"><div><span>${groupId === "__ungrouped__" ? "SỰ KIỆN RIÊNG" : "NHÓM SỰ KIỆN"}</span><h3>${safe(title)}</h3>${limit ? `<small>${safe(limit)}</small>` : ""}</div>${groupMove}</div><div class="event-grid admin-event-grid">${items.map((item) => adminEventCard(item, items)).join("")}</div></section>`;
  }).join("") : '<div class="card empty">Không có sự kiện ở trạng thái này.</div>';

  $("#groupRows").innerHTML = orderedGroups.map((group, groupIndex) => {
    const groupedItems = activeEvents.filter((item) => item.groupId === group.id);
    const eventCount = groupedItems.length;
    const groupRegisteredCount = groupedItems.reduce((total, item) => total + Number(item.registeredCount || 0), 0);
    const visibility = group.linkOnly ? '<span class="tag upcoming">CHỈ QUA LINK</span>' : '<span class="tag open">TRANG CHUNG</span>';
    const limit = group.unlimited ? '<b>Không giới hạn</b>' : `Tối đa <b>${Number(group.maxRegistrations) || 1}</b>/sự kiện`;
    const hiddenCount = groupedItems.filter((item) => eventState(item) === "hidden").length;
    const endedCount = groupedItems.filter((item) => eventState(item) === "ended").length;
    const groupState = hiddenCount === eventCount && eventCount ? "Đã ẩn toàn bộ" : endedCount === eventCount && eventCount ? "Đã kết thúc" : "Theo từng sự kiện";
    return `<tr><td><b>${safe(group.name)}</b><br><small>Mã: ${safe(groupCode(group))}</small></td><td>${limit}</td><td>${eventCount}<br><small>${groupState}</small></td><td>${visibility}</td><td><div class="actions"><button class="btn btn-small btn-soft" data-copy-group-link="${group.id}">Sao chép liên kết</button><button class="btn btn-small btn-calendar" data-calendar-group="${group.id}">＋ Lịch cả nhóm</button><button class="btn btn-small btn-download-list" data-export-group="${group.id}" ${groupRegisteredCount ? "" : "disabled"}><span class="sheet-icon" aria-hidden="true">▦</span> Tải danh sách nhóm</button></div></td><td><div class="actions"><button class="btn btn-small" data-move-group="${group.id}" data-direction="-1" ${groupIndex <= 0 ? "disabled" : ""}>↑</button><button class="btn btn-small" data-move-group="${group.id}" data-direction="1" ${groupIndex >= orderedGroups.length - 1 ? "disabled" : ""}>↓</button><button class="btn btn-small" data-edit-group="${group.id}">Sửa nhóm</button><button class="btn btn-small btn-danger" data-delete-group="${group.id}">Xóa nhóm</button></div></td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">Chưa có nhóm sự kiện.</td></tr>';

  if ($("#trashGroupRows")) {
    $("#trashGroupRows").innerHTML = isOwner && trashedGroups.length
      ? trashedGroups.slice().sort((a, b) => (millis(b.deletedAt) || 0) - (millis(a.deletedAt) || 0)).map((item) => {
          const deletedTime = millis(item.deletedAt);
          const purgeTime = deletedTime ? deletedTime + TRASH_RETENTION_MS : 0;
          const itemCount = events.filter((event) => event.deletedWithGroupId === item.id).length;
          return `<tr><td><b>${safe(item.name)}</b><br><small>Mã: ${safe(groupCode(item))}</small></td><td>${itemCount}</td><td>${deletedTime ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(deletedTime)) : "—"}<br><small>${safe(item.deletedByEmail || "")}</small></td><td><b>${purgeTime ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(purgeTime)) : "—"}</b></td><td><div class="actions"><button class="btn btn-small btn-restore" data-restore-group="${item.id}">↶ Khôi phục nhóm</button><button class="btn btn-small btn-danger" data-purge-group="${item.id}">Xóa vĩnh viễn</button></div></td></tr>`;
        }).join("")
      : '<tr><td colspan="5" class="empty">Không có nhóm trong thùng rác.</td></tr>';
  }

  if ($("#trashRows")) {
    $("#trashRows").innerHTML = isOwner && trashedEvents.length
      ? trashedEvents.slice().sort((a, b) => (millis(b.deletedAt) || 0) - (millis(a.deletedAt) || 0)).map((item) => {
          const deletedTime = millis(item.deletedAt);
          const purgeTime = deletedTime ? deletedTime + TRASH_RETENTION_MS : 0;
          return `<tr><td><b>${safe(item.title)}</b><br><small>${safe(item.groupName || "Không thuộc nhóm")}</small></td><td>${safe(vietnamDate(item.date) || "—")}</td><td>${deletedTime ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(deletedTime)) : "—"}<br><small>${safe(item.deletedByEmail || "")}</small></td><td><b>${purgeTime ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(purgeTime)) : "—"}</b></td><td>${Number(item.registeredCount || 0)}</td><td><div class="actions"><button class="btn btn-small btn-restore" data-restore-event="${item.id}">↶ Khôi phục</button><button class="btn btn-small btn-danger" data-purge-event="${item.id}">Xóa vĩnh viễn</button></div></td></tr>`;
        }).join("")
      : '<tr><td colspan="6" class="empty">Thùng rác đang trống.</td></tr>';
  }

  refreshRegistrationFilters();
  renderRegs();
  if (isOwner) $("#adminRows").innerHTML = admins.map((admin) => `<tr><td>${safe(admin.name || "")}</td><td>${safe(admin.email)}</td><td><select class="admin-role-select" data-admin-role="${safe(admin.email)}"><option value="admin" ${(admin.role || "admin") === "admin" ? "selected" : ""}>Admin</option><option value="subadmin" ${admin.role === "subadmin" ? "selected" : ""}>Sub-admin</option></select></td><td>${ts(admin.addedAt)}</td><td><button class="btn btn-small btn-danger" data-remove-admin="${safe(admin.email)}">Xóa</button></td></tr>`).join("");
}

function updateAdminCountdowns() {
  let stateChanged = false;
  document.querySelectorAll("[data-admin-timing]").forEach((node) => {
    const event = events.find((item) => item.id === node.dataset.adminTiming);
    if (!event) return;
    const nextState = eventState(event);
    if (node.dataset.adminState !== nextState) stateChanged = true;
    else node.textContent = adminTimingStatus(event);
  });
  if (stateChanged) render();
}

setInterval(updateAdminCountdowns, 1000);

function registrationStatusMatches(event) {
  const state = eventState(event);
  return (state === "open" && registrationStatusFilters.has("open"))
    || (state === "ended" && registrationStatusFilters.has("ended"))
    || (state === "hidden" && registrationStatusFilters.has("hidden"));
}

function refreshRegistrationFilters() {
  const selectedGroup = $("#groupFilter").value;
  const selectedEvent = $("#eventFilter").value;
  $("#groupFilter").innerHTML = '<option value="">Tất cả nhóm sự kiện</option>' + groups.filter((group) => !group.deletedAt).slice().sort((a, b) => groupPosition(a) - groupPosition(b)).map((group) => `<option value="${group.id}">${safe(group.name)}</option>`).join("");
  if (groups.some((group) => group.id === selectedGroup)) $("#groupFilter").value = selectedGroup;
  const activeGroup = $("#groupFilter").value;
  const availableEvents = events.filter((event) => !event.deletedAt && !isExternalEvent(event) && registrationStatusMatches(event) && (!activeGroup || event.groupId === activeGroup)).slice().sort((a, b) => eventPosition(a) - eventPosition(b));
  $("#eventFilter").innerHTML = '<option value="">— Chọn sự kiện để tải danh sách —</option>' + availableEvents.map((event) => `<option value="${event.id}">${safe(event.title)} · ${safe(vietnamDate(event.date))}</option>`).join("");
  if (availableEvents.some((event) => event.id === selectedEvent)) $("#eventFilter").value = selectedEvent;
}

function filteredRegistrations() {
  return registrationLoadedEventId === $("#eventFilter").value ? regs : [];
}

function resetRegistrationPage() {
  regs = [];
  registrationPageIndex = 0;
  registrationPageCursors = [null];
  registrationHasNext = false;
  registrationLoadedEventId = "";
}

async function loadRegistrationPage(direction = 0) {
  const eventId = $("#eventFilter").value;
  if (!eventId) {
    resetRegistrationPage();
    renderRegs();
    return;
  }
  let targetPage = direction === 0 ? 0 : registrationPageIndex + direction;
  if (targetPage < 0 || (direction > 0 && !registrationHasNext)) return;
  if (direction === 0) {
    registrationPageCursors = [null];
    registrationPageIndex = 0;
  }
  const cursor = registrationPageCursors[targetPage];
  if (targetPage > 0 && !cursor) return;
  const requestId = ++registrationRequestId;
  registrationLoading = true;
  renderRegs();
  try {
    const clauses = [where("eventId", "==", eventId)];
    if (cursor) clauses.push(startAfter(cursor));
    clauses.push(limit(registrationPageSize + 1));
    const snapshot = await getDocs(query(collection(db, "registrations"), ...clauses));
    if (requestId !== registrationRequestId || $("#eventFilter").value !== eventId) return;
    const visibleDocs = snapshot.docs.slice(0, registrationPageSize);
    regs = visibleDocs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (millis(b.createdAt) || 0) - (millis(a.createdAt) || 0));
    registrationPageIndex = targetPage;
    registrationHasNext = snapshot.docs.length > registrationPageSize;
    registrationLoadedEventId = eventId;
    if (registrationHasNext && visibleDocs.length) registrationPageCursors[targetPage + 1] = visibleDocs[visibleDocs.length - 1];
  } catch (error) {
    if (requestId === registrationRequestId) {
      resetRegistrationPage();
      notice(error.message || "Không thể tải danh sách đăng ký.", "error");
    }
  } finally {
    if (requestId === registrationRequestId) {
      registrationLoading = false;
      renderRegs();
    }
  }
}

function renderRegs() {
  const eventId = $("#eventFilter").value;
  const list = filteredRegistrations();
  const selectedEvent = events.find((item) => item.id === eventId);
  $("#resetEventBtn").disabled = !eventId || Number(selectedEvent?.registeredCount || 0) < 1;
  $("#exportBtn").disabled = !eventId && !$("#groupFilter").value;
  $("#registrationPagination").classList.toggle("hidden", !eventId || registrationLoading || (!list.length && !registrationHasNext));
  $("#registrationPrev").disabled = registrationPageIndex <= 0 || registrationLoading;
  $("#registrationNext").disabled = !registrationHasNext || registrationLoading;
  $("#registrationPageText").textContent = `Trang ${registrationPageIndex + 1}`;
  if (!eventId) {
    $("#registrationLoadHint").textContent = "Danh sách chưa được tải để tiết kiệm lượt đọc dữ liệu.";
    $("#regRows").innerHTML = '<tr><td colspan="8" class="empty">Vui lòng chọn một sự kiện để xem danh sách đăng ký.</td></tr>';
    return;
  }
  if (registrationLoading) {
    $("#registrationLoadHint").textContent = `Đang tải tối đa ${registrationPageSize} lượt đăng ký…`;
    $("#regRows").innerHTML = '<tr><td colspan="8" class="empty">Đang tải danh sách đăng ký…</td></tr>';
    return;
  }
  $("#registrationLoadHint").textContent = list.length ? `Đang hiển thị ${list.length} người ở trang ${registrationPageIndex + 1}.` : "Sự kiện này chưa có người đăng ký.";
  $("#regRows").innerHTML = list.map((registration, index) => `<tr><td class="col-stt">${registrationPageIndex * registrationPageSize + index + 1}</td><td class="col-identifier"><b>${safe(registration.identifier || registration.mssv)}</b></td><td>${safe(registration.name)}</td><td>${safe(registration.faculty)}</td><td>${safe(registration.participantType || "Sinh viên")}</td><td>${safe(registration.eventTitle)}</td><td>${ts(registration.createdAt)}</td><td><button class="btn btn-small btn-danger" data-delete-registration="${registration.id}">Xóa</button></td></tr>`).join("") || '<tr><td colspan="8" class="empty">Sự kiện này chưa có người đăng ký.</td></tr>';
}

async function fetchRegistrations(field, value) {
  if (!value) return [];
  const snapshot = await getDocs(query(collection(db, "registrations"), where(field, "==", value)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (millis(b.createdAt) || 0) - (millis(a.createdAt) || 0));
}

function writeRegistrationWorkbook(list, eventId = "", groupId = "") {
  const selectedEvent = events.find((event) => event.id === eventId);
  const selectedGroup = groups.find((group) => group.id === groupId);
  const rows = list.map((registration, index) => {
    const registrationEvent = events.find((event) => event.id === registration.eventId);
    const row = { STT: index + 1, "MSSV/Mã số": registration.identifier || registration.mssv, "Họ tên": registration.name, "Khoa/Đơn vị": registration.faculty, "Đối tượng": registration.participantType || "Sinh viên", Email: registration.email, "Sự kiện": registration.eventTitle, "Ngày sự kiện": vietnamDate(registration.eventDate), "Giờ bắt đầu": registrationEvent?.startTime || "", "Giờ kết thúc": registrationEvent?.endTime || "", "Buổi": dayPeriod(registrationEvent?.startTime), "Thời gian đăng ký": ts(registration.createdAt) };
    if (!groupId) row["Nhóm sự kiện"] = registration.groupName || "Không nhóm";
    return row;
  });
  const exportName = selectedEvent?.title || (selectedGroup ? `Nhom_${selectedGroup.name}` : "Danh_sach_dang_ky");
  const cleanName = exportName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70) || "Su_kien";
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 6 }, { wch: 15 }, { wch: 24 }, { wch: 28 }, { wch: 14 }, { wch: 32 }, { wch: 32 }, { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 20 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, (selectedEvent?.title || selectedGroup?.name || "Đăng ký").slice(0, 31));
  XLSX.writeFile(workbook, `IFAA_${cleanName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function downloadRegistrationExcel(eventId = "", groupId = "", button = null) {
  const originalHtml = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.textContent = "Đang tải…";
  }
  try {
    const list = eventId ? await fetchRegistrations("eventId", eventId) : await fetchRegistrations("groupId", groupId);
    if (!list.length) {
      notice("Chưa có dữ liệu đăng ký để xuất.", "error");
      return;
    }
    writeRegistrationWorkbook(list, eventId, groupId);
    notice(`Đã xuất ${list.length} lượt đăng ký.`, "success");
  } catch (error) {
    notice(error.message || "Không thể xuất dữ liệu.", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
  }
}

function renderQuickRegistrations() {
  const selectedEvent = events.find((item) => item.id === quickRegistrationEventId);
  $("#quickRegistrationTitle").textContent = selectedEvent?.title || "Danh sách đăng ký";
  $("#quickRegistrationSummary").textContent = quickRegistrationLoading ? "Đang tải danh sách…" : `Trang ${quickRegistrationPageIndex + 1} · ${quickRegistrationRows.length} người`;
  $("#quickRegistrationPrev").disabled = quickRegistrationLoading || quickRegistrationPageIndex <= 0;
  $("#quickRegistrationNext").disabled = quickRegistrationLoading || !quickRegistrationHasNext;
  $("#quickRegistrationPageText").textContent = `Trang ${quickRegistrationPageIndex + 1}`;
  if (quickRegistrationLoading) {
    $("#quickRegistrationRows").innerHTML = '<tr><td colspan="6" class="empty">Đang tải danh sách đăng ký…</td></tr>';
    return;
  }
  $("#quickRegistrationRows").innerHTML = quickRegistrationRows.map((registration, index) => `<tr><td class="col-stt">${quickRegistrationPageIndex * registrationPageSize + index + 1}</td><td class="col-identifier"><b>${safe(registration.identifier || registration.mssv)}</b></td><td>${safe(registration.name)}</td><td>${safe(registration.faculty)}</td><td>${safe(registration.participantType || "Sinh viên")}</td><td>${ts(registration.createdAt)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">Sự kiện này chưa có người đăng ký.</td></tr>';
}

async function loadQuickRegistrationPage(direction = 0) {
  const eventId = quickRegistrationEventId;
  if (!eventId) return;
  let targetPage = direction === 0 ? 0 : quickRegistrationPageIndex + direction;
  if (targetPage < 0 || (direction > 0 && !quickRegistrationHasNext)) return;
  if (direction === 0) {
    quickRegistrationPageCursors = [null];
    quickRegistrationPageIndex = 0;
  }
  const cursor = quickRegistrationPageCursors[targetPage];
  if (targetPage > 0 && !cursor) return;
  const requestId = ++quickRegistrationRequestId;
  quickRegistrationLoading = true;
  renderQuickRegistrations();
  try {
    const clauses = [where("eventId", "==", eventId)];
    if (cursor) clauses.push(startAfter(cursor));
    clauses.push(limit(registrationPageSize + 1));
    const snapshot = await getDocs(query(collection(db, "registrations"), ...clauses));
    if (requestId !== quickRegistrationRequestId || eventId !== quickRegistrationEventId) return;
    const visibleDocs = snapshot.docs.slice(0, registrationPageSize);
    quickRegistrationRows = visibleDocs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (millis(b.createdAt) || 0) - (millis(a.createdAt) || 0));
    quickRegistrationPageIndex = targetPage;
    quickRegistrationHasNext = snapshot.docs.length > registrationPageSize;
    if (quickRegistrationHasNext && visibleDocs.length) quickRegistrationPageCursors[targetPage + 1] = visibleDocs[visibleDocs.length - 1];
  } catch (error) {
    quickRegistrationRows = [];
    quickRegistrationHasNext = false;
    notice(error.message || "Không thể tải danh sách đăng ký.", "error");
  } finally {
    if (requestId === quickRegistrationRequestId) {
      quickRegistrationLoading = false;
      renderQuickRegistrations();
    }
  }
}

async function openQuickRegistrations(eventId) {
  const selectedEvent = events.find((item) => item.id === eventId);
  if (!selectedEvent || Number(selectedEvent.registeredCount || 0) < 1) return;
  quickRegistrationEventId = eventId;
  quickRegistrationPageIndex = 0;
  quickRegistrationPageCursors = [null];
  quickRegistrationHasNext = false;
  quickRegistrationRows = [];
  $("#quickRegistrationDialog").showModal();
  await loadQuickRegistrationPage(0);
}

async function removeRegistration(registration) {
  const registrationRef = doc(db, "registrations", registration.id);
  const eventRef = doc(db, "events", registration.eventId);
  await runTransaction(db, async (transaction) => {
    const eventSnapshot = await transaction.get(eventRef);
    const registrationSnapshot = await transaction.get(registrationRef);
    if (!registrationSnapshot.exists()) return;
    const liveRegistration = registrationSnapshot.data();
    let limitRef = null;
    let limitSnapshot = null;
    if (liveRegistration.groupId) {
      limitRef = doc(db, "registrationLimits", `${liveRegistration.uid}_${liveRegistration.groupId}`);
      limitSnapshot = await transaction.get(limitRef);
    }
    if (eventSnapshot.exists()) transaction.update(eventRef, { registeredCount: Math.max(0, Number(eventSnapshot.data().registeredCount || 0) - 1), updatedAt: serverTimestamp() });
    transaction.delete(registrationRef);
    if (limitRef && limitSnapshot?.exists()) {
      const limit = limitSnapshot.data();
      const eventIds = (limit.eventIds || []).filter((id) => id !== liveRegistration.eventId);
      transaction.update(limitRef, { count: eventIds.length, eventIds, updatedAt: serverTimestamp() });
    }
  });
}

function refreshGroupOptions(selected = "") {
  const select = $("#groupId");
  select.innerHTML = '<option value="">Không nhóm</option>' + groups.filter((group) => !group.deletedAt).map((group) => `<option value="${group.id}">${safe(group.name)} — ${group.unlimited ? "không giới hạn" : `tối đa ${group.maxRegistrations}`}</option>`).join("") + '<option value="__new__">＋ Tạo nhóm mới</option>';
  select.value = selected || "";
}

function setLimitInputState(checkbox, input, help) {
  input.disabled = checkbox.checked;
  input.required = !checkbox.checked;
  if (help) help.textContent = checkbox.checked ? "Đã tắt giới hạn lượt đăng ký cho nhóm này." : "Mặc định là 2, có thể thay đổi từ 1 đến 20.";
}

function openGroup(group = null) {
  $("#groupForm").reset();
  $("#groupEditId").value = group?.id || "";
  $("#groupDialogTitle").textContent = group ? "Chỉnh sửa nhóm sự kiện" : "Tạo nhóm sự kiện";
  $("#groupName").value = group?.name || "";
  $("#groupShareCode").value = group ? groupCode(group) : "";
  $("#groupMaxRegistrations").value = group?.maxRegistrations || 2;
  $("#groupUnlimited").checked = !!group?.unlimited;
  setLimitInputState($("#groupUnlimited"), $("#groupMaxRegistrations"), $("#groupLimitHelp"));
  $("#groupLinkOnly").checked = !!group?.linkOnly;
  $("#groupBulkStatus").value = "";
  $("#groupFormError").classList.add("hidden");
  $("#groupDialog").showModal();
}

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

async function permanentlyDeleteEvent(selected) {
  if (!selected || !isOwner) throw Error("Chỉ Chủ sở hữu được xóa vĩnh viễn.");
  const registrations = await fetchRegistrations("eventId", selected.id);
  for (const registration of registrations) await removeRegistration(registration);
  await deleteDoc(doc(db, "events", selected.id));
}

async function permanentlyDeleteGroup(selected) {
  if (!selected || !isOwner) throw Error("Chỉ Chủ sở hữu được xóa vĩnh viễn.");
  const groupedTrashEvents = events.filter((item) => item.deletedWithGroupId === selected.id && item.deletedAt);
  for (const groupedEvent of groupedTrashEvents) await permanentlyDeleteEvent(groupedEvent);
  await deleteDoc(doc(db, "eventGroups", selected.id));
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
}

function listen() {
  onSnapshot(doc(db, "settings", "main"), (snapshot) => {
    if (snapshot.exists()) settings = { ...settings, ...snapshot.data() };
    settings.faculties = [...new Set([DEFAULT_FACULTY, ...(settings.faculties || [])])];
    renderFacultySettings();
  }, (error) => notice(error.message, "error"));

  const groupsQuery = isSubAdmin
    ? query(collection(db, "eventGroups"), where("createdByUid", "==", user.uid))
    : query(collection(db, "eventGroups"), orderBy("createdAt", "desc"));
  onSnapshot(groupsQuery, (snapshot) => {
    groups = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (millis(b.createdAt) || 0) - (millis(a.createdAt) || 0));
    refreshGroupOptions($("#groupId").value);
    render();
    if (isOwner) void cleanupExpiredTrash();
  }, (error) => notice(error.message, "error"));

  const eventsQuery = isSubAdmin
    ? query(collection(db, "events"), where("createdByUid", "==", user.uid))
    : query(collection(db, "events"), orderBy("createdAt", "desc"));
  onSnapshot(eventsQuery, (snapshot) => {
    events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    render();
    if (isOwner) void cleanupExpiredTrash();
  }, (error) => notice(error.message, "error"));

  onSnapshot(collection(db, "attendanceSessions"), (snapshot) => {
    attendanceSessions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => !isSubAdmin || item.createdByUid === user.uid);
    renderAttendance();
    render();
  }, (error) => notice("Không thể tải dữ liệu điểm danh: " + error.message, "error"));

  loadFacultyStudentMeta();

  // Danh sách đăng ký chỉ được truy vấn sau khi Admin chọn một sự kiện.

  if (isOwner) onSnapshot(collection(db, "admins"), (snapshot) => {
    admins = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    render();
  }, (error) => notice(error.message, "error"));
}

const inputDateTimeParts = (value) => {
  if (!value) return { date: "", time: "" };
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  const text = local.toISOString();
  return { date: text.slice(0, 10), time: text.slice(11, 16) };
};

const validTime24 = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const dateTimeValue = (date, time) => date && validTime24(time) ? new Date(`${date}T${time}:00`) : null;

function openEvent(event = null, copy = false) {
  $("#eventForm").reset();
  delete $("#saveEventBtn").dataset.warningSignature;
  delete $("#saveEventBtn").dataset.immediateOpenBase;
  $("#saveEventBtn").textContent = "Lưu sự kiện";
  $("#descriptionEditor").innerHTML = event?.descriptionHtml || (event?.description ? `<p>${safe(event.description).replace(/\n/g, "<br>")}</p>` : "");
  $("#eventFormError").classList.add("hidden");
  $("#eventId").value = copy ? "" : (event?.id || "");
  $("#eventDialogTitle").textContent = copy ? "Sao chép sự kiện" : event ? "Chỉnh sửa sự kiện" : "Tạo sự kiện";
  for (const key of ["title", "category", "date", "location", "startTime", "endTime", "capacity", "status"]) if (event && $("#" + key)) $("#" + key).value = event[key] ?? "";
  if (!$("#category").value) $("#category").value = "Sự kiện Khoa";
  if (event?.status === "draft") $("#status").value = "hidden";
  if (event) {
    const opens = inputDateTimeParts(event.openAt);
    const closes = inputDateTimeParts(event.closeAt);
    $("#openDate").value = opens.date;
    $("#openTime").value = opens.time;
    $("#closeDate").value = closes.date;
    $("#closeTime").value = closes.time;
  } else {
    $("#status").value = "open";
    $("#category").value = "Sự kiện Khoa";
  }
  $("#eventAllowCancellation").checked = !!event?.allowCancellation;
  $("#eventHot").checked = !!event?.isHot;
  $("#eventShowAsNew").checked = copy ? true : event ? event.showAsNew !== false : true;
  $("#eventCreateShareLink").checked = copy ? false : !!event?.shareCode;
  $("#eventCreateShareLink").disabled = !copy && !!event?.shareCode;
  $("#eventShareLinkHelp").textContent = !copy && event?.shareCode ? `Mã liên kết hiện tại: ${shareCode(event.shareCode)}` : "Có thể tạo ngay hoặc tạo sau tại trang quản lý sự kiện.";
  $("#unlimitedCapacity").checked = !!event?.unlimitedCapacity;
  $("#hideRegistrationCount").checked = !!event?.hideRegistrationCount;
  if (event?.unlimitedCapacity) $("#capacity").value = "";
  $("#registrationUrl").value = event?.registrationUrl || "";
  const storedCloseMode = event?.closeMode || (event ? "manual" : "after24");
  const closeMode = copy ? (event?.closeMode || "manual") : storedCloseMode;
  const closeModeInput = document.querySelector(`input[name="closeMode"][value="${closeMode}"]`) || document.querySelector('input[name="closeMode"][value="after24"]');
  if (closeModeInput) closeModeInput.checked = true;
  toggleExternalEventFields();
  setCapacityState();
  setCloseModeState();
  refreshGroupOptions(event?.groupId || "");
  $("#groupId").disabled = !copy && !!event && (event.registeredCount || 0) > 0;
  $("#newGroupFields").classList.add("hidden");
  $("#newGroupMax").value = 2;
  $("#newGroupUnlimited").checked = false;
  setLimitInputState($("#newGroupUnlimited"), $("#newGroupMax"));
  renderEventFaculties(event?.allowedFaculties?.length ? event.allowedFaculties : [DEFAULT_FACULTY]);
  const canApplyToGroup = !copy && !!event?.id && !!event?.groupId;
  $("#applyGroupFieldsOption").classList.toggle("hidden", !canApplyToGroup);
  document.querySelectorAll(".group-sync-field").forEach((input) => { input.checked = false; });
  $("#eventDialog").showModal();
}

$("#groupId").onchange = () => {
  const creating = $("#groupId").value === "__new__";
  $("#newGroupFields").classList.toggle("hidden", !creating);
  $("#newGroupName").required = creating;
  $("#newGroupMax").required = creating && !$("#newGroupUnlimited").checked;
  if (creating && !$("#newGroupMax").value) $("#newGroupMax").value = 2;
};

$("#groupUnlimited").onchange = () => setLimitInputState($("#groupUnlimited"), $("#groupMaxRegistrations"), $("#groupLimitHelp"));
$("#newGroupUnlimited").onchange = () => setLimitInputState($("#newGroupUnlimited"), $("#newGroupMax"));

function toggleExternalEventFields() {
  const external = EXTERNAL_CATEGORIES.has($("#category").value);
  $("#externalRegistrationField").classList.toggle("hidden", !external);
  $("#registrationUrl").required = external;
  setCapacityState();
}

function setCapacityState() {
  const external = EXTERNAL_CATEGORIES.has($("#category").value);
  const unlimited = $("#unlimitedCapacity").checked;
  $("#capacity").disabled = external || unlimited;
  $("#capacity").required = !external && !unlimited;
  if (!external && !unlimited && !Number($("#capacity").value)) $("#capacity").value = 50;
  $("#capacityHelp").textContent = external ? "Sự kiện này đăng ký ở trang bên ngoài." : unlimited ? "Đã tắt giới hạn số người đăng ký." : "Nhập số người tối đa được đăng ký.";
}

function selectedCloseMode() {
  return document.querySelector('input[name="closeMode"]:checked')?.value || "after24";
}

function setCloseModeState() {
  const mode = selectedCloseMode();
  const manual = mode === "manual";
  $("#closeRegistrationFields").classList.toggle("hidden", !manual);
  $("#closeDate").disabled = !manual;
  $("#closeTime").disabled = !manual;
  $("#closeDate").required = manual;
  $("#closeTime").required = manual;
  const help = {
    after12: "Hệ thống sẽ đóng đăng ký sau 12 giờ tính từ lúc mở.",
    after24: "Hệ thống sẽ đóng đăng ký sau 24 giờ tính từ lúc mở.",
    endOfDay: "Hệ thống sẽ đóng lúc 23:59 của ngày diễn ra sự kiện.",
    admin: "Đăng ký tiếp tục mở cho đến khi Admin chuyển trạng thái sang kết thúc.",
    manual: "Nhập chính xác ngày và giờ đóng đăng ký."
  };
  $("#closeModeHelp").textContent = help[mode] || help.after24;
}

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
  let keepWarningAction = false;
  submit.disabled = true;
  submit.textContent = "Đang lưu…";
  error.classList.add("hidden");
  const id = $("#eventId").value;
  const data = {};
  for (const key of ["title", "category", "date", "location", "startTime", "endTime", "status"]) data[key] = $("#" + key).value.trim();
  data.descriptionHtml = $("#descriptionEditor").innerHTML.trim();
  data.description = $("#descriptionEditor").innerText.trim();
  const existingEvent = id ? events.find((item) => item.id === id) : null;
  data.shareCode = existingEvent?.shareCode || ($("#eventCreateShareLink").checked ? createUniqueEventCode() : "");
  const openDateText = $("#openDate").value;
  const openTimeText = $("#openTime").value.trim();
  const closeDateText = $("#closeDate").value;
  const closeTimeText = $("#closeTime").value.trim();
  data.openAt = null;
  data.closeAt = null;
  data.closeMode = selectedCloseMode();
  data.autoCloseRegistration = false;
  data.externalRegistration = EXTERNAL_CATEGORIES.has(data.category);
  data.registrationUrl = $("#registrationUrl").value.trim();
  data.unlimitedCapacity = !data.externalRegistration && $("#unlimitedCapacity").checked;
  data.hideRegistrationCount = $("#hideRegistrationCount").checked;
  data.capacity = data.externalRegistration ? 1 : data.unlimitedCapacity ? 1000000000 : Number($("#capacity").value);
  data.allowedFaculties = [...document.querySelectorAll(".event-faculty:checked")].map((input) => input.value);
  data.allowCancellation = $("#eventAllowCancellation").checked;
  data.isHot = $("#eventHot").checked;
  data.showAsNew = $("#eventShowAsNew").checked;
  data.updatedAt = serverTimestamp();
  try {
    if (!data.title || !data.category || !data.date || !data.location || !Number.isInteger(data.capacity) || data.capacity < 1) throw Error("Vui lòng nhập đầy đủ các trường bắt buộc.");
    if ((data.startTime && !validTime24(data.startTime)) || (data.endTime && !validTime24(data.endTime))) throw Error("Nếu nhập giờ sự kiện, vui lòng dùng định dạng 24 giờ HH:mm, ví dụ 08:30 hoặc 17:45.");
    if ((openDateText && !openTimeText) || (!openDateText && openTimeText)) throw Error("Thời gian mở đăng ký: hãy nhập đủ ngày và giờ, hoặc để trống cả hai để mở ngay.");
    if (openTimeText && !validTime24(openTimeText)) throw Error("Giờ mở đăng ký phải theo định dạng 24 giờ HH:mm.");
    if (data.closeMode === "manual" && ((closeDateText && !closeTimeText) || (!closeDateText && closeTimeText))) throw Error("Thời gian đóng đăng ký: vui lòng nhập đủ ngày và giờ.");
    if (data.closeMode === "manual" && (!closeDateText || !validTime24(closeTimeText))) throw Error("Vui lòng nhập ngày và giờ đóng đăng ký theo định dạng 24 giờ HH:mm.");
    const openValue = openDateText && openTimeText ? dateTimeValue(openDateText, openTimeText) : null;
    const manualCloseValue = data.closeMode === "manual" ? dateTimeValue(closeDateText, closeTimeText) : null;
    if (openDateText && openTimeText && !openValue) throw Error("Ngày hoặc giờ mở đăng ký không hợp lệ.");
    if (data.closeMode === "manual" && !manualCloseValue) throw Error("Ngày hoặc giờ đóng đăng ký không hợp lệ.");
    data.openAt = openValue ? Timestamp.fromDate(openValue) : null;
    if (data.externalRegistration && !/^https:\/\//i.test(data.registrationUrl)) throw Error("Sự kiện Trường/Khoa khác cần liên kết đăng ký bắt đầu bằng https://.");
    if (!data.externalRegistration) data.registrationUrl = "";
    const eventStart = new Date(`${data.date}T${data.startTime || "23:59"}:00`).getTime();
    const eventEnd = new Date(`${data.date}T${data.endTime || data.startTime || "23:59"}:00`).getTime();
    const now = Date.now();
    if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd)) throw Error("Ngày hoặc giờ sự kiện không hợp lệ.");
    const immediateOpenBase = data.openAt?.toMillis() ?? (Number(submit.dataset.immediateOpenBase) || Date.now());
    if (!data.openAt) submit.dataset.immediateOpenBase = String(immediateOpenBase);
    if (data.closeMode === "after12") data.closeAt = Timestamp.fromMillis(immediateOpenBase + 12 * 60 * 60 * 1000);
    else if (data.closeMode === "after24") data.closeAt = Timestamp.fromMillis(immediateOpenBase + 24 * 60 * 60 * 1000);
    else if (data.closeMode === "endOfDay") data.closeAt = Timestamp.fromDate(new Date(`${data.date}T23:59:00`));
    else if (data.closeMode === "manual") data.closeAt = Timestamp.fromDate(manualCloseValue);
    else data.closeAt = null;
    const warnings = [];
    if (data.endTime && !data.startTime) warnings.push("Đã nhập giờ kết thúc nhưng chưa nhập giờ bắt đầu; sự kiện vẫn được lưu là sự kiện cả ngày.");
    if (data.startTime && data.endTime && eventEnd <= eventStart) warnings.push("Giờ kết thúc sự kiện đang trước hoặc bằng giờ bắt đầu.");
    if (!id && eventStart <= now) warnings.push("Ngày và giờ bắt đầu sự kiện đã ở trong quá khứ.");
    if (data.openAt && data.closeAt && data.openAt.toMillis() >= data.closeAt.toMillis()) warnings.push("Thời gian đóng đăng ký đang trước hoặc bằng thời gian mở đăng ký.");
    if (!id && data.closeAt && data.closeAt.toMillis() <= now) warnings.push("Thời gian đóng đăng ký đã ở trong quá khứ.");
    if (data.closeAt && data.closeMode !== "endOfDay" && data.closeAt.toMillis() > eventStart) warnings.push("Thời gian đóng đăng ký đang sau giờ bắt đầu sự kiện.");
    const warningSignature = [id, data.date, data.startTime, data.endTime, data.openAt?.toMillis() || "immediate", data.closeAt?.toMillis() || "admin", data.closeMode, ...warnings].join("|");
    if (warnings.length && submit.dataset.warningSignature !== warningSignature) {
      error.innerHTML = `<b>Cảnh báo ngày giờ chưa hợp lý:</b><ul>${warnings.map((message) => `<li>${safe(message)}</li>`).join("")}</ul><b>Nếu thông tin này là chủ ý, bấm “Vẫn lưu sự kiện”.</b>`;
      error.className = "notice warning";
      submit.dataset.warningSignature = warningSignature;
      submit.textContent = "Vẫn lưu sự kiện";
      keepWarningAction = true;
      return;
    }
    if (!data.allowedFaculties.length) throw Error("Vui lòng chọn ít nhất một khoa/đơn vị.");
    if (new Blob([JSON.stringify(data)]).size > 900000) throw Error("Nội dung mô tả hoặc hình ảnh quá lớn. Vui lòng giảm kích thước hình.");
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
      await updateDoc(doc(db, "events", id), data);
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
      await addDoc(collection(db, "events"), { ...data, sortOrder, registeredCount: 0, createdByUid: user.uid, createdByEmail: user.email.toLowerCase(), createdByName: user.displayName || "", createdAt: serverTimestamp() });
      $("#eventDialog").close();
      notice("Đã lưu sự kiện.", "success");
    }
  } catch (saveError) {
    error.textContent = saveError.message || "Không thể lưu sự kiện.";
    error.className = "notice error";
    error.classList.remove("hidden");
  } finally {
    submit.disabled = false;
    if (!keepWarningAction) {
      submit.textContent = "Lưu sự kiện";
      delete submit.dataset.warningSignature;
      delete submit.dataset.immediateOpenBase;
    }
  }
};

$("#groupForm").onsubmit = async (event) => {
  event.preventDefault();
  const submit = event.submitter || event.target.querySelector('button[type="submit"],button:not([type])');
  const error = $("#groupFormError");
  submit.disabled = true;
  submit.textContent = "Đang lưu…";
  error.classList.add("hidden");
  try {
    const id = $("#groupEditId").value;
    const name = $("#groupName").value.trim();
    const code = shareCode($("#groupShareCode").value || name);
    const unlimited = $("#groupUnlimited").checked;
    const maxRegistrations = Number($("#groupMaxRegistrations").value);
    const bulkStatus = $("#groupBulkStatus").value;
    if (!name || (!unlimited && (!Number.isInteger(maxRegistrations) || maxRegistrations < 1 || maxRegistrations > 20))) throw Error("Vui lòng nhập tên nhóm và giới hạn từ 1 đến 20.");
    if (!code) throw Error("Mã liên kết nhóm không hợp lệ.");
    if (groups.some((item) => item.id !== id && groupCode(item) === code)) throw Error(`Mã liên kết ${code} đã được một nhóm khác sử dụng.`);
    if (id && !unlimited) {
      const groupRegistrations = await fetchRegistrations("groupId", id);
      const countsByUser = new Map();
      groupRegistrations.forEach((item) => countsByUser.set(item.uid || item.email, (countsByUser.get(item.uid || item.email) || 0) + 1));
      const highestCurrentCount = Math.max(0, ...countsByUser.values());
      if (maxRegistrations < highestCurrentCount) throw Error(`Không thể giảm giới hạn xuống ${maxRegistrations}; hiện có người đã đăng ký ${highestCurrentCount} sự kiện trong nhóm.`);
    }
    const groupedEvents = id ? events.filter((item) => item.groupId === id) : [];
    const statusNames = { closed: "kết thúc", hidden: "ẩn", open: "hiển thị lại" };
    if (bulkStatus && groupedEvents.length && !(await confirmAction({ title: "Cập nhật cả nhóm?", message: `Áp dụng trạng thái “${statusNames[bulkStatus]}” cho toàn bộ ${groupedEvents.length} sự kiện trong nhóm này?` }))) throw Error("Đã hủy thay đổi trạng thái nhóm.");
    const effectiveMax = unlimited ? (Number.isInteger(maxRegistrations) && maxRegistrations >= 1 ? maxRegistrations : 2) : maxRegistrations;
    const data = { name, shareCode: code, maxRegistrations: effectiveMax, unlimited, linkOnly: $("#groupLinkOnly").checked, updatedAt: serverTimestamp() };
    if (id) {
      await updateDoc(doc(db, "eventGroups", id), data);
      await Promise.all(groupedEvents.map((item) => updateDoc(doc(db, "events", item.id), { groupName: name, groupMaxRegistrations: effectiveMax, ...(bulkStatus ? { status: bulkStatus } : {}), updatedAt: serverTimestamp() })));
    } else {
      const groupPositions = groups.map(groupPosition).filter(Number.isFinite);
      const sortOrder = groupPositions.length ? Math.min(...groupPositions) - 1 : 0;
      await addDoc(collection(db, "eventGroups"), { ...data, sortOrder, createdByUid: user.uid, createdByEmail: user.email.toLowerCase(), createdAt: serverTimestamp() });
    }
    $("#groupDialog").close();
    notice(bulkStatus && groupedEvents.length ? `Đã cập nhật nhóm và ${statusNames[bulkStatus]} ${groupedEvents.length} sự kiện.` : id ? "Đã cập nhật nhóm sự kiện." : "Đã tạo nhóm sự kiện.", "success");
  } catch (saveError) {
    error.textContent = saveError.message || "Không thể lưu nhóm sự kiện.";
    error.classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.textContent = "Lưu nhóm";
  }
};

async function moveGroup(groupId, direction) {
  const ordered = groups.filter((item) => !item.deletedAt).slice().sort((a, b) => groupPosition(a) - groupPosition(b));
  const from = ordered.findIndex((item) => item.id === groupId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ordered.length) return;
  const selected = ordered[from];
  const target = ordered[to];
  try {
    await Promise.all([
      updateDoc(doc(db, "eventGroups", selected.id), { sortOrder: groupPosition(target), updatedAt: serverTimestamp() }),
      updateDoc(doc(db, "eventGroups", target.id), { sortOrder: groupPosition(selected), updatedAt: serverTimestamp() })
    ]);
    notice("Đã cập nhật vị trí nhóm sự kiện.", "success");
  } catch (error) {
    notice(error.message || "Không thể thay đổi vị trí nhóm.", "error");
  }
}

async function moveEvent(eventId, direction) {
  const selected = events.find((item) => item.id === eventId);
  if (!selected) return;
  const siblings = events.filter((item) => !item.deletedAt && (item.groupId || "__ungrouped__") === (selected.groupId || "__ungrouped__") && isExternalEvent(item) === isExternalEvent(selected)).sort((a, b) => eventPosition(a) - eventPosition(b));
  const from = siblings.findIndex((item) => item.id === eventId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= siblings.length) return;
  const target = siblings[to];
  const selectedPosition = eventPosition(selected);
  const targetPosition = eventPosition(target);
  try {
    await Promise.all([
      updateDoc(doc(db, "events", selected.id), { sortOrder: targetPosition, updatedAt: serverTimestamp() }),
      updateDoc(doc(db, "events", target.id), { sortOrder: selectedPosition, updatedAt: serverTimestamp() })
    ]);
    notice("Đã cập nhật vị trí sự kiện.", "success");
  } catch (error) {
    notice(error.message || "Không thể thay đổi vị trí sự kiện.", "error");
  }
}

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
  const select = event.target.closest("[data-admin-role]");
  if (!select || !isOwner) return;
  try {
    await updateDoc(doc(db, "admins", select.dataset.adminRole), { role: select.value === "subadmin" ? "subadmin" : "admin", updatedAt: serverTimestamp() });
    notice("Đã cập nhật quyền quản trị.", "success");
  } catch (error) {
    notice(error.message || "Không thể cập nhật quyền.", "error");
    render();
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.pane) showPane(button.dataset.pane);
  if (button.dataset.eventFilter) {
    adminStatusFilter = button.dataset.eventFilter;
    document.querySelectorAll(".admin-filter").forEach((item) => item.classList.toggle("active", item.dataset.adminFilter === adminStatusFilter));
    showPane("events");
    render();
  }
  if (button.dataset.registrationFilter !== undefined) showPane("registrations");
  if (button.dataset.adminFilter) {
    adminStatusFilter = button.dataset.adminFilter;
    document.querySelectorAll(".admin-filter").forEach((item) => item.classList.toggle("active", item === button));
    render();
  }
  if (button.dataset.eventView) {
    adminEventView = button.dataset.eventView === "list" ? "list" : "cards";
    localStorage.setItem("ifaa-admin-event-view", adminEventView);
    render();
  }
  if (button.dataset.moveGroup) await moveGroup(button.dataset.moveGroup, Number(button.dataset.direction));
  if (button.dataset.moveEvent) await moveEvent(button.dataset.moveEvent, Number(button.dataset.direction));
  if (button.dataset.newEvent !== undefined) openEvent();
  if (button.dataset.close !== undefined) $("#eventDialog").close();
  if (button.dataset.edit) openEvent(events.find((item) => item.id === button.dataset.edit));
  if (button.dataset.copyEvent) openEvent(events.find((item) => item.id === button.dataset.copyEvent), true);
  if (button.id === "newGroupBtn") openGroup();
  if (button.dataset.closeGroup !== undefined) $("#groupDialog").close();
  if (button.dataset.deleteGroup) {
    const selectedGroup = groups.find((item) => item.id === button.dataset.deleteGroup && !item.deletedAt);
    if (!selectedGroup) return;
    const groupedEvents = events.filter((item) => item.groupId === selectedGroup.id && !item.deletedAt);
    const approved = await confirmAction({
      title: "Chuyển nhóm vào thùng rác?",
      message: groupedEvents.length
        ? `Nhóm “${selectedGroup.name}” và ${groupedEvents.length} sự kiện bên trong sẽ được chuyển vào thùng rác.`
        : `Bạn có chắc muốn chuyển nhóm “${selectedGroup.name}” vào thùng rác?`,
      verification: "XÓA"
    });
    if (!approved) return;
    button.disabled = true;
    button.textContent = "Đang chuyển…";
    try {
      await updateDoc(doc(db, "eventGroups", selectedGroup.id), {
        deletedAt: serverTimestamp(), deletedByUid: user.uid, deletedByEmail: user.email, updatedAt: serverTimestamp()
      });
      await Promise.all(groupedEvents.map((item) => updateDoc(doc(db, "events", item.id), {
        deletedAt: serverTimestamp(), deletedByUid: user.uid, deletedByEmail: user.email,
        deletedPreviousStatus: item.status || "open", deletedWithGroupId: selectedGroup.id, updatedAt: serverTimestamp()
      })));
      notice("Đã chuyển nhóm sự kiện vào thùng rác.", "success");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Xóa nhóm";
      notice(error.message || "Không thể chuyển nhóm vào thùng rác.", "error");
    }
  }
  if (button.dataset.restoreGroup) {
    if (!isOwner) return notice("Chỉ Chủ sở hữu được khôi phục nhóm.", "error");
    const selectedGroup = groups.find((item) => item.id === button.dataset.restoreGroup && item.deletedAt);
    if (!selectedGroup) return;
    const groupedEvents = events.filter((item) => item.deletedWithGroupId === selectedGroup.id && item.deletedAt);
    button.disabled = true;
    try {
      await updateDoc(doc(db, "eventGroups", selectedGroup.id), {
        deletedAt: null, deletedByUid: "", deletedByEmail: "", restoredAt: serverTimestamp(), restoredByEmail: user.email, updatedAt: serverTimestamp()
      });
      await Promise.all(groupedEvents.map((item) => updateDoc(doc(db, "events", item.id), {
        deletedAt: null, deletedByUid: "", deletedByEmail: "", deletedWithGroupId: "",
        status: item.deletedPreviousStatus || item.status || "open", restoredAt: serverTimestamp(), restoredByEmail: user.email, updatedAt: serverTimestamp()
      })));
      notice(`Đã khôi phục nhóm “${selectedGroup.name}” và ${groupedEvents.length} sự kiện.`, "success");
    } catch (error) {
      button.disabled = false;
      notice(error.message || "Không thể khôi phục nhóm.", "error");
    }
  }
  if (button.dataset.purgeGroup) {
    if (!isOwner) return notice("Chỉ Chủ sở hữu được xóa vĩnh viễn.", "error");
    const selectedGroup = groups.find((item) => item.id === button.dataset.purgeGroup && item.deletedAt);
    if (!selectedGroup) return;
    const approved = await confirmAction({
      title: "Xóa vĩnh viễn nhóm?",
      message: `Nhóm “${selectedGroup.name}”, các sự kiện và lượt đăng ký liên quan sẽ bị xóa vĩnh viễn.`,
      verification: "XÓA"
    });
    if (!approved) return;
    button.disabled = true;
    try {
      await permanentlyDeleteGroup(selectedGroup);
      notice("Đã xóa vĩnh viễn nhóm sự kiện.", "success");
    } catch (error) {
      button.disabled = false;
      notice(error.message || "Không thể xóa vĩnh viễn nhóm.", "error");
    }
  }
  if (button.dataset.editGroup) openGroup(groups.find((item) => item.id === button.dataset.editGroup));
  if (button.dataset.calendarEvent) {
    const selectedEvent = events.find((item) => item.id === button.dataset.calendarEvent);
    if (selectedEvent) openGoogleCalendar(selectedEvent);
  }
  if (button.dataset.createEventLink) {
    const selectedEvent = events.find((item) => item.id === button.dataset.createEventLink);
    if (!selectedEvent) return;
    button.disabled = true;
    try {
      const code = createUniqueEventCode();
      await updateDoc(doc(db, "events", selectedEvent.id), { shareCode: code, updatedAt: serverTimestamp() });
      await copyText(eventShareUrl({ ...selectedEvent, shareCode: code }), "Đã tạo và sao chép liên kết sự kiện.");
    } catch (error) {
      button.disabled = false;
      notice(error.message || "Không thể tạo liên kết sự kiện.", "error");
    }
  }
  if (button.dataset.copyEventLink) {
    const selectedEvent = events.find((item) => item.id === button.dataset.copyEventLink);
    if (selectedEvent?.shareCode) await copyText(eventShareUrl(selectedEvent), "Đã sao chép liên kết sự kiện.");
  }
  if (button.dataset.quickRegistrations) await openQuickRegistrations(button.dataset.quickRegistrations);
  if (button.dataset.exportEvent) await downloadRegistrationExcel(button.dataset.exportEvent, "", button);
  if (button.dataset.exportGroup) await downloadRegistrationExcel("", button.dataset.exportGroup, button);
  if (button.dataset.closeQuick !== undefined) $("#quickRegistrationDialog").close();
  if (button.dataset.calendarGroup) downloadGroupCalendar(button.dataset.calendarGroup);
  if (button.dataset.copyGroupLink) {
    const selectedGroup = groups.find((item) => item.id === button.dataset.copyGroupLink);
    const link = groupShareUrl(selectedGroup || { id: button.dataset.copyGroupLink });
    await copyText(link, "Đã sao chép liên kết riêng của nhóm.");
  }
  if (button.dataset.delete) {
    const selected = events.find((item) => item.id === button.dataset.delete);
    if (selected) {
      const registeredCount = Number(selected.registeredCount || 0);
      const approved = await confirmAction({
        title: "Chuyển sự kiện vào thùng rác?",
        message: registeredCount
          ? `Sự kiện “${selected.title}” có ${registeredCount} lượt đăng ký. Danh sách đăng ký sẽ được giữ nguyên.`
          : `Bạn có chắc muốn chuyển sự kiện “${selected.title}” vào thùng rác?`,
        verification: "XÓA"
      });
      if (!approved) return;
      button.disabled = true;
      button.textContent = "Đang chuyển…";
      try {
        await updateDoc(doc(db, "events", selected.id), {
          deletedAt: serverTimestamp(),
          deletedByUid: user.uid,
          deletedByEmail: user.email,
          deletedPreviousStatus: selected.status || "open",
          updatedAt: serverTimestamp()
        });
        notice("Đã chuyển sự kiện vào thùng rác. Danh sách đăng ký vẫn được giữ nguyên.", "success");
      } catch (error) {
        button.disabled = false;
        button.textContent = "Xóa";
        notice(`Không thể chuyển sự kiện vào thùng rác: ${error.message}`, "error");
      }
    }
  }
  if (button.dataset.restoreEvent) {
    if (!isOwner) return notice("Chỉ Chủ sở hữu được khôi phục sự kiện.", "error");
    const selected = events.find((item) => item.id === button.dataset.restoreEvent && item.deletedAt);
    if (!selected) return;
    button.disabled = true;
    try {
      await updateDoc(doc(db, "events", selected.id), {
        deletedAt: null,
        deletedByUid: "",
        deletedByEmail: "",
        restoredAt: serverTimestamp(),
        restoredByEmail: user.email,
        status: selected.deletedPreviousStatus || selected.status || "open",
        updatedAt: serverTimestamp()
      });
      notice(`Đã khôi phục sự kiện “${selected.title}”.`, "success");
    } catch (error) {
      button.disabled = false;
      notice(error.message || "Không thể khôi phục sự kiện.", "error");
    }
  }
  if (button.dataset.purgeEvent) {
    if (!isOwner) return notice("Chỉ Chủ sở hữu được xóa vĩnh viễn.", "error");
    const selected = events.find((item) => item.id === button.dataset.purgeEvent && item.deletedAt);
    if (!selected) return;
    const approved = await confirmAction({
      title: "Xóa vĩnh viễn?",
      message: `Sự kiện “${selected.title}” và toàn bộ lượt đăng ký liên quan sẽ bị xóa vĩnh viễn.`,
      verification: "XÓA"
    });
    if (!approved) return;
    button.disabled = true;
    button.textContent = "Đang xóa…";
    try {
      await permanentlyDeleteEvent(selected);
      notice("Đã xóa vĩnh viễn sự kiện và dữ liệu liên quan.", "success");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Xóa vĩnh viễn";
      notice(error.message || "Không thể xóa vĩnh viễn.", "error");
    }
  }
  if (button.dataset.deleteRegistration) {
    const registration = regs.find((item) => item.id === button.dataset.deleteRegistration);
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
    registrationStatusFilters.clear();
    document.querySelectorAll(".registration-status-filter:checked").forEach((item) => registrationStatusFilters.add(item.value));
    $("#eventFilter").value = "";
    resetRegistrationPage();
    refreshRegistrationFilters();
    renderRegs();
  };
});
$("#registrationPageSize").onchange = async () => {
  registrationPageSize = Number($("#registrationPageSize").value) || 20;
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

$("#resetEventBtn").onclick = async () => {
  const eventId = $("#eventFilter").value;
  const selectedEvent = events.find((item) => item.id === eventId);
  if (!selectedEvent) return;
  const button = $("#resetEventBtn");
  button.disabled = true;
  button.textContent = "Đang kiểm tra…";
  try {
    const list = await fetchRegistrations("eventId", eventId);
    if (!list.length) {
      notice("Sự kiện này không có dữ liệu đăng ký.", "success");
      return;
    }
    if (!(await confirmAction({ title: "Xóa toàn bộ đăng ký?", message: `Xóa toàn bộ ${list.length} lượt đăng ký của sự kiện “${selectedEvent.title}”? Thao tác này không thể hoàn tác.`, verification: "XÓA" }))) return;
    for (let index = 0; index < list.length; index += 1) {
      button.textContent = `Đang xóa ${index + 1}/${list.length}…`;
      await removeRegistration(list[index]);
    }
    await loadRegistrationPage(0);
    notice(`Đã xóa toàn bộ ${list.length} lượt đăng ký.`, "success");
  } catch (error) {
    notice(`Đã dừng khi gặp lỗi: ${error.message}`, "error");
  } finally {
    button.textContent = "Xóa toàn bộ đăng ký";
    renderRegs();
  }
};

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
  return status === "open" ? "Đang mở" : status === "ended" ? "Đã kết thúc" : "Đã chốt danh sách";
}

function validStudentId(value) { return /^(?=.{8,12}$)(?=.*\d)[A-Z0-9]+$/.test(String(value || "").trim().toUpperCase()); }
function normalizeSearch(value) { return String(value || "").trim().toLocaleLowerCase("vi"); }
const MAJOR_BY_CLASS_CODE = { "101": "Thiết kế đồ họa", "102": "Thiết kế công nghiệp", "103": "Thiết kế nội thất", "104": "Thiết kế thời trang", "105": "Nghệ thuật số" };
function highAdminAccess() { return isOwner || currentRole === "admin"; }
function canReopenAttendance(item) {
  if (!item || item.status !== "ended") return false;
  if (highAdminAccess()) return true;
  const endedAt = millis(item.endedAt);
  return isSubAdmin && item.createdByUid === user?.uid && endedAt && Date.now() <= endedAt + 5 * 86400000;
}
function studentRecord(value = {}) {
  const mssv = String(value.mssv || value.identifier || "").trim().toUpperCase();
  const studentClass = String(value.studentClass || value.class || "").trim();
  const classCode = /^\d{6,}$/.test(studentClass) ? studentClass.slice(3, 6) : "";
  const yy = /^1\d{7,}$/.test(mssv) ? Number(mssv.slice(1, 3)) : null;
  return { mssv, name: String(value.name || "").trim().replace(/\s+/g, " "), email: String(value.email || (mssv ? mssv.toLowerCase() + "@student.tdtu.edu.vn" : "")).trim().toLowerCase(), gender: String(value.gender || "").trim(), major: String(value.major || "").trim() || MAJOR_BY_CLASS_CODE[classCode] || "", studentClass, admissionYear: value.admissionYear || (yy !== null ? 2000 + yy : ""), course: value.course || (yy !== null ? yy + 4 : "") };
}
function renderFacultyStudents(rows = facultyStudents) {
  const searching = normalizeSearch($("#facultyStudentSearch")?.value);
  $("#facultyStudentCount").textContent = searching ? `${rows.length} sinh viên` : `${rows.length} đang hiển thị`;
  $("#facultyStudentTotalTop").textContent = `Tổng: ${facultyStudentTotal || rows.length} sinh viên`;
  const edit = (item, field, value, type = "text") => value ? safe(value) : type === "select" ? `<select class="student-inline" data-student-field="${field}" data-student-id="${safe(item.mssv)}"><option value="">— Chọn —</option>${field === "major" ? FACULTY_MAJORS.map((v) => `<option>${safe(v)}</option>`).join("") : '<option>Nam</option><option>Nữ</option>'}</select>` : `<input class="student-inline" data-student-field="${field}" data-student-id="${safe(item.mssv)}" placeholder="Bổ sung..." value="">`;
  $("#facultyStudentRows").innerHTML = rows.map((item) => `<tr><td><b>${safe(item.mssv)}</b></td><td>${edit(item, "name", item.name)}</td><td>${edit(item, "gender", item.gender, "select")}</td><td>${edit(item, "major", item.major, "select")}</td><td>${edit(item, "studentClass", item.studentClass)}</td><td><button class="btn btn-small btn-danger" data-remove-faculty-student="${safe(item.mssv)}">Xóa</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">Không có sinh viên phù hợp.</td></tr>';
  $("#attendanceStudentOptions").innerHTML = rows.map((item) => `<option value="${safe(item.mssv)}">${safe(item.name)}</option><option value="${safe(item.name)}">${safe(item.mssv)}</option>`).join("");
  $("#facultyStudentPageInfo").textContent = `Trang ${facultyStudentPage}`;
  $("#facultyStudentPrev").disabled = facultyStudentPage <= 1;
  $("#facultyStudentNext").disabled = !facultyStudentHasNext;
}
async function loadFacultyStudentMeta() {
  const snap = await getDoc(doc(db, "facultyStudentMeta", "current"));
  let data = snap.exists() ? snap.data() : {};
  if (!snap.exists() && highAdminAccess()) {
    const existing = await getDocs(collection(db, "facultyStudents"));
    const rows = existing.docs.map((item) => studentRecord({ ...item.data(), mssv: item.id }));
    const classesByMajor = {}; rows.forEach((item) => { if (item.major && item.studentClass) (classesByMajor[item.major] ||= []).push(item.studentClass); });
    data = { count: rows.length, majors: rows.map((item) => item.major).filter(Boolean), classes: rows.map((item) => item.studentClass).filter(Boolean), classesByMajor };
    await setDoc(doc(db, "facultyStudentMeta", "current"), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }
  facultyStudentTotal = Number(data.count || 0);
  try { facultyStudentTotal = (await getCountFromServer(collection(db, "facultyStudents"))).data().count; } catch {}
  $("#facultyStudentTotalTop").textContent = `Tổng: ${facultyStudentTotal} sinh viên`;
  const majors = [...new Set([...FACULTY_MAJORS, ...(data.majors || [])])].sort();
  const byMajor = data.classesByMajor || {};
  const classes = [...new Set(data.classes || [])].sort();
  $("#facultyStudentMajorFilter").innerHTML = '<option value="">Tất cả ngành</option>' + majors.map((v) => `<option>${safe(v)}</option>`).join("");
  $("#facultyStudentMajorFilter").onchange = () => { const selected = $("#facultyStudentMajorFilter").value; const filtered = selected && byMajor[selected] ? byMajor[selected] : classes; $("#facultyStudentClassFilter").innerHTML = '<option value="">Tất cả lớp</option>' + [...new Set(filtered)].sort().map((v) => `<option>${safe(v)}</option>`).join(""); };
  $("#facultyStudentClassFilter").innerHTML = '<option value="">Tất cả lớp</option>' + classes.map((v) => `<option>${safe(v)}</option>`).join("");
  await loadExpiredFacultyStudents();
}
function studentTrainingExpired(item) { const year = Number(item.admissionYear); return year > 0 && new Date().getFullYear() > year + 7; }
async function loadExpiredFacultyStudents() {
  try {
    const snapshot = await getDocs(collection(db, "facultyStudents"));
    expiredFacultyStudents = snapshot.docs.map((item) => studentRecord({ ...item.data(), mssv: item.id })).filter(studentTrainingExpired);
    const notice = $("#facultyStudentExpiredNotice");
    if (!expiredFacultyStudents.length) { notice.classList.add("hidden"); $("#facultyStudentExpiredPanel").classList.add("hidden"); return; }
    notice.textContent = `Có ${expiredFacultyStudents.length} sinh viên đã hết hạn đào tạo`;
    notice.classList.remove("hidden");
    $("#facultyStudentExpiredRows").innerHTML = expiredFacultyStudents.map((item) => `<tr><td><b>${safe(item.mssv)}</b></td><td>${safe(item.name)}</td><td>${safe(item.admissionYear)}</td><td>K${safe(item.course)}</td><td><button class="btn btn-small btn-danger" data-remove-expired-student="${safe(item.mssv)}">Xóa</button></td></tr>`).join("");
  } catch (error) { notice("Không thể kiểm tra sinh viên hết hạn: " + error.message, "error"); }
}
async function loadFacultyStudentPage(reset = false) {
  if (reset) { facultyStudentPage = 1; facultyStudentCursor = null; }
  const search = normalizeSearch($("#facultyStudentSearch").value), major = $("#facultyStudentMajorFilter").value, studentClass = $("#facultyStudentClassFilter").value, size = Number($("#facultyStudentPageSize").value || 15);
  if (search && validStudentId(search.toUpperCase())) {
    const snap = await getDoc(doc(db, "facultyStudents", search.toUpperCase())); facultyStudents = snap.exists() ? [studentRecord({ ...snap.data(), mssv: snap.id })] : []; facultyStudentHasNext = false;
  } else {
    if (search) {
      const all = await getDocs(query(collection(db, "facultyStudents"), limit(5000)));
      facultyStudents = all.docs.map((item) => studentRecord({ ...item.data(), mssv: item.id })).filter((item) => normalizeSearch(item.name).includes(search) && (!major || item.major === major) && (!studentClass || item.studentClass === studentClass));
      facultyStudentHasNext = false;
      $("#facultyStudentPrompt").classList.add("hidden"); $("#facultyStudentTableWrap").classList.remove("hidden"); renderFacultyStudents(facultyStudents.slice(0, size)); return;
    }
    const constraints = []; if (studentClass) constraints.push(where("studentClass", "==", studentClass)); else if (major) constraints.push(where("major", "==", major)); constraints.push(limit(size)); if (facultyStudentCursor) constraints.push(startAfter(facultyStudentCursor));
    const snap = await getDocs(query(collection(db, "facultyStudents"), ...constraints)); facultyStudents = snap.docs.map((item) => studentRecord({ ...item.data(), mssv: item.id })).filter((item) => !major || item.major === major); facultyStudentCursor = snap.docs.at(-1) || null; facultyStudentHasNext = snap.docs.length === size;
    if (search) facultyStudents = facultyStudents.filter((item) => normalizeSearch(item.name).includes(search));
  }
  $("#facultyStudentPrompt").classList.add("hidden"); $("#facultyStudentTableWrap").classList.remove("hidden"); renderFacultyStudents();
}
function resolveFacultyStudent(value) {
  const key = normalizeSearch(value);
  const exact = facultyStudents.filter((item) => normalizeSearch(item.mssv) === key || normalizeSearch(item.name) === key);
  if (exact.length === 1) return studentRecord(exact[0]);
  const partial = facultyStudents.filter((item) => normalizeSearch(item.mssv).includes(key) || normalizeSearch(item.name).includes(key));
  return partial.length === 1 ? studentRecord(partial[0]) : null;
}
function mergeAttendancePermissions(records) {
  const map = new Map(attendancePermissionMembers.map((item) => [item.mssv, item]));
  records.forEach((value) => { const item = studentRecord(value); if (validStudentId(item.mssv) && item.name) map.set(item.mssv, { ...map.get(item.mssv), ...item, role: value.role === "leader" ? "leader" : "scanner" }); });
  attendancePermissionMembers = [...map.values()];
  renderAttendancePermissions();
}
function renderAttendancePermissions() {
  $("#attendancePermissionRows").innerHTML = attendancePermissionMembers.map((item) => `<tr><td><b>${safe(item.mssv)}</b></td><td>${safe(item.name)}</td><td>${item.role === "leader" ? "SV Leader" : "SV quét"}</td><td><button type="button" class="btn btn-small" data-remove-attendance-permission="${safe(item.mssv)}">Xóa</button></td></tr>`).join("") || '<tr><td colspan="4" class="empty">Chưa cấp quyền cho sinh viên.</td></tr>';
}
function populatePermissionCopyOptions() {
  const select = $("#attendanceCopyPermissionsFrom");
  if (!select) return;
  select.innerHTML = '<option value="">— Copy quyền từ sự kiện khác —</option>' + attendanceSessions.map((item) => `<option value="${item.id}">${safe(item.title)} · ${safe(vietnamDate(item.date))}</option>`).join("");
}
function downloadWorkbook(filename, sheetName, rows) {
  const sheet = XLSX.utils.json_to_sheet(rows), workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  XLSX.writeFile(workbook, filename);
}

function renderAttendance() {
  const target = $("#attendanceRows");
  if (!target) return;
  const list = attendanceSessions
    .filter((item) => attendanceFilter === "all" || item.status === attendanceFilter)
    .sort((a, b) => (millis(b.createdAt) || 0) - (millis(a.createdAt) || 0));
  target.innerHTML = list.length ? list.map((item) => `<article class="att-row">
    <div><span class="att-badge ${safe(item.status)}">${safe(attendanceStatusLabel(item.status))}</span>
    <h3>${safe(item.title)}</h3><div class="att-meta">${safe(vietnamDate(item.date))} · ${safe(item.location || "")} · ${Number(item.rosterCount || 0)} sinh viên</div></div>
    <div class="att-actions"><button class="btn" data-attendance-manage="${item.id}">Quản lý điểm danh</button></div>
  </article>`).join("") : '<div class="card empty">Không có sự kiện điểm danh trong bộ lọc này.</div>';
}

function populateAttendanceEventOptions(selectedId = "") {
  const select = $("#attendanceSourceEvent");
  if (!select) return;
  const existing = new Set(attendanceSessions.map((item) => item.eventId));
  const eligible = events.filter((item) => attendanceSourceEligible(item) && !existing.has(item.id));
  select.innerHTML = '<option value="">— Điểm danh độc lập —</option>' + eligible.map((item) =>
    `<option value="${item.id}" ${item.id === selectedId ? "selected" : ""}>${safe(item.title)} · ${safe(vietnamDate(item.date))}</option>`
  ).join("");
}

function attendanceSourceEligible(item) {
  return !!item && !item.deletedAt && item.status !== "hidden" && !isExternalEvent(item)
    && Array.isArray(item.allowedFaculties) && item.allowedFaculties.includes(DEFAULT_FACULTY)
    && eventState(item) === "ended";
}

function attendanceCode() {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return (values[0].toString(36) + values[1].toString(36)).slice(0, 9).toUpperCase();
}

async function loadAttendanceManage() {
  if (!selectedAttendanceSession) return;
  const sessionId = selectedAttendanceSession.id;
  const [assignmentSnapshot, checkinSnapshot, rosterSnapshot, grantSnapshot] = await Promise.all([
    getDocs(query(collection(db, "scannerAssignments"), where("sessionId", "==", sessionId))),
    getDocs(query(collection(db, "checkins"), where("sessionId", "==", sessionId))),
    getDocs(query(collection(db, "attendanceRoster"), where("sessionId", "==", sessionId))),
    isSubAdmin ? Promise.resolve({ docs: [] }) : getDocs(query(collection(db, "attendanceGrants"), where("sessionId", "==", sessionId)))
  ]);
  attendanceRoster = rosterSnapshot.docs.map((item) => item.data());
  const grants = new Map(grantSnapshot.docs.map((item) => [item.id, item.data()]));
  $("#attendanceGrantedByHead").classList.toggle("hidden", isSubAdmin);
  $("#attendanceScannerRows").innerHTML = assignmentSnapshot.docs.map((item) => {
    const data = item.data();
    const grant = grants.get(item.id) || {};
    return `<tr><td>${safe(data.mssv)}</td><td>${safe(data.name)}</td><td>${data.role === "leader" ? "SV Leader" : "SV quét"}</td>
      <td class="${isSubAdmin ? "hidden" : ""}">${safe(grant.grantedByName || grant.grantedByEmail || "")}</td>
      <td><button class="btn btn-small" data-attendance-remove-scanner="${item.id}" ${selectedAttendanceSession.status === "finalized" ? "disabled" : ""}>Xóa</button></td></tr>`;
  }).join("") || '<tr><td colspan="5" class="empty">Chưa cấp quyền cho sinh viên quét.</td></tr>';
  $("#attendanceCheckinRows").innerHTML = checkinSnapshot.docs.filter((item) => !item.data().deletedAt).map((item) => {
    const data = item.data();
    return `<tr><td>${safe(data.mssv)}</td><td>${safe(data.name)}</td><td>${safe(ts(data.checkedAt))}</td><td>${safe(data.scannerName || data.scannerMssv || "")}</td></tr>`;
  }).join("") || '<tr><td colspan="4" class="empty">Chưa có lượt điểm danh.</td></tr>';
}

async function openAttendanceManage(sessionId) {
  selectedAttendanceSession = attendanceSessions.find((item) => item.id === sessionId);
  if (!selectedAttendanceSession) return;
  $("#attendanceManageTitle").textContent = selectedAttendanceSession.title;
  $("#attendanceManageMeta").textContent = `${attendanceStatusLabel(selectedAttendanceSession.status)} · ${vietnamDate(selectedAttendanceSession.date)}`;
  $("#attendanceEnd").classList.toggle("hidden", selectedAttendanceSession.status !== "open");
  $("#attendanceFinalize").disabled = !highAdminAccess() || selectedAttendanceSession.status === "finalized";
  $("#attendanceReopen").classList.toggle("hidden", !canReopenAttendance(selectedAttendanceSession));
  $("#attendanceScannerForm").classList.toggle("hidden", selectedAttendanceSession.status !== "open");
  $("#attendanceManageDialog").showModal();
  await loadAttendanceManage();
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
    const mssv = String(row[mssvKey] || "").trim().toUpperCase(), known = facultyStudents.find((item) => item.mssv === mssv), roleText = normalizeSearch(row[roleKey]);
    return { mssv, name: String(row[nameKey] || known?.name || "").trim(), email: known?.email || "", role: /leader|truong|nhom/.test(roleText) ? "leader" : "scanner" };
  }).filter((item) => validStudentId(item.mssv) && item.name);
}

async function readFacultyStudentFile(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]), find = (...names) => keys.find((key) => names.includes(normalizeAttendanceHeader(key)));
  const mssvKey = find("mssv", "masv", "masinhvien", "studentid"), nameKey = find("hoten", "hovaten", "name", "fullname"), familyKey = find("holot", "hodem", "ho"), givenKey = find("ten", "firstname"), genderKey = find("gioitinh", "gender"), majorKey = find("nganh", "nganhhoc", "major"), classKey = find("lop", "lopquanly", "class");
  if (!mssvKey || (!nameKey && !(familyKey && givenKey))) throw Error("File danh sách SV khoa cần có cột MSSV và Họ và tên (hoặc Họ lót + Tên).");
  return rows.map((row) => studentRecord({ mssv: row[mssvKey], name: nameKey ? row[nameKey] : `${row[familyKey] || ""} ${row[givenKey] || ""}`, gender: row[genderKey], major: row[majorKey], studentClass: row[classKey] })).filter((item) => validStudentId(item.mssv) && item.name);
}

async function saveFacultyStudents(records) {
  if (!highAdminAccess()) throw Error("Chỉ Chủ sở hữu hoặc Admin cấp cao được cập nhật danh sách SV khoa.");
  const unique = [...new Map(records.map(studentRecord).filter((item) => validStudentId(item.mssv) && item.name).map((item) => [item.mssv, item])).values()];
  for (let offset = 0; offset < unique.length; offset += 450) {
    const batch = writeBatch(db);
    unique.slice(offset, offset + 450).forEach((item) => batch.set(doc(db, "facultyStudents", item.mssv), { ...item, nameLower: normalizeSearch(item.name), updatedByUid: user.uid, updatedByEmail: user.email, updatedAt: serverTimestamp() }, { merge: true }));
    await batch.commit();
  }
  const meta = await getDoc(doc(db, "facultyStudentMeta", "current"));
  const old = meta.exists() ? meta.data() : {};
  const classesByMajor = { ...(old.classesByMajor || {}) }; unique.forEach((item) => { if (item.major && item.studentClass) classesByMajor[item.major] = [...new Set([...(classesByMajor[item.major] || []), item.studentClass])]; });
  await setDoc(doc(db, "facultyStudentMeta", "current"), {
    count: (await getCountFromServer(collection(db, "facultyStudents"))).data().count,
    majors: [...new Set([...(old.majors || []), ...unique.map((item) => item.major).filter(Boolean)])],
    classes: [...new Set([...(old.classes || []), ...unique.map((item) => item.studentClass).filter(Boolean)])].sort(), classesByMajor,
    updatedAt: serverTimestamp()
  }, { merge: true });
  await loadFacultyStudentMeta();
  return unique.length;
}

function fillAttendanceForm(eventId = "") {
  populateAttendanceEventOptions(eventId);
  const selected = events.find((item) => item.id === eventId);
  const today = new Date().toISOString().slice(0, 10);
  $("#attendanceSourceEvent").value = selected?.id || "";
  $("#attendanceStandaloneTitle").value = selected?.title || "";
  $("#attendanceStandaloneDate").value = selected?.date || today;
  $("#attendanceStandaloneEndDate").value = selected?.date || today;
  $("#attendanceStandaloneLocation").value = selected?.location || "";
  $("#attendanceStandaloneStartTime").value = selected?.startTime || "";
  $("#attendanceStandaloneEndTime").value = selected?.endTime || "";
  attendancePermissionMembers = [];
  renderAttendancePermissions();
  populatePermissionCopyOptions();
  $("#attendancePermissionLookup").value = "";
  $("#attendanceManualPermission").classList.add("hidden");
  attendanceRosterImport = [];
  $("#attendanceRosterFile").value = "";
  $("#attendanceRosterFileName").textContent = "Chưa chọn tệp (không bắt buộc)";
}

async function createStandaloneAttendance() {
  const eventId = $("#attendanceSourceEvent").value;
  const title = $("#attendanceStandaloneTitle").value.trim();
  const date = $("#attendanceStandaloneDate").value;
  const endDate = $("#attendanceStandaloneEndDate").value;
  const location = $("#attendanceStandaloneLocation").value.trim();
  const startTime = $("#attendanceStandaloneStartTime").value;
  const endTime = $("#attendanceStandaloneEndTime").value;
  if (!title || !date || !endDate) throw Error("Vui lòng nhập tên, ngày tổ chức và ngày kết thúc điểm danh.");
  const startDay = new Date(date + "T12:00:00"), finishDay = new Date(endDate + "T12:00:00");
  if (finishDay < startDay) throw Error("Ngày kết thúc không được trước ngày tổ chức.");
  if ((finishDay - startDay) / 86400000 > 5) throw Error("Ngày kết thúc điểm danh tối đa 5 ngày sau ngày tổ chức.");
  if (startTime && endTime && endTime <= startTime && date === endDate) throw Error("Giờ kết thúc phải sau giờ bắt đầu.");
  if (eventId && attendanceSessions.some((item) => item.eventId === eventId)) throw Error("Sự kiện này đã có phiên điểm danh.");
  if (eventId && !attendanceSourceEligible(events.find((item) => item.id === eventId))) throw Error("Sự kiện nguồn phải thuộc khoa, đang hiển thị và đã kết thúc đăng ký.");
  const sessionId = attendanceCode();
  let sourceRoster = [];
  if (eventId) {
    const registrationSnapshot = await getDocs(query(collection(db, "registrations"), where("eventId", "==", eventId)));
    sourceRoster = registrationSnapshot.docs.map((item) => {
      const data = item.data();
      return { ...data, mssv: String(data.identifier || data.mssv || "").trim().toUpperCase(), email: String(data.email || "").trim().toLowerCase() };
    });
  } else if (!attendanceRosterImport.length) {
    const studentSnapshot = await getDocs(collection(db, "facultyStudents"));
    sourceRoster = studentSnapshot.docs.map((item) => studentRecord({ ...item.data(), mssv: item.id }));
  }
  const rosterMap = new Map();
  [...sourceRoster, ...attendanceRosterImport].forEach((item) => {
    if (/^(?=.{8,12}$)(?=.*\d)[A-Z0-9]+$/.test(item.mssv || "")) rosterMap.set(item.mssv, { ...rosterMap.get(item.mssv), ...item });
  });
  const roster = [...rosterMap.values()];
  if (!roster.length) throw Error("Danh sách đối chiếu chưa có sinh viên.");
  const permissionMembers = attendancePermissionMembers;
  const writes = [
    { ref: doc(db, "attendanceSessions", sessionId), data: { eventId, source: eventId ? "registration" : "standalone", title, date, endDate, endAt: Timestamp.fromDate(new Date(endDate + "T23:59:59")), location, startTime, endTime, status: "open", rosterCount: roster.length, createdByUid: user.uid, createdByEmail: user.email, createdByName: user.displayName || "", createdAt: serverTimestamp() } },
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
  notice(`Đã tạo điểm danh với ${roster.length} sinh viên và ${permissionMembers.length} tài khoản được cấp quyền.`, "success");
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

$("#attendanceSourceEvent").onchange = (event) => {
  const selected = events.find((item) => item.id === event.target.value);
  if (!selected) return;
  $("#attendanceStandaloneTitle").value = selected.title || "";
  $("#attendanceStandaloneDate").value = selected.date || "";
  $("#attendanceStandaloneEndDate").value = selected.date || "";
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

$("#attendancePermissionAdd").onclick = () => {
  const student = resolveFacultyStudent($("#attendancePermissionLookup").value);
  if (!student) {
    $("#attendanceManualPermission").classList.remove("hidden");
    const raw = $("#attendancePermissionLookup").value.trim();
    if (validStudentId(raw)) $("#attendanceManualMssv").value = raw.toUpperCase(); else $("#attendanceManualName").value = raw;
    return notice("Không tìm thấy duy nhất một sinh viên. Vui lòng nhập thủ công hoặc nhập đầy đủ MSSV/họ tên.", "error");
  }
  mergeAttendancePermissions([{ ...student, role: $("#attendancePermissionRole").value }]);
  $("#attendancePermissionLookup").value = "";
};
$("#attendanceShowManual").onclick = () => $("#attendanceManualPermission").classList.toggle("hidden");
$("#attendanceManualAdd").onclick = () => {
  const item = studentRecord({ mssv: $("#attendanceManualMssv").value, name: $("#attendanceManualName").value });
  if (!validStudentId(item.mssv) || !item.name) return notice("Nhập MSSV hợp lệ và họ tên sinh viên.", "error");
  mergeAttendancePermissions([{ ...item, role: $("#attendanceManualRole").value }]);
  $("#attendanceManualMssv").value = ""; $("#attendanceManualName").value = ""; $("#attendanceManualPermission").classList.add("hidden");
};
$("#attendancePermissionRows").onclick = (event) => {
  const button = event.target.closest("[data-remove-attendance-permission]");
  if (!button) return;
  attendancePermissionMembers = attendancePermissionMembers.filter((item) => item.mssv !== button.dataset.removeAttendancePermission);
  renderAttendancePermissions();
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

$("#facultyStudentSearchBtn").onclick = () => loadFacultyStudentPage(true).catch((error) => notice(error.message, "error"));
$("#facultyStudentLoadBtn").onclick = () => loadFacultyStudentPage(true).catch((error) => notice(error.message, "error"));
$("#facultyStudentNext").onclick = () => { facultyStudentPage += 1; loadFacultyStudentPage().catch((error) => notice(error.message, "error")); };
$("#facultyStudentPrev").onclick = () => { if (facultyStudentPage > 1) { facultyStudentPage -= 1; facultyStudentCursor = null; loadFacultyStudentPage(true).catch((error) => notice(error.message, "error")); } };
$("#facultyStudentResetBtn").onclick = () => { $("#facultyStudentSearch").value = ""; $("#facultyStudentMajorFilter").value = ""; $("#facultyStudentClassFilter").value = ""; facultyStudentPage = 1; facultyStudentCursor = null; $("#facultyStudentTableWrap").classList.add("hidden"); $("#facultyStudentPrompt").classList.remove("hidden"); $("#facultyStudentCount").textContent = "0 sinh viên"; };
$("#facultyStudentForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const count = await saveFacultyStudents([{ mssv: $("#facultyStudentMssv").value, name: $("#facultyStudentName").value, gender: $("#facultyStudentGender").value, major: $("#facultyStudentMajor").value, studentClass: $("#facultyStudentClass").value }]);
    event.target.reset(); notice(`Đã lưu ${count} sinh viên.`, "success");
  } catch (error) { notice(error.message, "error"); }
};
$("#facultyStudentFile").onchange = async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try { const rows = await readFacultyStudentFile(file), count = await saveFacultyStudents(rows); notice(`Đã cập nhật ${count} sinh viên vào danh sách khoa.`, "success"); }
  catch (error) { notice(error.message, "error"); }
  event.target.value = "";
};
$("#facultyStudentTemplate").onclick = () => downloadWorkbook("MAU_DANH_SACH_SV_KHOA.xlsx", "Danh sach SV khoa", [{ MSSV: "12300325", "Họ và tên": "Nguyễn Văn A", "Giới tính": "Nam", "Ngành": "Thiết kế nội thất", "Lớp": "230H0101" }]);
$("#facultyStudentExport").onclick = () => downloadWorkbook("DANH_SACH_SV_KHOA.xlsx", "Danh sach SV khoa", facultyStudents.map((item, index) => ({ STT: index + 1, MSSV: item.mssv, "Họ và tên": item.name, "Giới tính": item.gender, "Ngành": item.major, "Lớp": item.studentClass })));
$("#facultyStudentRows").onchange = async (event) => {
  const field = event.target.closest("[data-student-field]"); if (!field) return;
  try { await setDoc(doc(db, "facultyStudents", field.dataset.studentId), { [field.dataset.studentField]: field.value.trim(), ...(field.dataset.studentField === "name" ? { nameLower: normalizeSearch(field.value) } : {}), updatedByUid: user.uid, updatedAt: serverTimestamp() }, { merge: true }); notice("Đã tự lưu thông tin sinh viên.", "success"); }
  catch (error) { notice("Không thể tự lưu: " + error.message, "error"); }
};
$("#facultyStudentRows").onclick = async (event) => {
  const button = event.target.closest("[data-remove-faculty-student]"); if (!button) return;
  const approved = await confirmAction({ title: "Xóa sinh viên?", message: `Xóa MSSV ${button.dataset.removeFacultyStudent} khỏi danh sách SV khoa?` });
  if (approved) await deleteDoc(doc(db, "facultyStudents", button.dataset.removeFacultyStudent));
};
$("#facultyStudentExpiredNotice").onclick = () => $("#facultyStudentExpiredPanel").classList.toggle("hidden");
$("#facultyStudentExpiredRows").onclick = async (event) => {
  const button = event.target.closest("[data-remove-expired-student]"); if (!button) return;
  if (!(await confirmAction({ title: "Xóa sinh viên hết hạn?", message: `Xóa MSSV ${button.dataset.removeExpiredStudent} khỏi danh sách khoa?` }))) return;
  await deleteDoc(doc(db, "facultyStudents", button.dataset.removeExpiredStudent)); await loadExpiredFacultyStudents();
};
$("#facultyStudentExpiredDeleteAll").onclick = async () => {
  if (!expiredFacultyStudents.length || !(await confirmAction({ title: "Xóa toàn bộ sinh viên hết hạn?", message: `Xóa ${expiredFacultyStudents.length} sinh viên hết hạn khỏi danh sách khoa?` }))) return;
  for (let offset = 0; offset < expiredFacultyStudents.length; offset += 450) { const batch = writeBatch(db); expiredFacultyStudents.slice(offset, offset + 450).forEach((item) => batch.delete(doc(db, "facultyStudents", item.mssv))); await batch.commit(); }
  await loadExpiredFacultyStudents(); await loadFacultyStudentMeta(); notice("Đã xóa danh sách sinh viên hết hạn.", "success");
};

$("#attendanceScannerForm").onsubmit = async (event) => {
  event.preventDefault();
  const keyword = $("#attendanceScannerLookup").value.trim().toLocaleLowerCase("vi");
  const student = attendanceRoster.find((item) => item.mssv.toLocaleLowerCase("vi") === keyword || item.name.toLocaleLowerCase("vi") === keyword) || resolveFacultyStudent(keyword);
  if (!student) return notice("Không tìm thấy sinh viên trong danh sách sự kiện hoặc danh sách SV khoa.", "error");
  const email = student.email || student.mssv.toLowerCase() + "@student.tdtu.edu.vn";
  const assignmentId = selectedAttendanceSession.id + "_" + email;
  await setDoc(doc(db, "scannerAssignments", assignmentId), { sessionId: selectedAttendanceSession.id, email, mssv: student.mssv, name: student.name, role: $("#attendanceScannerRole").value, active: true, grantedAt: serverTimestamp() });
  await setDoc(doc(db, "attendanceGrants", assignmentId), { sessionId: selectedAttendanceSession.id, assignmentId, grantedAt: serverTimestamp(), grantedByEmail: user.email, grantedByName: user.displayName || user.email });
  $("#attendanceScannerLookup").value = "";
  await loadAttendanceManage();
  notice("Đã cấp quyền quét.", "success");
};

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.id === "newAttendanceBtn") {
    $("#attendanceCreateForm").reset();
    fillAttendanceForm();
    $("#attendanceCreateDialog").showModal();
  }
  if (button.dataset.closeAttendanceCreate !== undefined) $("#attendanceCreateDialog").close();
  if (button.dataset.closeAttendanceManage !== undefined) $("#attendanceManageDialog").close();
  if (button.dataset.attendanceFilter) {
    attendanceFilter = button.dataset.attendanceFilter;
    document.querySelectorAll(".attendance-filter").forEach((item) => item.classList.toggle("active", item === button));
    renderAttendance();
  }
  if (button.dataset.attendanceEvent) {
    const existing = attendanceSessions.find((item) => item.eventId === button.dataset.attendanceEvent);
    if (existing) await openAttendanceManage(existing.id);
    else {
      const sourceEvent = events.find((item) => item.id === button.dataset.attendanceEvent);
      if (!attendanceSourceEligible(sourceEvent)) return notice("Chỉ tạo điểm danh từ sự kiện của khoa, đang hiển thị và đã kết thúc đăng ký.", "error");
      fillAttendanceForm(button.dataset.attendanceEvent);
      $("#attendanceCreateDialog").showModal();
    }
  }
  if (button.dataset.attendanceManage) await openAttendanceManage(button.dataset.attendanceManage);
  if (button.dataset.attendanceRemoveScanner) {
    await deleteDoc(doc(db, "scannerAssignments", button.dataset.attendanceRemoveScanner));
    if (highAdminAccess()) await deleteDoc(doc(db, "attendanceGrants", button.dataset.attendanceRemoveScanner));
    await loadAttendanceManage();
  }
});

$("#attendanceCopyLink").onclick = async () => {
  await copyText(attendanceShareUrl(selectedAttendanceSession.id), "Đã sao chép link quét điểm danh.");
};
$("#attendanceEnd").onclick = async () => {
  const approved = await confirmAction({ title: "Kết thúc sự kiện?", message: "Sau khi kết thúc, sinh viên sẽ không thể quét thêm. Chủ sở hữu/Admin cấp cao luôn có thể mở lại; Sub-admin có 5 ngày để mở lại sự kiện do mình tạo." });
  if (!approved) return;
  await updateDoc(doc(db, "attendanceSessions", selectedAttendanceSession.id), { status: "ended", endedAt: serverTimestamp(), endedByUid: user.uid, endedByEmail: user.email });
  $("#attendanceManageDialog").close();
};
$("#attendanceFinalize").onclick = async () => {
  const approved = await confirmAction({ title: "Chốt danh sách điểm danh?", message: "Sau khi chốt sẽ không thể chỉnh sửa danh sách. Bạn có chắc muốn tiếp tục?" });
  if (!approved) return;
  await updateDoc(doc(db, "attendanceSessions", selectedAttendanceSession.id), { status: "finalized", finalizedAt: serverTimestamp(), finalizedBy: user.email });
  $("#attendanceManageDialog").close();
};
$("#attendanceReopen").onclick = async () => {
  if (!canReopenAttendance(selectedAttendanceSession)) return notice("Bạn không còn quyền mở lại sự kiện này.", "error");
  const update = { status: "open", endedAt: null, endedByUid: "", endedByEmail: "", reopenedAt: serverTimestamp(), reopenedBy: user.email };
  if ((millis(selectedAttendanceSession.endAt) || 0) <= Date.now()) {
    const now = new Date(), local = new Date(now.getTime() - now.getTimezoneOffset() * 60000), endDate = local.toISOString().slice(0, 10);
    update.endDate = endDate;
    update.endAt = Timestamp.fromDate(new Date(endDate + "T23:59:59"));
  }
  await updateDoc(doc(db, "attendanceSessions", selectedAttendanceSession.id), update);
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
    if (error?.code !== "auth/popup-closed-by-user" && error?.code !== "auth/cancelled-popup-request") {
      const code = error?.code || "auth/unknown";
      showAdminLoginNotice(`Lỗi đăng nhập (${code}): ${error?.message || "Không xác định được nguyên nhân."}`);
    }
  }
};
$("#logoutBtn").onclick = () => signOut(auth);

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
  $("#trashNav").classList.toggle("hidden", !isOwner);
  $("#studentsNav").classList.toggle("hidden", !highAdminAccess());
  listen();
});
