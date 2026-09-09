import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
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
    ended: ["closed", "KẾT THÚC"],
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
    const canDelete = (event.registeredCount || 0) === 0 && (isOwner || event.createdByUid === user.uid);
    const reason = (event.registeredCount || 0) > 0 ? "Không thể xóa sự kiện đã có đăng ký" : "Chỉ xóa sự kiện do mình tạo";
    const [statusClass, statusText] = statusLabel(event);
    const groupText = event.groupId ? `${safe(event.groupName)}<br><small>Tối đa ${event.groupMaxRegistrations}/người</small>` : "Không giới hạn lượt";
    return `<tr><td><b>${safe(event.title)}</b><br><small>${safe(event.location)}</small></td><td>${groupText}</td><td>${safe(event.date)}<br>${safe(event.startTime || "")}</td><td>${event.registeredCount || 0}/${event.capacity}</td><td>${safe(event.createdByName || event.createdByEmail)}</td><td><span class="tag ${statusClass}">${statusText}</span></td><td><div class="actions"><button class="btn btn-small" data-edit="${event.id}">Sửa</button><button class="btn btn-small btn-danger" data-delete="${event.id}" ${canDelete ? "" : `disabled title='${reason}'`}>Xóa</button></div></td></tr>`;
  }).join("") || '<tr><td colspan="7" class="empty">Không có sự kiện ở trạng thái này.</td></tr>';

  const selectedFilter = $("#eventFilter").value;
  $("#eventFilter").innerHTML = '<option value="">Tất cả sự kiện</option>' + events.map((event) => `<option value="${event.id}">${safe(event.title)}</option>`).join("");
  if (events.some((event) => event.id === selectedFilter)) $("#eventFilter").value = selectedFilter;
  renderRegs();
  if (isOwner) $("#adminRows").innerHTML = admins.map((admin) => `<tr><td>${safe(admin.name || "")}</td><td>${safe(admin.email)}</td><td>${ts(admin.addedAt)}</td><td><button class="btn btn-small btn-danger" data-remove-admin="${safe(admin.email)}">Xóa</button></td></tr>`).join("");
}

function renderRegs() {
  const filter = $("#eventFilter").value;
  const list = filter ? regs.filter((registration) => registration.eventId === filter) : regs;
  $("#regRows").innerHTML = list.map((registration, index) => `<tr><td>${index + 1}</td><td><b>${safe(registration.identifier || registration.mssv)}</b></td><td>${safe(registration.name)}</td><td>${safe(registration.phone)}</td><td>${safe(registration.faculty)}</td><td>${safe(registration.participantType || "Sinh viên")}</td><td>${safe(registration.email)}</td><td>${safe(registration.eventTitle)}</td><td>${ts(registration.createdAt)}</td></tr>`).join("");
}

