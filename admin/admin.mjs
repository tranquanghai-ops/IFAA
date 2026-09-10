import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, Timestamp, runTransaction } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { firebaseConfig, OWNER_EMAIL } from "../firebase-config.mjs";

const DEFAULT_FACULTY = "Khoa Mỹ thuật Công nghiệp";
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const $ = (selector) => document.querySelector(selector);
const safe = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const ts = (value) => value?.toDate ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(value.toDate()) : "";
const millis = (value) => value?.toDate ? value.toDate().getTime() : (value ? new Date(value).getTime() : null);

let user = null;
let isOwner = false;
let events = [];
let regs = [];
let admins = [];
let groups = [];
let settings = { faculties: [DEFAULT_FACULTY] };
let adminStatusFilter = "all";

function shareCode(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).toUpperCase();
}

function groupCode(group) {
  return shareCode(group?.shareCode || group?.name) || group?.id || "NHOM";
}

function groupShareUrl(group) {
  const url = new URL("../", window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("e", groupCode(group));
  return url.toString();
}

function notice(message, type = "") {
  const element = $("#adminNotice");
  element.textContent = message;
  element.className = `notice ${type}`;
  element.classList.remove("hidden");
  setTimeout(() => element.classList.add("hidden"), 5000);
}

async function hasAccess(currentUser) {
  if (currentUser.email.toLowerCase() === OWNER_EMAIL) return true;
  return (await getDoc(doc(db, "admins", currentUser.email.toLowerCase()))).exists();
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

function eventState(event) {
  if (event.status === "hidden" || event.status === "draft") return "hidden";
  const now = Date.now();
  if (event.status === "closed" || now > eventEnd(event) || now > (millis(event.closeAt) ?? Infinity)) return "ended";
  if (now < (millis(event.openAt) ?? 0)) return "upcoming";
  return "open";
}

function statusLabel(event) {
  const state = eventState(event);
  return {
    upcoming: ["upcoming", "SẮP MỞ"],
    open: ["open", "ĐANG MỞ"],
    ended: ["admin-ended", "KẾT THÚC"],
    hidden: ["closed", "ĐÃ ẨN"]
  }[state];
}

function showPane(name) {
  document.querySelectorAll(".nav-btn").forEach((item) => item.classList.toggle("active", item.dataset.pane === name));
  document.querySelectorAll(".pane").forEach((item) => item.classList.toggle("hidden", item.dataset.paneId !== name));
}

function render() {
  const counts = events.reduce((result, item) => {
    result[eventState(item)] += 1;
    return result;
  }, { upcoming: 0, open: 0, ended: 0, hidden: 0 });
  $("#metricEvents").textContent = events.length;
  $("#metricUpcoming").textContent = counts.upcoming;
  $("#metricOpen").textContent = counts.open;
  $("#metricEnded").textContent = counts.ended;
  $("#metricHidden").textContent = counts.hidden;
  $("#metricRegs").textContent = regs.length;

  const filteredEvents = adminStatusFilter === "all" ? events : events.filter((event) => eventState(event) === adminStatusFilter);
  $("#eventRows").innerHTML = filteredEvents.map((event) => {
    const canDelete = isOwner || event.createdByUid === user.uid;
    const reason = "Chỉ được xóa sự kiện do mình tạo";
    const [statusClass, statusText] = statusLabel(event);
    const state = eventState(event);
    const eventGroup = groups.find((item) => item.id === event.groupId);
    const groupText = event.groupId ? `${safe(event.groupName)}<br><small>${eventGroup?.unlimited ? "Không giới hạn lượt" : `Tối đa ${event.groupMaxRegistrations}/sự kiện`}</small>` : "";
    return `<tr class="${state === "ended" ? "admin-event-ended" : ""}"><td><b>${safe(event.title)}</b><br><small class="admin-event-category">${safe(event.category || "Sự kiện Khoa")}</small><br><small>${safe(event.location)}</small></td><td>${groupText}</td><td>${safe(event.date)}<br>${safe(event.startTime || "")}</td><td>${event.registeredCount || 0}/${event.capacity}</td><td>${safe(event.createdByName || event.createdByEmail)}</td><td><span class="tag ${statusClass}">${statusText}</span></td><td><div class="actions"><button class="btn btn-small" data-edit="${event.id}">Sửa</button><button class="btn btn-small btn-soft" data-copy-event="${event.id}">Sao chép</button><button class="btn btn-small btn-danger" data-delete="${event.id}" ${canDelete ? "" : `disabled title='${reason}'`}>Xóa</button></div></td></tr>`;
  }).join("") || '<tr><td colspan="7" class="empty">Không có sự kiện ở trạng thái này.</td></tr>';

  $("#groupRows").innerHTML = groups.map((group) => {
    const eventCount = events.filter((item) => item.groupId === group.id).length;
    const visibility = group.linkOnly ? '<span class="tag upcoming">CHỈ QUA LINK</span>' : '<span class="tag open">TRANG CHUNG</span>';
    const limit = group.unlimited ? '<b>Không giới hạn</b>' : `Tối đa <b>${Number(group.maxRegistrations) || 1}</b>/sự kiện`;
    return `<tr><td><b>${safe(group.name)}</b><br><small>Mã: ${safe(groupCode(group))}</small></td><td>${limit}</td><td>${eventCount}</td><td>${visibility}</td><td><button class="btn btn-small btn-soft" data-copy-group-link="${group.id}">Sao chép liên kết</button></td><td><button class="btn btn-small" data-edit-group="${group.id}">Sửa nhóm</button></td></tr>`;
  }).join("") || '<tr><td colspan="6" class="empty">Chưa có nhóm sự kiện.</td></tr>';

  const selectedFilter = $("#eventFilter").value;
  $("#eventFilter").innerHTML = '<option value="">Tất cả sự kiện</option>' + events.map((event) => `<option value="${event.id}">${safe(event.title)}</option>`).join("");
  if (events.some((event) => event.id === selectedFilter)) $("#eventFilter").value = selectedFilter;
  const selectedGroup = $("#groupFilter").value;
  $("#groupFilter").innerHTML = '<option value="">Tất cả nhóm</option>' + groups.map((group) => `<option value="${group.id}">${safe(group.name)}</option>`).join("");
  if (groups.some((group) => group.id === selectedGroup)) $("#groupFilter").value = selectedGroup;
  renderRegs();
  if (isOwner) $("#adminRows").innerHTML = admins.map((admin) => `<tr><td>${safe(admin.name || "")}</td><td>${safe(admin.email)}</td><td>${ts(admin.addedAt)}</td><td><button class="btn btn-small btn-danger" data-remove-admin="${safe(admin.email)}">Xóa</button></td></tr>`).join("");
}

function filteredRegistrations() {
  const eventId = $("#eventFilter").value;
  const groupId = $("#groupFilter").value;
  if (eventId) return regs.filter((registration) => registration.eventId === eventId);
  if (groupId) return regs.filter((registration) => registration.groupId === groupId);
  return regs;
}

function renderRegs() {
  const list = filteredRegistrations();
  const eventId = $("#eventFilter").value;
  $("#resetEventBtn").disabled = !eventId || !list.length;
  $("#regRows").innerHTML = list.map((registration, index) => `<tr><td class="col-stt">${index + 1}</td><td class="col-identifier"><b>${safe(registration.identifier || registration.mssv)}</b></td><td>${safe(registration.name)}</td><td>${safe(registration.phone)}</td><td>${safe(registration.faculty)}</td><td>${safe(registration.participantType || "Sinh viên")}</td><td>${safe(registration.eventTitle)}</td><td>${ts(registration.createdAt)}</td><td><button class="btn btn-small btn-danger" data-delete-registration="${registration.id}">Xóa</button></td></tr>`).join("") || '<tr><td colspan="9" class="empty">Không có dữ liệu đăng ký.</td></tr>';
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
  select.innerHTML = '<option value="">Không nhóm</option>' + groups.map((group) => `<option value="${group.id}">${safe(group.name)} — ${group.unlimited ? "không giới hạn" : `tối đa ${group.maxRegistrations}`}</option>`).join("") + '<option value="__new__">＋ Tạo nhóm mới</option>';
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
  $("#groupFormError").classList.add("hidden");
  $("#groupDialog").showModal();
}

function renderFacultySettings() {
  const faculties = settings.faculties || [DEFAULT_FACULTY];
  $("#facultySettingsList").innerHTML = faculties.map((faculty) => `<span class="check-chip"><span>${safe(faculty)}</span>${faculty === DEFAULT_FACULTY ? "" : `<button type="button" class="btn btn-small btn-danger" data-remove-faculty="${safe(faculty)}">×</button>`}</span>`).join("");
}

function renderEventFaculties(selected = [DEFAULT_FACULTY]) {
  const faculties = settings.faculties || [DEFAULT_FACULTY];
  $("#eventFacultyList").innerHTML = faculties.map((faculty) => `<label class="check-chip"><input class="event-faculty" type="checkbox" value="${safe(faculty)}" ${selected.includes(faculty) ? "checked" : ""}> ${safe(faculty)}</label>`).join("");
}

function listen() {
  onSnapshot(doc(db, "settings", "main"), (snapshot) => {
    if (snapshot.exists()) settings = { ...settings, ...snapshot.data() };
    settings.faculties = [...new Set([DEFAULT_FACULTY, ...(settings.faculties || [])])];
    renderFacultySettings();
  }, (error) => notice(error.message, "error"));
  onSnapshot(query(collection(db, "eventGroups"), orderBy("createdAt", "desc")), (snapshot) => {
    groups = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    refreshGroupOptions($("#groupId").value);
    render();
  }, (error) => notice(error.message, "error"));
  onSnapshot(query(collection(db, "events"), orderBy("createdAt", "desc")), (snapshot) => {
    events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    render();
  }, (error) => notice(error.message, "error"));
  onSnapshot(query(collection(db, "registrations"), orderBy("createdAt", "desc")), (snapshot) => {
    regs = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    render();
  }, (error) => notice(error.message, "error"));
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
  refreshGroupOptions(event?.groupId || "");
  $("#groupId").disabled = !copy && !!event && (event.registeredCount || 0) > 0;
  $("#newGroupFields").classList.add("hidden");
  $("#newGroupMax").value = 2;
  $("#newGroupUnlimited").checked = false;
  setLimitInputState($("#newGroupUnlimited"), $("#newGroupMax"));
  renderEventFaculties(event?.allowedFaculties?.length ? event.allowedFaculties : [DEFAULT_FACULTY]);
  const canApplyToGroup = !copy && !!event?.id && !!event?.groupId;
  $("#applyGroupFieldsOption").classList.toggle("hidden", !canApplyToGroup);
  $("#applyGroupFields").checked = false;
  $("#applyGroupFieldsBtn").setAttribute("aria-pressed", "false");
  $("#applyGroupFieldsBtn").classList.remove("active");
  $("#applyGroupFieldsBtn").textContent = "Áp dụng khi lưu cho cả nhóm";
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
$("#applyGroupFieldsBtn").onclick = () => {
  const checkbox = $("#applyGroupFields");
  checkbox.checked = !checkbox.checked;
  $("#applyGroupFieldsBtn").setAttribute("aria-pressed", String(checkbox.checked));
  $("#applyGroupFieldsBtn").classList.toggle("active", checkbox.checked);
  $("#applyGroupFieldsBtn").textContent = checkbox.checked ? "✓ Sẽ áp dụng khi lưu" : "Áp dụng khi lưu cho cả nhóm";
};

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
$("#insertDescriptionLink").onclick = () => {
  rememberDescriptionSelection();
  const url = window.prompt("Nhập liên kết (https://...):", "https://");
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
  const openValue = dateTimeValue($("#openDate").value, $("#openTime").value.trim());
  const closeValue = dateTimeValue($("#closeDate").value, $("#closeTime").value.trim());
  data.openAt = openValue ? Timestamp.fromDate(openValue) : null;
  data.closeAt = closeValue ? Timestamp.fromDate(closeValue) : null;
  data.capacity = Number($("#capacity").value);
  data.allowedFaculties = [...document.querySelectorAll(".event-faculty:checked")].map((input) => input.value);
  data.allowCancellation = $("#eventAllowCancellation").checked;
  data.updatedAt = serverTimestamp();
  try {
    if (!data.title || !data.category || !data.date || !data.location || !data.startTime || !Number.isInteger(data.capacity) || data.capacity < 1) throw Error("Vui lòng nhập đầy đủ các trường bắt buộc.");
    if (!validTime24(data.startTime) || (data.endTime && !validTime24(data.endTime))) throw Error("Giờ sự kiện phải theo định dạng 24 giờ HH:mm, ví dụ 08:30 hoặc 17:45.");
    if (!data.openAt || !data.closeAt) throw Error("Vui lòng chọn ngày và nhập giờ mở, đóng đăng ký theo định dạng 24 giờ HH:mm.");
    const eventStart = new Date(`${data.date}T${data.startTime}:00`).getTime();
    const eventEnd = new Date(`${data.date}T${data.endTime || data.startTime}:00`).getTime();
    const now = Date.now();
    if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd)) throw Error("Ngày hoặc giờ sự kiện không hợp lệ.");
    const warnings = [];
    if (data.endTime && eventEnd <= eventStart) warnings.push("Giờ kết thúc sự kiện đang trước hoặc bằng giờ bắt đầu.");
    if (!id && eventStart <= now) warnings.push("Ngày và giờ bắt đầu sự kiện đã ở trong quá khứ.");
    if (data.openAt.toMillis() >= data.closeAt.toMillis()) warnings.push("Thời gian đóng đăng ký đang trước hoặc bằng thời gian mở đăng ký.");
    if (!id && data.closeAt.toMillis() <= now) warnings.push("Thời gian đóng đăng ký đã ở trong quá khứ.");
    if (data.closeAt.toMillis() > eventStart) warnings.push("Thời gian đóng đăng ký đang sau giờ bắt đầu sự kiện.");
    const warningSignature = [id, data.date, data.startTime, data.endTime, data.openAt.toMillis(), data.closeAt.toMillis(), ...warnings].join("|");
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
      const groupRef = await addDoc(collection(db, "eventGroups"), { name, shareCode: code, maxRegistrations: unlimited ? 2 : maxRegistrations, unlimited, linkOnly: false, createdByUid: user.uid, createdByEmail: user.email.toLowerCase(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
      const applyToGroup = $("#applyGroupFields").checked && !!data.groupId;
      const siblingEvents = applyToGroup ? events.filter((item) => item.groupId === data.groupId && item.id !== id) : [];
      const invalidCapacityEvent = siblingEvents.find((item) => data.capacity < (item.registeredCount || 0));
      if (invalidCapacityEvent) throw Error(`Không thể áp dụng sức chứa ${data.capacity}; sự kiện “${invalidCapacityEvent.title}” đã có ${invalidCapacityEvent.registeredCount || 0} người đăng ký.`);
      if (applyToGroup && siblingEvents.length && !confirm(`Áp dụng mô tả, địa điểm, sức chứa và thời gian mở/đóng đăng ký cho ${siblingEvents.length} sự kiện khác trong nhóm “${data.groupName}”?`)) {
        throw Error("Đã hủy thao tác áp dụng cho nhóm. Sự kiện chưa được lưu.");
      }
      await updateDoc(doc(db, "events", id), data);
      if (siblingEvents.length) {
        const sharedData = { description: data.description, descriptionHtml: data.descriptionHtml, location: data.location, capacity: data.capacity, openAt: data.openAt, closeAt: data.closeAt, updatedAt: serverTimestamp() };
        await Promise.all(siblingEvents.map((item) => updateDoc(doc(db, "events", item.id), sharedData)));
      }
      $("#eventDialog").close();
      notice(siblingEvents.length ? `Đã lưu và cập nhật ${siblingEvents.length} sự kiện khác trong nhóm.` : "Đã lưu sự kiện.", "success");
    } else {
      await addDoc(collection(db, "events"), { ...data, registeredCount: 0, createdByUid: user.uid, createdByEmail: user.email.toLowerCase(), createdByName: user.displayName || "", createdAt: serverTimestamp() });
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
    if (!name || (!unlimited && (!Number.isInteger(maxRegistrations) || maxRegistrations < 1 || maxRegistrations > 20))) throw Error("Vui lòng nhập tên nhóm và giới hạn từ 1 đến 20.");
    if (!code) throw Error("Mã liên kết nhóm không hợp lệ.");
    if (groups.some((item) => item.id !== id && groupCode(item) === code)) throw Error(`Mã liên kết ${code} đã được một nhóm khác sử dụng.`);
    if (id && !unlimited) {
      const countsByUser = new Map();
      regs.filter((item) => item.groupId === id).forEach((item) => countsByUser.set(item.uid || item.email, (countsByUser.get(item.uid || item.email) || 0) + 1));
      const highestCurrentCount = Math.max(0, ...countsByUser.values());
      if (maxRegistrations < highestCurrentCount) throw Error(`Không thể giảm giới hạn xuống ${maxRegistrations}; hiện có người đã đăng ký ${highestCurrentCount} sự kiện trong nhóm.`);
    }
    const effectiveMax = unlimited ? (Number.isInteger(maxRegistrations) && maxRegistrations >= 1 ? maxRegistrations : 2) : maxRegistrations;
    const data = { name, shareCode: code, maxRegistrations: effectiveMax, unlimited, linkOnly: $("#groupLinkOnly").checked, updatedAt: serverTimestamp() };
    if (id) {
      await updateDoc(doc(db, "eventGroups", id), data);
      const groupedEvents = events.filter((item) => item.groupId === id);
      await Promise.all(groupedEvents.map((item) => updateDoc(doc(db, "events", item.id), { groupName: name, groupMaxRegistrations: effectiveMax, updatedAt: serverTimestamp() })));
    } else {
      await addDoc(collection(db, "eventGroups"), { ...data, createdByUid: user.uid, createdByEmail: user.email.toLowerCase(), createdAt: serverTimestamp() });
    }
    $("#groupDialog").close();
    notice(id ? "Đã cập nhật nhóm sự kiện." : "Đã tạo nhóm sự kiện.", "success");
  } catch (saveError) {
    error.textContent = saveError.message || "Không thể lưu nhóm sự kiện.";
    error.classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.textContent = "Lưu nhóm";
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
    await setDoc(doc(db, "settings", "main"), { faculties: settings.faculties || [DEFAULT_FACULTY], participantDomains: ["student.tdtu.edu.vn", "tdtu.edu.vn"], updatedBy: user.email, updatedAt: serverTimestamp() }, { merge: true });
    notice("Đã lưu thiết lập.", "success");
  } catch (error) {
    notice(error.message, "error");
  }
};

$("#adminForm").onsubmit = async (event) => {
  event.preventDefault();
  const email = $("#adminEmail").value.trim().toLowerCase();
  try {
    await setDoc(doc(db, "admins", email), { email, name: $("#adminName").value.trim(), addedByUid: user.uid, addedAt: serverTimestamp() });
    event.target.reset();
    notice("Đã thêm Admin.", "success");
  } catch (error) {
    notice(error.message, "error");
  }
};

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
  if (button.dataset.newEvent !== undefined) openEvent();
  if (button.dataset.close !== undefined) $("#eventDialog").close();
  if (button.dataset.edit) openEvent(events.find((item) => item.id === button.dataset.edit));
  if (button.dataset.copyEvent) openEvent(events.find((item) => item.id === button.dataset.copyEvent), true);
  if (button.id === "newGroupBtn") openGroup();
  if (button.dataset.closeGroup !== undefined) $("#groupDialog").close();
  if (button.dataset.editGroup) openGroup(groups.find((item) => item.id === button.dataset.editGroup));
  if (button.dataset.copyGroupLink) {
    const selectedGroup = groups.find((item) => item.id === button.dataset.copyGroupLink);
    const link = groupShareUrl(selectedGroup || { id: button.dataset.copyGroupLink });
    try {
      await navigator.clipboard.writeText(link);
      notice("Đã sao chép liên kết riêng của nhóm.", "success");
    } catch {
      window.prompt("Sao chép liên kết nhóm:", link);
    }
  }
  if (button.dataset.delete) {
    const selected = events.find((item) => item.id === button.dataset.delete);
    if (selected) {
      const registrations = regs.filter((item) => item.eventId === selected.id);
      const warning = registrations.length
        ? `Sự kiện “${selected.title}” đang có ${registrations.length} người đăng ký. Khi tiếp tục, toàn bộ lượt đăng ký của sự kiện này cũng sẽ bị xóa. Thao tác không thể hoàn tác.`
        : `Xóa sự kiện “${selected.title}”? Thao tác không thể hoàn tác.`;
      if (!confirm(warning)) return;
      if (registrations.length) {
        const verification = prompt(`Để xác nhận, nhập chính xác tên sự kiện:\n${selected.title}`);
        if (verification !== selected.title) {
          notice("Tên xác nhận không khớp. Sự kiện chưa bị xóa.", "error");
          return;
        }
      }
      button.disabled = true;
      try {
        for (let index = 0; index < registrations.length; index += 1) {
          button.textContent = `Đang xóa ${index + 1}/${registrations.length}…`;
          await removeRegistration(registrations[index]);
        }
        await deleteDoc(doc(db, "events", selected.id));
        notice(registrations.length ? `Đã xóa sự kiện và ${registrations.length} lượt đăng ký liên quan.` : "Đã xóa sự kiện.", "success");
      } catch (error) {
        button.disabled = false;
        button.textContent = "Xóa";
        notice(`Không thể hoàn tất xóa sự kiện: ${error.message}`, "error");
      }
    }
  }
  if (button.dataset.deleteRegistration) {
    const registration = regs.find((item) => item.id === button.dataset.deleteRegistration);
    if (registration && confirm(`Xóa đăng ký của ${registration.name || registration.email} khỏi sự kiện “${registration.eventTitle}”?`)) try {
      button.disabled = true;
      await removeRegistration(registration);
      notice("Đã xóa thành viên khỏi sự kiện.", "success");
    } catch (error) {
      button.disabled = false;
      notice(error.message, "error");
    }
  }
  if (button.dataset.removeAdmin && confirm(`Xóa quyền Admin của ${button.dataset.removeAdmin}?`)) try {
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

$("#eventFilter").onchange = () => {
  if ($("#eventFilter").value) $("#groupFilter").value = "";
  renderRegs();
};
$("#groupFilter").onchange = () => {
  if ($("#groupFilter").value) $("#eventFilter").value = "";
  renderRegs();
};
$("#resetEventBtn").onclick = async () => {
  const eventId = $("#eventFilter").value;
  const selectedEvent = events.find((item) => item.id === eventId);
  const list = regs.filter((registration) => registration.eventId === eventId);
  if (!selectedEvent || !list.length || !confirm(`Xóa toàn bộ ${list.length} lượt đăng ký của sự kiện “${selectedEvent.title}”? Thao tác này không thể hoàn tác.`)) return;
  const button = $("#resetEventBtn");
  button.disabled = true;
  try {
    for (let index = 0; index < list.length; index += 1) {
      button.textContent = `Đang xóa ${index + 1}/${list.length}…`;
      await removeRegistration(list[index]);
    }
    notice(`Đã xóa toàn bộ ${list.length} lượt đăng ký.`, "success");
  } catch (error) {
    notice(`Đã dừng khi gặp lỗi: ${error.message}`, "error");
  } finally {
    button.textContent = "Xóa toàn bộ đăng ký";
    renderRegs();
  }
};
$("#exportBtn").onclick = () => {
  const filter = $("#eventFilter").value;
  const groupFilter = $("#groupFilter").value;
  const list = filteredRegistrations();
  const rows = list.map((registration, index) => {
    const selectedRegistrationEvent = events.find((event) => event.id === registration.eventId);
    const row = { STT: index + 1, "MSSV/Mã số": registration.identifier || registration.mssv, "Họ tên": registration.name, "Số điện thoại": registration.phone, "Khoa/Đơn vị": registration.faculty, "Đối tượng": registration.participantType || "Sinh viên", Email: registration.email, "Sự kiện": registration.eventTitle, "Ngày sự kiện": registration.eventDate, "Giờ bắt đầu": selectedRegistrationEvent?.startTime || "", "Giờ kết thúc": selectedRegistrationEvent?.endTime || "", "Buổi": dayPeriod(selectedRegistrationEvent?.startTime), "Thời gian đăng ký": ts(registration.createdAt) };
    if (!groupFilter) row["Nhóm sự kiện"] = registration.groupName || "Không nhóm";
    return row;
  });
  const selectedEvent = events.find((event) => event.id === filter);
  const selectedGroup = groups.find((group) => group.id === groupFilter);
  const exportName = selectedEvent?.title || (selectedGroup ? `Nhom_${selectedGroup.name}` : "Tat_ca_su_kien");
  const cleanName = exportName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70) || "Su_kien";
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 6 }, { wch: 15 }, { wch: 24 }, { wch: 16 }, { wch: 28 }, { wch: 14 }, { wch: 32 }, { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, (selectedEvent?.title || selectedGroup?.name || "Đăng ký").slice(0, 31));
  XLSX.writeFile(workbook, `IFAA_${cleanName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

$("#loginBtn").onclick = () => signInWithPopup(auth, provider);
$("#logoutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (currentUser) => {
  if (!currentUser) {
    $("#adminLogin").classList.remove("hidden");
    $("#adminApp").classList.add("hidden");
    return;
  }
  if (!currentUser.emailVerified || !(await hasAccess(currentUser))) {
    await signOut(auth);
    alert("Tài khoản này chưa được cấp quyền Admin IFA+A.");
    return;
  }
  user = currentUser;
  isOwner = currentUser.email.toLowerCase() === OWNER_EMAIL;
  $("#accountEmail").textContent = currentUser.email;
  $("#roleText").textContent = `Quyền hiện tại: ${isOwner ? "Chủ sở hữu" : "Admin"}`;
  $("#adminLogin").classList.add("hidden");
  $("#adminApp").classList.remove("hidden");
  $("#logoutBtn").classList.remove("hidden");
  $("#adminNav").classList.toggle("hidden", !isOwner);
  $("#settingsNav").classList.toggle("hidden", !isOwner);
  listen();
});
