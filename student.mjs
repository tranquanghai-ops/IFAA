import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, onSnapshot, query, where, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { firebaseConfig, STUDENT_DOMAIN } from "./firebase-config.mjs";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const $ = (selector) => document.querySelector(selector);
const safe = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const millis = (value) => value?.toDate ? value.toDate().getTime() : (value ? new Date(value).getTime() : null);
const tdtuEmail = (email) => {
  const value = String(email || "").toLowerCase();
  return value.endsWith(STUDENT_DOMAIN) || value.endsWith("@tdtu.edu.vn");
};
const participantType = (email) => String(email || "").toLowerCase().endsWith(STUDENT_DOMAIN)
  ? "Sinh viên"
  : String(email || "").toLowerCase().endsWith("@tdtu.edu.vn") ? "Giảng viên/Nhân sự" : "Admin";

let user = null;
let profile = null;
let events = [];
let myRegs = new Map();
let groupLimits = new Map();
let settings = { allowCancellation: false };
let filter = "open";
let chosen = null;
let unsubscribers = [];

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

function eventState(event) {
  if (myRegs.has(event.id)) return "mine";
  if (event.status !== "open") return "closed";
  const now = Date.now();
  const open = millis(event.openAt) ?? 0;
  const close = millis(event.closeAt) ?? Infinity;
  if (now < open || now > close) return "closed";
  if ((event.registeredCount || 0) >= (event.capacity || 0)) return "full";
  return "open";
}

function groupStatus(event) {
  if (!event.groupId) return { text: "Không thuộc nhóm · Không giới hạn lượt", blocked: false };
  const stat = groupLimits.get(event.groupId);
  const used = stat?.count || 0;
  const max = Number(event.groupMaxRegistrations || stat?.maxRegistrations || 1);
  return { text: `Nhóm: ${event.groupName || "Chưa đặt tên"} · Bạn đã chọn ${used}/${max}`, blocked: used >= max && !myRegs.has(event.id) };
}

function render() {
  const list = events.filter((event) => filter === "all" || (filter === "mine" ? eventState(event) === "mine" : eventState(event) === "open"));
  $("#eventSummary").textContent = `${list.length} sự kiện phù hợp`;
  const grid = $("#eventGrid");
  if (!list.length) {
    grid.innerHTML = '<div class="card empty">Chưa có sự kiện phù hợp.</div>';
    return;
  }
  grid.innerHTML = list.map((event) => {
    const state = eventState(event);
    const used = event.registeredCount || 0;
    const capacity = event.capacity || 0;
    const left = Math.max(0, capacity - used);
    const percent = capacity ? Math.min(100, used / capacity * 100) : 0;
    const group = groupStatus(event);
    const disabled = state !== "open" || group.blocked;
    const label = { open: "CÒN CHỖ", full: "ĐÃ ĐỦ", mine: "ĐÃ ĐĂNG KÝ", closed: "ĐÃ ĐÓNG" }[state];
    return `<article class="card event"><div class="event-top"><div><span class="tag ${state}">${label}</span><h3>${safe(event.title)}</h3></div></div><div class="meta"><span>◷ ${safe(formatDate(event))} · ${safe(event.startTime || "")}${event.endTime ? `–${safe(event.endTime)}` : ""}</span><span>⌖ ${safe(event.location || "Chưa cập nhật địa điểm")}</span><span><b>${safe(group.text)}</b></span></div><div class="progress"><i style="width:${percent}%"></i></div><div class="capacity"><span>${used}/${capacity} người tham gia</span><b>Còn ${left} chỗ</b></div><div class="event-actions"><button class="btn" data-view="${event.id}">Xem chi tiết</button>${state === "mine" && settings.allowCancellation ? `<button class="btn btn-danger" data-cancel="${event.id}">Hủy đăng ký</button>` : `<button class="btn btn-primary" data-register="${event.id}" ${disabled ? "disabled" : ""}>${group.blocked ? "Đã đạt giới hạn nhóm" : "Đăng ký"}</button>`}</div></article>`;
  }).join("");
}

function showProfileForm(force = false) {
  $("#profileEmail").value = user?.email || "";
  $("#profileName").value = profile?.name || user?.displayName || "";
  $("#profilePhone").value = profile?.phone || "";
  $("#profileFaculty").value = profile?.faculty || "";
  $("#profilePanel").classList.toggle("hidden", !force && !!profile);
  $("#eventArea").classList.toggle("hidden", force || !profile);
  $("#editProfileBtn").classList.toggle("hidden", !profile || force);
}

async function loadProfile() {
  const snapshot = await getDoc(doc(db, "profiles", user.uid));
  profile = snapshot.exists() ? snapshot.data() : null;
  showProfileForm(!profile);
  if (profile) loadData();
}

function clearListeners() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