function refreshGroupOptions(selected = "") {
  const select = $("#groupId");
  select.innerHTML = '<option value="">Không nhóm — không giới hạn lượt</option>' + groups.map((group) => `<option value="${group.id}">${safe(group.name)} — tối đa ${group.maxRegistrations}</option>`).join("") + '<option value="__new__">＋ Tạo nhóm mới</option>';
  select.value = selected || "";
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

const inputDateTime = (value) => {
  if (!value) return "";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

function openEvent(event = null) {
  $("#eventForm").reset();
  $("#descriptionEditor").innerHTML = event?.descriptionHtml || (event?.description ? `<p>${safe(event.description).replace(/\n/g, "<br>")}</p>` : "");
  $("#eventFormError").classList.add("hidden");
  $("#eventId").value = event?.id || "";
  $("#eventDialogTitle").textContent = event ? "Chỉnh sửa sự kiện" : "Tạo sự kiện";
  for (const key of ["title", "date", "location", "startTime", "endTime", "capacity", "status"]) if (event && $("#" + key)) $("#" + key).value = event[key] ?? "";
  if (event?.status === "draft") $("#status").value = "hidden";
  if (event) {
    $("#openAt").value = inputDateTime(event.openAt);
    $("#closeAt").value = inputDateTime(event.closeAt);
  } else {
    $("#status").value = "open";
  }
  $("#eventAllowCancellation").checked = !!event?.allowCancellation;
  refreshGroupOptions(event?.groupId || "");
  $("#groupId").disabled = !!event && (event.registeredCount || 0) > 0;
  $("#newGroupFields").classList.add("hidden");
  $("#newGroupMax").value = 2;
  renderEventFaculties(event?.allowedFaculties?.length ? event.allowedFaculties : [DEFAULT_FACULTY]);
  $("#eventDialog").showModal();
}

$("#groupId").onchange = () => {
  const creating = $("#groupId").value === "__new__";
  $("#newGroupFields").classList.toggle("hidden", !creating);
  $("#newGroupName").required = creating;
  $("#newGroupMax").required = creating;
  if (creating && !$("#newGroupMax").value) $("#newGroupMax").value = 2;
};

document.querySelectorAll("[data-format]").forEach((button) => button.addEventListener("click", () => {
  $("#descriptionEditor").focus();
  document.execCommand(button.dataset.format, false);
}));
$("#descriptionSize").onchange = (event) => {
  $("#descriptionEditor").focus();
  document.execCommand("fontSize", false, event.target.value);
};
$("#descriptionColor").oninput = (event) => {
  $("#descriptionEditor").focus();
  document.execCommand("foreColor", false, event.target.value);
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
    $("#descriptionEditor").focus();
    document.execCommand("insertImage", false, reader.result);
    event.target.value = "";
  };
  reader.readAsDataURL(file);
};

$("#eventForm").onsubmit = async (event) => {
  event.preventDefault();
  const submit = event.submitter || event.target.querySelector('button[type="submit"],button:not([type])');
  const error = $("#eventFormError");
  submit.disabled = true;
  submit.textContent = "Đang lưu…";
  error.classList.add("hidden");
  const id = $("#eventId").value;
  const data = {};
  for (const key of ["title", "date", "location", "startTime", "endTime", "status"]) data[key] = $("#" + key).value.trim();
  data.descriptionHtml = $("#descriptionEditor").innerHTML.trim();
  data.description = $("#descriptionEditor").innerText.trim();
  data.openAt = $("#openAt").value ? Timestamp.fromDate(new Date($("#openAt").value)) : null;
  data.closeAt = $("#closeAt").value ? Timestamp.fromDate(new Date($("#closeAt").value)) : null;
  data.capacity = Number($("#capacity").value);
  data.allowedFaculties = [...document.querySelectorAll(".event-faculty:checked")].map((input) => input.value);
  data.allowCancellation = $("#eventAllowCancellation").checked;
  data.updatedAt = serverTimestamp();
  try {
    if (!data.title || !data.date || !data.location || !data.startTime || !Number.isInteger(data.capacity) || data.capacity < 1) throw Error("Vui lòng nhập đầy đủ các trường bắt buộc.");
    if (!data.openAt || !data.closeAt) throw Error("Vui lòng chọn thời gian mở và đóng đăng ký.");
    if (data.openAt.toMillis() >= data.closeAt.toMillis()) throw Error("Giờ đóng phải sau giờ mở đăng ký.");
    if (!data.allowedFaculties.length) throw Error("Vui lòng chọn ít nhất một khoa/đơn vị.");
    if (new Blob([JSON.stringify(data)]).size > 900000) throw Error("Nội dung mô tả hoặc hình ảnh quá lớn. Vui lòng giảm kích thước hình.");
    let selectedGroup = $("#groupId").value;
    let group = null;
    if (selectedGroup === "__new__") {
      const name = $("#newGroupName").value.trim();
      const maxRegistrations = Number($("#newGroupMax").value || 2);
      if (!name || !Number.isInteger(maxRegistrations) || maxRegistrations < 1 || maxRegistrations > 20) throw Error("Tên nhóm và giới hạn từ 1 đến 20 là bắt buộc.");
      const groupRef = await addDoc(collection(db, "eventGroups"), { name, maxRegistrations, createdByUid: user.uid, createdByEmail: user.email.toLowerCase(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      selectedGroup = groupRef.id;
      group = { id: groupRef.id, name, maxRegistrations };
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
      await updateDoc(doc(db, "events", id), data);
    } else {
      await addDoc(collection(db, "events"), { ...data, registeredCount: 0, createdByUid: user.uid, createdByEmail: user.email.toLowerCase(), createdByName: user.displayName || "", createdAt: serverTimestamp() });
    }
    $("#eventDialog").close();
    notice("Đã lưu sự kiện.", "success");
  } catch (saveError) {
    error.textContent = saveError.message || "Không thể lưu sự kiện.";
    error.classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.textContent = "Lưu sự kiện";
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
  if (button.dataset.delete) {
    const selected = events.find((item) => item.id === button.dataset.delete);
    if (selected && confirm(`Xóa sự kiện “${selected.title}”?`)) try {
      await deleteDoc(doc(db, "events", selected.id));
      notice("Đã xóa sự kiện.", "success");
    } catch (error) {
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

$("#eventFilter").onchange = renderRegs;
$("#exportBtn").onclick = () => {
  const filter = $("#eventFilter").value;
  const list = filter ? regs.filter((registration) => registration.eventId === filter) : regs;
  const rows = list.map((registration, index) => ({ STT: index + 1, "MSSV/Mã số": registration.identifier || registration.mssv, "Họ tên": registration.name, "Số điện thoại": registration.phone, "Khoa/Đơn vị": registration.faculty, "Đối tượng": registration.participantType || "Sinh viên", Email: registration.email, "Sự kiện": registration.eventTitle, "Nhóm sự kiện": registration.groupName || "Không nhóm", "Ngày sự kiện": registration.eventDate, "Thời gian đăng ký": ts(registration.createdAt) }));
  const selectedEvent = events.find((event) => event.id === filter);
  const cleanName = (selectedEvent?.title || "Tat_ca_su_kien").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70) || "Su_kien";
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), (selectedEvent?.title || "Đăng ký").slice(0, 31));
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
