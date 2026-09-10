import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, onSnapshot, query, where, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { firebaseConfig, STUDENT_DOMAIN } from "./firebase-config.mjs";

const DEFAULT_FACULTY = "Khoa Mỹ thuật Công nghiệp";
const DEFAULT_CATEGORY = "Sự kiện Khoa";
const EVENT_CATEGORIES = ["Sự kiện Khoa", "Ngành Đồ họa", "Ngành Thiết kế công nghiệp", "Ngành Thiết kế nội thất", "Ngành Thiết kế thời trang", "Ngành Nghệ thuật số"];
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const $ = (selector) => document.querySelector(selector);
const safe = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const millis = (value) => value?.toDate ? value.toDate().getTime() : (value ? new Date(value).getTime() : null);
const studentIdentifier = (email) => String(email || "").toLowerCase().endsWith(STUDENT_DOMAIN) ? String(email).split("@")[0].toUpperCase() : "";
const linkedGroupId = new URLSearchParams(window.location.search).get("e")?.trim() || "";

function shareCode(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).toUpperCase();
}

function groupCode(group) {
  return shareCode(group?.shareCode || group?.name) || group?.id || "";
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
    return `${calendarStamp(start, true)}/${calendarStamp(end, true)}`;
  }
  const start = new Date(`${event.date}T${event.startTime}:00`);
  let end = new Date(`${event.date}T${event.endTime || event.startTime}:00`);
  if (!Number.isFinite(start.getTime())) return null;
  if (!Number.isFinite(end.getTime()) || end <= start) end = new Date(start.getTime() + 3600000);
  return `${calendarStamp(start)}/${calendarStamp(end)}`;
}

function eventCalendarUrl(event) {
  const range = calendarRange(event);
  if (!range) return "";
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", event.title || "Sự kiện IFA+A");
  url.searchParams.set("dates", range);
  url.searchParams.set("ctz", "Asia/Ho_Chi_Minh");
  url.searchParams.set("location", event.location || "");
  const detail = [event.description || "", "Thông tin từ hệ thống đăng ký sự kiện IFA+A."].filter(Boolean).join("\n\n").slice(0, 1800);
  url.searchParams.set("details", detail);
  return url.toString();
}

function openGoogleCalendar(event) {
  const url = eventCalendarUrl(event);
  if (!url) return show("Ngày hoặc giờ sự kiện chưa hợp lệ.", "error");
  window.open(url, "_blank", "noopener,noreferrer");
}

function sanitizeRichHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  const allowed = new Set(["P", "DIV", "BR", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "H2", "H3", "SPAN", "FONT", "IMG", "A"]);
  [...template.content.querySelectorAll("*")].forEach((node) => {
    if (!allowed.has(node.tagName)) return node.replaceWith(...node.childNodes);
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (node.tagName === "IMG" && ["src", "alt"].includes(name)) return;
      if (node.tagName === "A" && ["href", "target", "rel"].includes(name)) return;
      if (["style", "color", "size"].includes(name)) return;
      node.removeAttribute(attribute.name);
    });
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") || "";
      if (!/^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/i.test(src)) node.remove();
      else { node.loading = "lazy"; node.alt ||= "Hình minh họa sự kiện"; }
    }
    if (node.tagName === "A") {
      const href = node.getAttribute("href") || "";
      if (!/^https:\/\//i.test(href)) node.removeAttribute("href");
      else { node.target = "_blank"; node.rel = "noopener noreferrer"; }
    }
  });
  return template.innerHTML;
}

let user = null;
let profile = null;
let events = [];
let myRegs = new Map();
let groupLimits = new Map();
let groups = new Map();
let groupsLoaded = false;
let settings = { faculties: [DEFAULT_FACULTY] };
let filter = "available";
let categoryFilter = "";
let studentGroupFilter = "";
let chosen = null;
let unsubscribers = [];