function loadData() {
  clearListeners();
  unsubscribers.push(onSnapshot(doc(db, "settings", "main"), (snapshot) => {
    if (snapshot.exists()) settings = { ...settings, ...snapshot.data() };
    render();
  }));
  unsubscribers.push(onSnapshot(query(collection(db, "registrations"), where("uid", "==", user.uid)), (snapshot) => {
    myRegs = new Map(snapshot.docs.map((item) => [item.data().eventId, { id: item.id, ...item.data() }]));
    render();
  }));
  unsubscribers.push(onSnapshot(query(collection(db, "registrationLimits"), where("uid", "==", user.uid)), (snapshot) => {
    groupLimits = new Map(snapshot.docs.map((item) => [item.data().groupId, item.data()]));
    render();
  }));
  unsubscribers.push(onSnapshot(collection(db, "events"), (snapshot) => {
    events = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
    render();
  }));
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
        if ((current.count || 0) >= group.maxRegistrations) throw Error(`Bạn đã đăng ký đủ ${group.maxRegistrations} sự kiện trong nhóm này.`);
      }
      const now = Date.now();
      if (event.status !== "open" || (event.registeredCount || 0) >= event.capacity || now < (millis(event.openAt) ?? 0) || now > (millis(event.closeAt) ?? Infinity)) throw Error("Sự kiện đã đủ, chưa mở hoặc đã đóng.");
      const identifier = user.email.split("@")[0].toUpperCase();
      transaction.update(eventRef, { registeredCount: (event.registeredCount || 0) + 1, updatedAt: serverTimestamp() });
      transaction.set(registrationRef, { uid: user.uid, email: user.email.toLowerCase(), identifier, mssv: identifier, participantType: profile.participantType, name: profile.name, phone: profile.phone, faculty: profile.faculty, eventId, eventTitle: event.title, eventDate: event.date, groupId: event.groupId || "", groupName: event.groupName || "", createdAt: serverTimestamp() });
      if (event.groupId) transaction.set(limitRef, { uid: user.uid, email: user.email.toLowerCase(), groupId: event.groupId, groupName: group.name, maxRegistrations: group.maxRegistrations, count: (current.count || 0) + 1, eventIds: [...(current.eventIds || []), eventId], updatedAt: serverTimestamp() });
    });
    show("Đăng ký thành công.", "success");
  } catch (error) {
    show(error.message || "Không thể đăng ký.", "error");
  }
}

async function cancel(eventId) {
  if (!settings.allowCancellation) return;
  const eventRef = doc(db, "events", eventId);
  const registrationRef = doc(db, "registrations", `${user.uid}_${eventId}`);
  try {
    await runTransaction(db, async (transaction) => {
      const eventSnapshot = await transaction.get(eventRef);
      const registrationSnapshot = await transaction.get(registrationRef);
      if (!eventSnapshot.exists() || !registrationSnapshot.exists()) throw Error("Không tìm thấy đăng ký.");
      const event = eventSnapshot.data();
      let limitRef = null;
      let current = null;
      if (event.groupId) {
        limitRef = doc(db, "registrationLimits", `${user.uid}_${event.groupId}`);
        const limitSnapshot = await transaction.get(limitRef);
        if (!limitSnapshot.exists()) throw Error("Không tìm thấy hạn mức nhóm.");
        current = limitSnapshot.data();
      }
      transaction.update(eventRef, { registeredCount: Math.max(0, (event.registeredCount || 0) - 1), updatedAt: serverTimestamp() });
      transaction.delete(registrationRef);
      if (limitRef) transaction.set(limitRef, { ...current, count: Math.max(0, current.count - 1), eventIds: (current.eventIds || []).filter((id) => id !== eventId), updatedAt: serverTimestamp() });
    });
    show("Đã hủy đăng ký.", "success");
  } catch (error) {
    show(error.message || "Không thể hủy.", "error");
  }
}

function openDetail(id) {
  chosen = events.find((event) => event.id === id);
  if (!chosen) return;
  const group = groupStatus(chosen);
  $("#detailTitle").textContent = chosen.title;
  $("#detailBody").innerHTML = `<div class="meta"><span><b>Thời gian:</b> ${safe(formatDate(chosen))}, ${safe(chosen.startTime || "")}${chosen.endTime ? `–${safe(chosen.endTime)}` : ""}</span><span><b>Địa điểm:</b> ${safe(chosen.location || "Chưa cập nhật")}</span><span><b>${safe(group.text)}</b></span></div><p>${safe(chosen.description || "Không có mô tả.")}</p><div class="notice">Còn ${Math.max(0, chosen.capacity - (chosen.registeredCount || 0))} chỗ.</div>`;
  $("#confirmBtn").disabled = eventState(chosen) !== "open" || group.blocked;
  $("#detailDialog").showModal();
}

$("#profileForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const previous = profile;
    const data = { uid: user.uid, email: user.email.toLowerCase(), participantType: participantType(user.email), name: $("#profileName").value.trim(), phone: $("#profilePhone").value.trim(), faculty: $("#profileFaculty").value.trim(), updatedAt: serverTimestamp() };
    if (!data.name || !data.phone || !data.faculty) throw Error("Vui lòng nhập đầy đủ thông tin.");
    if (!/^[0-9+().\s-]{8,20}$/.test(data.phone)) throw Error("Số điện thoại chưa đúng định dạng.");
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
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.close !== undefined) $("#detailDialog").close();
  if (button.dataset.view) openDetail(button.dataset.view);
  if (button.dataset.register) openDetail(button.dataset.register);
  if (button.dataset.cancel && confirm("Hủy đăng ký sự kiện này?")) cancel(button.dataset.cancel);
  if (button.classList.contains("filter")) {
    document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    filter = button.dataset.filter;
    render();
  }
});
$("#confirmBtn").onclick = async () => { if (chosen) { $("#detailDialog").close(); await register(chosen.id); } };

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