const tdtuEmail = (email) => {
  const value = String(email || "").toLowerCase();
  return value.endsWith(STUDENT_DOMAIN) || value.endsWith("@tdtu.edu.vn");
};
const participantType = (email) => String(email || "").toLowerCase().endsWith(STUDENT_DOMAIN)
  ? "Sinh viên"
  : String(email || "").toLowerCase().endsWith("@tdtu.edu.vn") ? "Giảng viên/Nhân sự" : "Admin";

async function participantAccess(currentUser) {
  if (tdtuEmail(currentUser.email)) return true;
  return (await getDoc(doc(db, "admins", currentUser.email.toLowerCase()))).exists();
}

function show(message, type = "") {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = `notice ${type}`;
  notice.classList.remove("hidden");
  setTimeout(() => notice.classList.add("hidden"), 6000);
}

function formatDate(event) {
  try {
    return new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${event.date}T00:00:00`));
  } catch {
    return event.date;
  }
}

function formatDateTime(value) {
  const time = millis(value);
  if (!time) return "chưa thiết lập";
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(time));
}

function eventSchedule(event) {
  if (!event.startTime) return `${formatDate(event)} · Cả ngày`;
  return `${formatDate(event)} · ${event.startTime}${event.endTime ? `–${event.endTime}` : ""}${dayPeriod(event.startTime) ? ` · ${dayPeriod(event.startTime)}` : ""}`;
}

function isNewEvent(event) {
  const created = millis(event.createdAt);
  return !!created && Date.now() - created >= 0 && Date.now() - created < 86400000;
}


function eventPosition(event) {
  const position = Number(event.sortOrder);
  return Number.isFinite(position) ? position : (millis(event.createdAt) || Number.MAX_SAFE_INTEGER);
}

function dayPeriod(time) {
  const hour = Number(String(time || "").slice(0, 2));
  if (!Number.isFinite(hour)) return "";
  if (hour >= 5 && hour < 11) return "Buổi sáng";
  if (hour >= 11 && hour < 13) return "Buổi trưa";
  if (hour >= 13 && hour < 18) return "Buổi chiều";
  return "Buổi tối";
}

function eventEnd(event) {
  const date = new Date(`${event.date}T${event.endTime || event.startTime || "23:59"}:00`);
  return Number.isNaN(date.getTime()) ? Infinity : date.getTime();
}

function eventState(event) {
  if (event.status === "hidden" || event.status === "draft") return "hidden";
  const now = Date.now();
  if (now > eventEnd(event)) return "ended";
  if (event.status === "closed") return "closed";
  const open = millis(event.openAt) ?? 0;
  const close = millis(event.closeAt) ?? Infinity;
  if (now < open) return "upcoming";
  if (now > close) return "closed";
  if ((event.registeredCount || 0) >= (event.capacity || 0)) return "full";
  return "open";
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

function timingStatus(event, state) {
  if (state === "upcoming") return `Mở đăng ký lúc ${formatDateTime(event.openAt)} · Còn ${countdown(millis(event.openAt))}`;
  if (state === "open" || state === "full") return `Đóng đăng ký lúc ${formatDateTime(event.closeAt)} · Còn ${countdown(millis(event.closeAt))}`;
  if (state === "ended") return "Sự kiện đã kết thúc";
  if (state === "hidden") return "Sự kiện đã được ẩn khỏi danh sách chung";
  return `Đã đóng đăng ký lúc ${formatDateTime(event.closeAt)}`;
}

function allowedFaculties(event) {
  return Array.isArray(event.allowedFaculties) && event.allowedFaculties.length ? event.allowedFaculties : [DEFAULT_FACULTY];
}

function facultyAllowed(event) {
  return !!profile && allowedFaculties(event).includes(profile.faculty);
}

function groupStatus(event) {
  if (!event.groupId) return { text: "", blocked: false };
  const stat = groupLimits.get(event.groupId);
  const groupInfo = groups.get(event.groupId);
  const used = stat?.count || 0;
  if (groupInfo?.unlimited) return { text: "", blocked: false };
  const max = Number(groupInfo?.maxRegistrations || event.groupMaxRegistrations || stat?.maxRegistrations || 1);
  return { text: `Giới hạn nhóm: Bạn đã đăng ký ${used}/${max} sự kiện`, blocked: used >= max && !myRegs.has(event.id) };
}

function eventCard(event) {
  const state = eventState(event);
  const registered = myRegs.has(event.id);
  const used = event.registeredCount || 0;
  const capacity = event.capacity || 0;
  const left = Math.max(0, capacity - used);
  const percent = capacity ? Math.min(100, used / capacity * 100) : 0;
  const fullSeats = capacity > 0 && left === 0;
  const lowSeats = capacity > 0 && left > 0 && left / capacity < 0.1;
  const group = groupStatus(event);
  const disabled = state !== "open" || group.blocked;
  const label = { upcoming: "SẮP MỞ", open: "ĐANG MỞ", full: "ĐÃ ĐỦ", closed: "ĐÃ ĐÓNG ĐĂNG KÝ", ended: "ĐÃ KẾT THÚC", hidden: "ĐÃ ẨN" }[state];
  const tagClass = state === "hidden" ? "closed" : state;
  const groupLine = group.text ? `<span><b>${safe(group.text)}</b></span>` : "";
  const category = event.category || DEFAULT_CATEGORY;
  const hotTag = event.isHot ? '<span class="tag hot">🔥 HOT</span>' : "";
  const newTag = isNewEvent(event) ? '<span class="tag new">NEW</span>' : "";
  return `<article class="card event event-${state} ${registered ? "event-registered" : ""}"><div class="event-top"><div><span class="tag event-category">${safe(category)}</span><span class="tag ${tagClass}">${label}</span>${hotTag}${newTag}${registered ? '<span class="tag mine">ĐÃ ĐĂNG KÝ</span>' : ""}<h3>${safe(event.title)}</h3></div></div><div class="meta"><span class="event-schedule"><b>Ngày sự kiện:</b> ${safe(eventSchedule(event))}</span><span class="event-location"><b>Địa điểm sự kiện:</b> ${safe(event.location || "Chưa cập nhật")}</span><span class="countdown">${safe(timingStatus(event, state))}</span>${groupLine}</div><div class="progress"><i style="width:${percent}%"></i></div><div class="capacity"><span>${used}/${capacity} người tham gia</span><b class="${fullSeats ? "full-seats" : lowSeats ? "low-seats" : ""}">${fullSeats ? "Hết chỗ" : `Còn ${left} chỗ`}</b></div><div class="event-actions"><button class="btn" data-view="${event.id}">Xem chi tiết</button>${registered ? `<button class="btn btn-calendar" data-calendar="${event.id}">＋ Google Lịch</button>` : ""}${registered && event.allowCancellation ? `<button class="btn btn-danger" data-cancel="${event.id}">Hủy đăng ký</button>` : `<button class="btn ${state === "full" ? "btn-full" : "btn-register"}" data-register="${event.id}" ${disabled || registered ? "disabled" : ""}>${registered ? "Đã đăng ký" : state === "full" ? "Đã đủ" : group.blocked ? "Đã đạt giới hạn đăng ký" : state === "upcoming" ? "Chưa đến giờ" : "Đăng ký"}</button>`}</div></article>`;
}
function refreshStudentFilters(sourceEvents, focusedGroup) {
  const categorySelect = $("#categoryFilter");
  const currentCategory = categoryFilter;
  const availableCategories = [...new Set(sourceEvents.map((event) => event.category || DEFAULT_CATEGORY))];
  const orderedCategories = EVENT_CATEGORIES.filter((item) => availableCategories.includes(item)).concat(availableCategories.filter((item) => !EVENT_CATEGORIES.includes(item)).sort());
  categorySelect.innerHTML = '<option value="">Tất cả dạng sự kiện</option>' + orderedCategories.map((item) => `<option value="${safe(item)}">${safe(item)}</option>`).join("");
  categorySelect.value = orderedCategories.includes(currentCategory) ? currentCategory : "";
  categoryFilter = categorySelect.value;

  const groupSelect = $("#studentGroupFilter");
  const currentGroup = focusedGroup?.id || studentGroupFilter;
  const availableGroupIds = [...new Set(sourceEvents.map((event) => event.groupId).filter(Boolean))];
  const availableGroups = availableGroupIds.map((id) => groups.get(id)).filter(Boolean);
  const hasUngrouped = sourceEvents.some((event) => !event.groupId);
  groupSelect.innerHTML = '<option value="">Tất cả nhóm sự kiện</option>' + availableGroups.map((group) => `<option value="${group.id}">${safe(group.name)}</option>`).join("") + (hasUngrouped ? '<option value="__ungrouped__">Không thuộc nhóm</option>' : "");
  const validCurrentGroup = availableGroups.some((group) => group.id === currentGroup) || (hasUngrouped && currentGroup === "__ungrouped__");
  groupSelect.value = validCurrentGroup ? currentGroup : "";
  groupSelect.disabled = !!focusedGroup;
  studentGroupFilter = groupSelect.value;
}

function render() {
  const focusedGroup = linkedGroupId ? [...groups.values()].find((group) => group.id === linkedGroupId || groupCode(group) === shareCode(linkedGroupId)) : null;
  $("#groupFocusPanel").classList.toggle("hidden", !linkedGroupId);
  if (linkedGroupId) {
    $("#groupFocusTitle").textContent = focusedGroup?.name || (groupsLoaded ? "Không tìm thấy nhóm sự kiện" : "Đang tải nhóm sự kiện…");
    $("#groupFocusText").textContent = focusedGroup
      ? focusedGroup.unlimited
        ? "Trang này chỉ hiển thị các sự kiện thuộc nhóm này."
        : `Trang này chỉ hiển thị các sự kiện thuộc nhóm này. Mỗi người được đăng ký tối đa ${focusedGroup.maxRegistrations} sự kiện.`
      : groupsLoaded ? "Liên kết có thể không đúng hoặc nhóm đã ngừng sử dụng." : "Vui lòng chờ trong giây lát.";
  }

  const accessibleEvents = events.filter((event) => {
    if (!facultyAllowed(event)) return false;
    if (filter === "mine") return myRegs.has(event.id) && (!linkedGroupId || event.groupId === focusedGroup?.id);
    if (eventState(event) === "hidden") return false;
    if (linkedGroupId) return event.groupId === focusedGroup?.id;
    return !groups.get(event.groupId)?.linkOnly;
  });
  refreshStudentFilters(accessibleEvents, focusedGroup);

  const candidates = accessibleEvents.filter((event) => {
    if (categoryFilter && (event.category || DEFAULT_CATEGORY) !== categoryFilter) return false;
    if (studentGroupFilter === "__ungrouped__" && event.groupId) return false;
    if (studentGroupFilter && studentGroupFilter !== "__ungrouped__" && event.groupId !== studentGroupFilter) return false;
    return true;
  });
  const list = candidates.filter((event) => {
    const state = eventState(event);
    if (filter === "mine") return true;
    if (filter === "all") return true;
    if (filter === "ended") return state === "ended";
    return ["upcoming", "open", "full"].includes(state);
  }).sort((a, b) => {
    const rank = { open: 0, full: 0, upcoming: 1, closed: 2, ended: 2, hidden: 3 };
    const byState = (rank[eventState(a)] ?? 9) - (rank[eventState(b)] ?? 9);
    if (byState) return byState;
    const byPosition = eventPosition(a) - eventPosition(b);
    if (byPosition) return byPosition;
    return (millis(b.createdAt) || 0) - (millis(a.createdAt) || 0);
  });

  $("#eventSummary").textContent = linkedGroupId && focusedGroup
    ? `${list.length} sự kiện trong nhóm ${focusedGroup.name}`
    : `${list.length} sự kiện phù hợp với ${profile?.faculty || "khoa/đơn vị của bạn"}`;
  const grid = $("#eventGrid");
  if (!list.length) {
    grid.innerHTML = '<div class="card empty event-empty"><span class="empty-badge">DANH SÁCH TRỐNG</span><h3>Chưa có sự kiện trong mục này</h3><p>Thử thay đổi dạng sự kiện, nhóm sự kiện hoặc chọn mục “Tất cả”.</p></div>';
    return;
  }

  const grouped = new Map();
  list.forEach((event) => {
    const key = event.groupId || "__ungrouped__";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  });
  let tone = 0;
  grid.innerHTML = [...grouped.entries()].map(([groupId, items]) => {
    if (groupId === "__ungrouped__") return `<div class="event-grid ungrouped-events">${items.map(eventCard).join("")}</div>`;
    const group = groups.get(groupId);
    const toneClass = `group-tone-${tone++ % 5}`;
    return `<section class="event-group-block ${toneClass}"><div class="event-group-heading"><div><span class="event-group-kicker">NHÓM SỰ KIỆN</span><h3>${safe(group?.name || items[0]?.groupName || "Nhóm sự kiện")}</h3></div><span>${items.length} sự kiện</span></div><div class="event-grid">${items.map(eventCard).join("")}</div></section>`;
  }).join("");
}

function populateFacultyOptions() {
  const select = $("#profileFaculty");
  const values = [...new Set([...(settings.faculties || [DEFAULT_FACULTY]), profile?.faculty].filter(Boolean))];
  select.innerHTML = '<option value="">-- Chọn khoa/đơn vị --</option>' + values.map((name) => `<option value="${safe(name)}">${safe(name)}</option>`).join("");
  select.value = profile?.faculty || DEFAULT_FACULTY;
}

function showProfileForm(force = false) {
  $("#profileEmail").value = user?.email || "";
  const automaticIdentifier = studentIdentifier(user?.email);
  const emailIdentifier = String(user?.email || "").split("@")[0].toUpperCase();
  $("#profileIdentifier").value = automaticIdentifier || profile?.identifier || profile?.mssv || emailIdentifier;
  $("#profileIdentifier").readOnly = !!automaticIdentifier;
  $("#profileIdentifier").disabled = !!automaticIdentifier;
  $("#profileIdentifier").title = automaticIdentifier ? "MSSV được lấy tự động từ email sinh viên và không thể chỉnh sửa." : "";
  $("#profileName").value = profile?.name || user?.displayName || "";
  populateFacultyOptions();
  $("#profilePanel").classList.toggle("hidden", !force && !!profile);
  $("#eventArea").classList.toggle("hidden", force || !profile);
  $("#editProfileBtn").classList.toggle("hidden", !profile || force);
}

async function loadProfile() {
  try {
    const settingsSnapshot = await getDoc(doc(db, "settings", "main"));
    if (settingsSnapshot.exists()) settings = { ...settings, ...settingsSnapshot.data() };
    const snapshot = await getDoc(doc(db, "profiles", user.uid));
    profile = snapshot.exists() ? snapshot.data() : null;
    showProfileForm(!profile);
    if (profile) loadData();
  } catch (error) {
    show(`Không thể tải dữ liệu: ${error.message}`, "error");
  }
}

function clearListeners() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

function loadData() {
  clearListeners();
  unsubscribers.push(onSnapshot(doc(db, "settings", "main"), (snapshot) => {
    if (snapshot.exists()) settings = { ...settings, ...snapshot.data() };
    populateFacultyOptions();
    render();
  }, (error) => show(`Không thể tải thiết lập: ${error.message}`, "error")));
  unsubscribers.push(onSnapshot(query(collection(db, "registrations"), where("uid", "==", user.uid)), (snapshot) => {
    myRegs = new Map(snapshot.docs.map((item) => [item.data().eventId, { id: item.id, ...item.data() }]));
    render();
  }, (error) => show(`Không thể tải đăng ký: ${error.message}`, "error")));
  unsubscribers.push(onSnapshot(query(collection(db, "registrationLimits"), where("uid", "==", user.uid)), (snapshot) => {
    groupLimits = new Map(snapshot.docs.map((item) => [item.data().groupId, item.data()]));
    render();
  }, (error) => show(`Không thể tải giới hạn: ${error.message}`, "error")));
  unsubscribers.push(onSnapshot(collection(db, "eventGroups"), (snapshot) => {
    groups = new Map(snapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]));
    groupsLoaded = true;
    render();
  }, (error) => show(`Không thể tải nhóm sự kiện: ${error.message}`, "error")));
  unsubscribers.push(onSnapshot(collection(db, "events"), (snapshot) => {
    events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    render();
  }, (error) => show(`Không thể tải sự kiện: ${error.message}`, "error")));
}

async function register(eventId) {
  if (!profile) return show("Vui lòng lưu thông tin người tham gia trước.", "error");
  const eventRef = doc(db, "events", eventId);
  const registrationRef = doc(db, "registrations", `${user.uid}_${eventId}`);
  try {
    await runTransaction(db, async (transaction) => {
      const eventSnapshot = await transaction.get(eventRef);
      const registrationSnapshot = await transaction.get(registrationRef);
      if (!eventSnapshot.exists()) throw Error("Sự kiện không tồn tại.");
      if (registrationSnapshot.exists()) throw Error("Bạn đã đăng ký sự kiện này.");
      const event = eventSnapshot.data();
      if (!allowedFaculties(event).includes(profile.faculty)) throw Error("Sự kiện không mở cho khoa/đơn vị của bạn.");
      let group = null;
      let current = null;
      let limitRef = null;
      if (event.groupId) {
        const groupRef = doc(db, "eventGroups", event.groupId);
        limitRef = doc(db, "registrationLimits", `${user.uid}_${event.groupId}`);
        const groupSnapshot = await transaction.get(groupRef);
        const limitSnapshot = await transaction.get(limitRef);
        if (!groupSnapshot.exists()) throw Error("Nhóm sự kiện không còn tồn tại.");
        group = groupSnapshot.data();
        current = limitSnapshot.exists() ? limitSnapshot.data() : { count: 0, eventIds: [] };
        if (!group.unlimited && (current.count || 0) >= group.maxRegistrations) throw Error(`Bạn đã đăng ký đủ ${group.maxRegistrations} sự kiện trong nhóm này.`);
      }
      const now = Date.now();
      if (event.status !== "open" || (event.registeredCount || 0) >= event.capacity || now < (millis(event.openAt) ?? 0) || now > (millis(event.closeAt) ?? Infinity)) throw Error("Sự kiện đã đủ, chưa mở hoặc đã đóng.");
      const identifier = profile.identifier || profile.mssv || user.email.split("@")[0].toUpperCase();
      transaction.update(eventRef, { registeredCount: (event.registeredCount || 0) + 1, updatedAt: serverTimestamp() });
      transaction.set(registrationRef, { uid: user.uid, email: user.email.toLowerCase(), identifier, mssv: identifier, participantType: profile.participantType, name: profile.name, phone: profile.phone || "", faculty: profile.faculty, eventId, eventTitle: event.title, eventDate: event.date, eventCreatorUid: event.createdByUid || "", groupId: event.groupId || "", groupName: event.groupName || "", createdAt: serverTimestamp() });
      if (event.groupId) transaction.set(limitRef, { uid: user.uid, email: user.email.toLowerCase(), groupId: event.groupId, groupName: group.name, maxRegistrations: group.maxRegistrations, count: (current.count || 0) + 1, eventIds: [...(current.eventIds || []), eventId], updatedAt: serverTimestamp() });
    });
    show("Đăng ký thành công. Bạn có thể bấm “Google Lịch” để thêm sự kiện vào lịch cá nhân.", "success");
  } catch (error) {
    show(error.message || "Không thể đăng ký.", "error");
  }
}

async function cancel(eventId) {
  const selectedEvent = events.find((event) => event.id === eventId);
  if (!selectedEvent?.allowCancellation) return show("Sự kiện này không cho phép tự hủy đăng ký.", "error");
  const eventRef = doc(db, "events", eventId);
  const registrationRef = doc(db, "registrations", `${user.uid}_${eventId}`);
  try {
    await runTransaction(db, async (transaction) => {
      const eventSnapshot = await transaction.get(eventRef);
      const registrationSnapshot = await transaction.get(registrationRef);
      if (!eventSnapshot.exists() || !registrationSnapshot.exists()) throw Error("Không tìm thấy đăng ký.");
      const event = eventSnapshot.data();
      if (!event.allowCancellation) throw Error("Sự kiện này không cho phép tự hủy đăng ký.");
      let limitRef = null;
      let current = null;
      let currentGroup = null;
      if (event.groupId) {
        limitRef = doc(db, "registrationLimits", `${user.uid}_${event.groupId}`);
        const groupRef = doc(db, "eventGroups", event.groupId);
        const limitSnapshot = await transaction.get(limitRef);
        const groupSnapshot = await transaction.get(groupRef);
        if (!limitSnapshot.exists()) throw Error("Không tìm thấy hạn mức nhóm.");
        if (!groupSnapshot.exists()) throw Error("Nhóm sự kiện không còn tồn tại.");
        current = limitSnapshot.data();
        currentGroup = groupSnapshot.data();
      }
      transaction.update(eventRef, { registeredCount: Math.max(0, (event.registeredCount || 0) - 1), updatedAt: serverTimestamp() });
      transaction.delete(registrationRef);
      if (limitRef) transaction.set(limitRef, { ...current, groupName: currentGroup.name, maxRegistrations: currentGroup.maxRegistrations, count: Math.max(0, current.count - 1), eventIds: (current.eventIds || []).filter((id) => id !== eventId), updatedAt: serverTimestamp() });
    });
    show("Đã hủy đăng ký.", "success");
  } catch (error) {
    show(error.message || "Không thể hủy.", "error");
  }
}

function openDetail(id) {
  chosen = events.find((event) => event.id === id);
  if (!chosen) return;
  const state = eventState(chosen);
  const group = groupStatus(chosen);
  $("#detailTitle").textContent = chosen.title;
  const description = chosen.descriptionHtml ? sanitizeRichHtml(chosen.descriptionHtml) : `<p>${safe(chosen.description || "Không có mô tả.")}</p>`;
  const groupLine = group.text ? `<span><b>${safe(group.text)}</b></span>` : "";
  const detailLeft = Math.max(0, chosen.capacity - (chosen.registeredCount || 0));
  const detailFullSeats = chosen.capacity > 0 && detailLeft === 0;
  const detailLowSeats = chosen.capacity > 0 && detailLeft > 0 && detailLeft / chosen.capacity < 0.1;
  $("#detailBody").innerHTML = `<div class="meta"><span class="event-schedule"><b>Ngày sự kiện:</b> ${safe(eventSchedule(chosen))}</span><span class="event-location"><b>Địa điểm sự kiện:</b> ${safe(chosen.location || "Chưa cập nhật")}</span><span class="countdown">${safe(timingStatus(chosen, state))}</span>${groupLine}</div><div class="rich-content">${description}</div><div class="notice ${detailFullSeats ? "full-seats-notice" : detailLowSeats ? "low-seats-notice" : ""}">${detailFullSeats ? "Hết chỗ." : `Còn ${detailLeft} chỗ.`}</div>`;
  const confirmButton = $("#confirmBtn");
  confirmButton.disabled = state !== "open" || group.blocked || myRegs.has(chosen.id);
  confirmButton.classList.toggle("btn-full", detailFullSeats);
  confirmButton.classList.toggle("btn-register", !detailFullSeats);
  confirmButton.textContent = detailFullSeats ? "Đã đủ" : "Xác nhận đăng ký";
  const calendarButton = $("#detailCalendarBtn");
  calendarButton.classList.toggle("hidden", !myRegs.has(chosen.id));
  calendarButton.dataset.calendar = chosen.id;
  $("#detailDialog").showModal();
}

$("#profileForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const previous = profile;
    const automaticIdentifier = studentIdentifier(user.email);
    const identifier = automaticIdentifier || $("#profileIdentifier").value.trim().toUpperCase();
    const data = { uid: user.uid, email: user.email.toLowerCase(), participantType: participantType(user.email), identifier, mssv: identifier, name: $("#profileName").value.trim(), phone: profile?.phone || "", faculty: $("#profileFaculty").value, updatedAt: serverTimestamp() };
    if (!data.identifier || !data.name || !data.faculty) throw Error("Vui lòng nhập đầy đủ thông tin.");
    await setDoc(doc(db, "profiles", user.uid), previous ? data : { ...data, createdAt: serverTimestamp() }, { merge: true });
    profile = { ...previous, ...data };
    showProfileForm(false);
    loadData();
    show("Đã lưu thông tin người tham gia.", "success");
  } catch (error) {
    show(error.message || "Không thể lưu thông tin.", "error");
  } finally {
    button.disabled = false;
  }
};

$("#loginBtn").onclick = async () => { try { await signInWithPopup(auth, provider); } catch { show("Không thể đăng nhập Google.", "error"); } };
$("#logoutBtn").onclick = () => signOut(auth);
$("#editProfileBtn").onclick = () => showProfileForm(true);
$("#categoryFilter").onchange = (event) => { categoryFilter = event.target.value; render(); };
$("#studentGroupFilter").onchange = (event) => { studentGroupFilter = event.target.value; render(); };
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.close !== undefined) $("#detailDialog").close();
  if (button.dataset.view) openDetail(button.dataset.view);
  if (button.dataset.register) openDetail(button.dataset.register);
  if (button.dataset.calendar) {
    const selectedEvent = events.find((item) => item.id === button.dataset.calendar);
    if (selectedEvent && myRegs.has(selectedEvent.id)) openGoogleCalendar(selectedEvent);
  }
  if (button.dataset.cancel && confirm("Hủy đăng ký sự kiện này?")) cancel(button.dataset.cancel);
  if (button.classList.contains("filter")) {
    document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    filter = button.dataset.filter;
    render();
  }
});
$("#confirmBtn").onclick = async () => { if (chosen) { $("#detailDialog").close(); await register(chosen.id); } };
setInterval(() => { if (user && profile) render(); }, 1000);

onAuthStateChanged(auth, async (currentUser) => {
  clearListeners();
  if (!currentUser) {
    user = null;
    profile = null;
    $("#loginCard").classList.remove("hidden");
    $("#studentApp").classList.add("hidden");
    $("#logoutBtn").classList.add("hidden");
    $("#editProfileBtn").classList.add("hidden");
    return;
  }
  if (!currentUser.emailVerified || !(await participantAccess(currentUser))) {
    await signOut(auth);
    alert("Chỉ chấp nhận email TDTU hoặc tài khoản Google đã được cấp quyền Admin.");
    return;
  }
  user = currentUser;
  $("#accountEmail").textContent = `${currentUser.email} · ${participantType(currentUser.email)}`;
  $("#loginCard").classList.add("hidden");
  $("#studentApp").classList.remove("hidden");
  $("#logoutBtn").classList.remove("hidden");
  await loadProfile();
});
