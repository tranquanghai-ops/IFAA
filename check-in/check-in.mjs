import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, onSnapshot, query, where, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { firebaseConfig, STUDENT_DOMAIN, OWNER_EMAIL } from "../firebase-config.mjs";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const $ = (selector) => document.querySelector(selector);
const sessionId = new URLSearchParams(location.search).get("event");
const esc = (value) => String(value ?? "").replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]);
const stamp = (value) => value?.toDate ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(value.toDate()) : "—";
const vietnamDate = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || "");
};
const successKey = "ifaa-checkin-success-sound";
const duplicateKey = "ifaa-checkin-duplicate-sound";

let user = null, session = null, assignment = null, isManager = false, managerName = "";
let unsubscribeRows = null, unsubscribeSession = null;
let cameraStream = null, cameraControls = null, nativeDetector = null, enhancedReader = null;
let cameraRequest = 0, scanning = false, pendingPhoto = "", lastDecoded = "", lastDecodedAt = 0;
let rosterCache = new Map(), flushing = false;

function notice(text) {
  $("#notice").textContent = text;
  $("#notice").classList.remove("hidden");
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => $("#notice").classList.add("hidden"), 4500);
}
function setScanStatus(type, title, detail = "") {
  const box = $("#scanStatus");
  box.className = "scan-status" + (type ? " " + type : "");
  box.innerHTML = "<b>" + esc(title) + "</b><span>" + esc(detail) + "</span>";
}
function playTone(frequency, duration, delay = 0) {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    const audio = playTone.audio || (playTone.audio = new Audio());
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.13, audio.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + delay + duration);
    oscillator.start(audio.currentTime + delay); oscillator.stop(audio.currentTime + delay + duration);
  } catch {}
}
function feedback(success = true) {
  const mode = success ? $("#successSound").value : $("#duplicateSound").value;
  if (mode !== "off") {
    const frequency = success ? (mode === "soft" ? 620 : 880) : 180;
    playTone(frequency, 0.16);
    if (mode === "double" || mode === "double-low") playTone(frequency, 0.13, 0.19);
  }
  if (navigator.vibrate) navigator.vibrate(success ? 80 : [120, 70, 120]);
}
function validMssv(value) { return /^(?=.{8,12}$)(?=.*\d)[A-Z0-9]+$/.test(value); }
function outboxKey() { return `ifaa-checkin-outbox:${sessionId || "none"}:${user?.uid || "guest"}`; }
function outbox() {
  try { const value = JSON.parse(localStorage.getItem(outboxKey()) || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function saveOutbox(items) {
  if (items.length) localStorage.setItem(outboxKey(), JSON.stringify(items));
  else localStorage.removeItem(outboxKey());
}
function sessionIsOpen() {
  if (session?.status !== "open") return false;
  const end = session.endAt?.toDate ? session.endAt.toDate() : session.endDate ? new Date(session.endDate + "T23:59:59") : null;
  return !end || Date.now() <= end.getTime();
}
function barcodeFormats() { return ["CODE_128", "CODE_39", "CODE_93", "CODABAR", "ITF"].map((name) => window.ZXingBrowser?.BarcodeFormat?.[name]).filter(Number.isInteger); }
function makeReader() {
  const formats = barcodeFormats();
  const hints = window.ZXingBrowser?.DecodeHintType ? new Map([[ZXingBrowser.DecodeHintType.POSSIBLE_FORMATS, formats], [ZXingBrowser.DecodeHintType.TRY_HARDER, true]]) : undefined;
  return new ZXingBrowser.BrowserMultiFormatReader(hints);
}
function releaseCamera() {
  cameraRequest += 1; scanning = false;
  try { cameraControls?.stop(); } catch {}
  cameraControls = null;
  cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null;
  nativeDetector = null; enhancedReader = null; $("#video").srcObject = null;
  $("#startCamera").disabled = !sessionIsOpen(); $("#stopCamera").disabled = true; $("#cameraSelect").disabled = false;
}
async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices(), select = $("#cameraSelect"), selected = select.value;
    select.innerHTML = '<option value="">Tự động chọn camera sau</option>';
    devices.filter((item) => item.kind === "videoinput" && /back|rear|environment|sau/i.test(item.label)).forEach((item, index) => {
      const option = document.createElement("option"); option.value = item.deviceId; option.textContent = item.label || "Camera sau " + (index + 1); select.appendChild(option);
    });
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  } catch {}
}
async function openRearCamera(id = "") {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video: id ? { deviceId: { exact: id } } : { facingMode: { exact: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (error) {
    if (id) throw error;
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
  }
}
function captureFrame({ scale = 1, filter = "none", maxWidth = Infinity } = {}) {
  const video = $("#video");
  if (!cameraStream || video.readyState < 2) throw Error("Vui lòng bật camera trước.");
  const ratio = Math.min(scale, maxWidth / video.videoWidth), canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * ratio)); canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
  const context = canvas.getContext("2d"); context.filter = filter; context.drawImage(video, 0, 0, canvas.width, canvas.height); return canvas;
}
async function startNativeDetector(request) {
  if (!("BarcodeDetector" in window)) return;
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const formats = ["code_128", "code_39", "code_93", "codabar", "itf"].filter((format) => supported.includes(format));
    if (!formats.length) return;
    nativeDetector = new BarcodeDetector({ formats });
    const detect = async () => {
      if (request !== cameraRequest || !scanning || !nativeDetector) return;
      try { const results = await nativeDetector.detect($("#video")); if (results[0]?.rawValue) handleDecoded(results[0].rawValue); } catch {}
      setTimeout(detect, 180);
    };
    detect();
  } catch {}
}
function startEnhancedDetector(request) {
  enhancedReader = makeReader();
  const detect = async () => {
    if (request !== cameraRequest || !scanning || !enhancedReader) return;
    try { const result = await enhancedReader.decodeFromCanvas(captureFrame({ scale: 1.5, filter: "grayscale(1) contrast(1.8)", maxWidth: 1400 })); if (result?.getText()) handleDecoded(result.getText()); } catch {}
    setTimeout(detect, 650);
  };
  detect();
}
async function startCamera() {
  if (!sessionIsOpen()) return;
  if (!navigator.mediaDevices?.getUserMedia) return setScanStatus("error", "Không dùng được camera", "Hãy mở trang bằng HTTPS trong Chrome.");
  if (!window.ZXingBrowser) return setScanStatus("error", "Không tải được bộ đọc mã vạch", "Kiểm tra mạng rồi tải lại trang.");
  releaseCamera(); const request = ++cameraRequest;
  try {
    $("#startCamera").disabled = true; $("#cameraSelect").disabled = true;
    setScanStatus("", "Đang mở camera sau…", "Cho phép quyền camera nếu trình duyệt hỏi.");
    cameraStream = await openRearCamera($("#cameraSelect").value); if (request !== cameraRequest) return;
    const video = $("#video"); video.srcObject = cameraStream; await video.play(); scanning = true;
    const reader = makeReader();
    cameraControls = await reader.decodeFromStream(cameraStream, video, (result) => { if (result && request === cameraRequest) handleDecoded(result.getText()); });
    $("#stopCamera").disabled = false; $("#cameraSelect").disabled = false;
    setScanStatus("success", "Camera sau đang quét", "Đưa mã vạch trên thẻ vào khung.");
    await listCameras(); void startNativeDetector(request); startEnhancedDetector(request);
  } catch (error) {
    releaseCamera();
    const details = { NotAllowedError: "Hãy cấp quyền camera cho trang.", NotReadableError: "Camera đang được ứng dụng khác sử dụng.", NotFoundError: "Không tìm thấy camera sau.", OverconstrainedError: "Camera sau không hỗ trợ cấu hình yêu cầu." };
    setScanStatus("error", "Không mở được camera", details[error.name] || error.message);
  }
}
function handleDecoded(raw) {
  const mssv = String(raw || "").trim().toUpperCase(); if (!validMssv(mssv)) return;
  const now = Date.now(); if (mssv === lastDecoded && now - lastDecodedAt < 2500) return;
  lastDecoded = mssv; lastDecodedAt = now; $("#mssv").value = mssv; void submitCheckin(mssv);
}
function listenRows() {
  unsubscribeRows?.();
  const rowsQuery = assignment.role === "leader" || isManager ? query(collection(db, "checkins"), where("sessionId", "==", session.id)) : query(collection(db, "checkins"), where("scannerUid", "==", user.uid));
  unsubscribeRows = onSnapshot(rowsQuery, (snapshot) => {
    const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.sessionId === session.id && !item.deletedAt).sort((a, b) => (b.checkedAt?.seconds || 0) - (a.checkedAt?.seconds || 0));
    $("#rowCount").textContent = rows.length + " lượt";
    $("#rows").innerHTML = rows.map((item) => `<tr><td>${esc(item.mssv)}</td><td>${esc(item.name)}</td><td>${stamp(item.checkedAt)}</td><td>${(assignment.role === "leader" || isManager) && sessionIsOpen() ? `<button class="att-btn danger" data-delete="${item.id}">Xóa</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="4">Chưa có lượt điểm danh.</td></tr>';
  }, (error) => notice(error.message));
}
function renderSession() {
  const open = sessionIsOpen();
  $("#eventStatus").textContent = open ? "Đang mở" : session.status === "finalized" ? "Đã chốt" : "Đã kết thúc";
  $("#eventStatus").className = "att-badge " + (open ? "open" : session.status === "open" ? "ended" : session.status);
  $("#closedMessage").classList.toggle("hidden", open);
  $("#scannerArea").classList.toggle("hidden", !open);
  $("#roleText").classList.toggle("hidden", !open);
  $("#capturePhoto").disabled = !open;
  if (!open) releaseCamera();
}
async function startSession() {
  if (!sessionId) throw Error("Liên kết điểm danh không hợp lệ.");
  const snapshot = await getDoc(doc(db, "attendanceSessions", sessionId)); if (!snapshot.exists()) throw Error("Không tìm thấy sự kiện điểm danh.");
  session = { id: snapshot.id, ...snapshot.data() };
  if (isManager) assignment = { active: true, role: "leader", name: managerName || user.displayName || user.email };
  else {
    const assignmentSnapshot = await getDoc(doc(db, "scannerAssignments", sessionId + "_" + user.email.toLowerCase()));
    assignment = assignmentSnapshot.data(); if (!assignment?.active) throw Error("Bạn chưa được cấp quyền quét sự kiện này.");
  }
  const rosterSnapshot = await getDocs(query(collection(db, "attendanceRoster"), where("sessionId", "==", session.id)));
  rosterCache = new Map(rosterSnapshot.docs.map((item) => [item.data().mssv, item.data()]));
  $("#loginCard").classList.add("hidden"); $("#app").classList.remove("hidden"); $("#title").textContent = session.title;
  $("#meta").textContent = [vietnamDate(session.date), session.startTime && session.endTime ? session.startTime + "–" + session.endTime : session.startTime || session.endTime, session.location].filter(Boolean).join(" · ");
  $("#roleText").textContent = isManager ? "Quản trị hệ thống" : assignment.role === "leader" ? "SV Leader" : "SV quét";
  renderSession();
  if (sessionIsOpen()) { listenRows(); void flushOutbox(); }
  unsubscribeSession?.();
  unsubscribeSession = onSnapshot(doc(db, "attendanceSessions", sessionId), (live) => {
    if (!live.exists()) return;
    const wasOpen = sessionIsOpen();
    session = { id: live.id, ...live.data() };
    renderSession();
    if (!wasOpen && sessionIsOpen()) { listenRows(); void flushOutbox(); }
    if (!sessionIsOpen()) { unsubscribeRows?.(); unsubscribeRows = null; }
  });
}
async function submitCheckin(raw) {
  if (!sessionIsOpen()) return;
  const mssv = String(raw || "").trim().toUpperCase();
  if (!validMssv(mssv)) { feedback(false); return setScanStatus("warn", "MSSV không hợp lệ", "MSSV gồm 8–12 chữ hoặc số."); }
  try {
    const student = rosterCache.get(mssv);
    if (!student) { feedback(false); return setScanStatus("error", "Không tìm thấy sinh viên", "MSSV không có trong danh sách đối chiếu."); }
    const items = outbox();
    if (items.some((item) => item.mssv === mssv)) { feedback(false); return setScanStatus("warn", "Đã nhận mã — chờ gửi", mssv + " · " + (student.name || "")); }
    const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const record = { requestId, time: new Date().toISOString(), mssv, student: { name: student.name || "", email: student.email || "", uid: student.uid || "" }, photoData: pendingPhoto };
    saveOutbox([...items, record]); pendingPhoto = ""; $("#photoPreviewBox").classList.add("hidden"); $("#mssv").value = "";
    setScanStatus("warn", "Đã nhận mã — chờ gửi", mssv + " · " + (student.name || ""));
    await flushOutbox();
  } catch (error) { feedback(false); setScanStatus("error", "Chưa ghi nhận", error.message || "Vui lòng kiểm tra kết nối mạng."); }
}

async function flushOutbox() {
  if (flushing || !navigator.onLine || !user || !sessionIsOpen()) return;
  flushing = true;
  try {
    while (outbox().length) {
      const record = outbox()[0], checkinRef = doc(db, "checkins", session.id + "_" + record.mssv), existing = await getDoc(checkinRef);
      if (existing.exists() && !existing.data().deletedAt) {
        saveOutbox(outbox().filter((item) => item.requestId !== record.requestId));
        feedback(false); setScanStatus("warn", "Đã điểm danh trước đó", record.mssv + " · " + (existing.data().name || ""));
        continue;
      }
      const student = record.student;
      const data = { sessionId: session.id, eventId: session.eventId || "", mssv: record.mssv, name: student.name || "", email: student.email || "", studentUid: student.uid || "", scannerUid: user.uid, scannerEmail: user.email.toLowerCase(), scannerMssv: user.email.split("@")[0].toUpperCase(), scannerName: assignment.name || user.displayName || user.email, checkedAt: Timestamp.fromDate(new Date(record.time)), requestId: record.requestId, deletedAt: null };
      if (record.photoData) data.photoData = record.photoData;
      await setDoc(checkinRef, data);
      saveOutbox(outbox().filter((item) => item.requestId !== record.requestId));
      feedback(true); setScanStatus("success", "Điểm danh thành công", record.mssv + " · " + (student.name || ""));
    }
  } catch (error) {
    setScanStatus("warn", "Đã lưu trên điện thoại — chờ gửi", `${outbox().length} lượt đang chờ · ${error.message || "mất kết nối"}`);
  } finally { flushing = false; }
}
function capturePhoto() {
  try { const canvas = captureFrame({ maxWidth: 1400 }); pendingPhoto = canvas.toDataURL("image/jpeg", 0.7); $("#photoPreview").src = pendingPhoto; $("#photoPreviewBox").classList.remove("hidden"); notice("Đã chụp hình. Nhập MSSV để lưu kèm ảnh."); }
  catch (error) { notice(error.message); }
}
async function login() { try { await signInWithPopup(auth, provider); } catch (error) { if (error?.code !== "auth/popup-closed-by-user") notice(error.message); } }

onAuthStateChanged(auth, async (currentUser) => {
  user = currentUser; $("#loginBtn").classList.toggle("hidden", !!currentUser); $("#logoutBtn").classList.toggle("hidden", !currentUser); $("#loginCard").classList.toggle("hidden", !!currentUser); $("#app").classList.add("hidden");
  releaseCamera(); unsubscribeRows?.(); unsubscribeSession?.();
  if (!currentUser) { $("#account").textContent = "Vui lòng đăng nhập để quét điểm danh."; return; }
  try {
    const email = currentUser.email.toLowerCase(), adminSnapshot = email === OWNER_EMAIL ? null : await getDoc(doc(db, "admins", email));
    isManager = email === OWNER_EMAIL || !!adminSnapshot?.exists();
    if (!isManager && !email.endsWith(STUDENT_DOMAIN)) throw Error("Chỉ chấp nhận tài khoản TDTU đã được cấp quyền.");
    if (isManager) { const profileSnapshot = await getDoc(doc(db, "profiles", currentUser.uid)); managerName = String(adminSnapshot?.data()?.name || profileSnapshot.data()?.name || currentUser.displayName || email).trim(); }
    $("#account").textContent = (isManager ? managerName + " · " : "") + email; await startSession();
  } catch (error) { notice(error.message); $("#loginCard").classList.remove("hidden"); $("#loginCard h2").textContent = "Không thể mở trang quét"; $("#loginCard p").textContent = error.message; }
});

$("#successSound").value = localStorage.getItem(successKey) || "bell"; $("#duplicateSound").value = localStorage.getItem(duplicateKey) || "low";
$("#successSound").onchange = () => localStorage.setItem(successKey, $("#successSound").value); $("#duplicateSound").onchange = () => localStorage.setItem(duplicateKey, $("#duplicateSound").value);
$("#testSuccess").onclick = () => feedback(true); $("#testDuplicate").onclick = () => feedback(false); $("#loginBtn").onclick = login; $("#loginCardBtn").onclick = login; $("#logoutBtn").onclick = () => signOut(auth);
$("#startCamera").onclick = startCamera; $("#stopCamera").onclick = () => { releaseCamera(); setScanStatus("", "Đã dừng camera", "Nhấn Bắt đầu quét để tiếp tục."); }; $("#cameraSelect").onchange = () => { if (scanning) void startCamera(); };
$("#capturePhoto").onclick = capturePhoto; $("#discardPhoto").onclick = () => { pendingPhoto = ""; $("#photoPreviewBox").classList.add("hidden"); };
$("#scanForm").onsubmit = async (event) => { event.preventDefault(); await submitCheckin($("#mssv").value); };
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete]"); if (!button || (!isManager && assignment?.role !== "leader") || !sessionIsOpen()) return;
  await setDoc(doc(db, "checkins", button.dataset.delete), { deletedAt: serverTimestamp(), deletedByUid: user.uid, deletedByEmail: user.email }, { merge: true }); notice("Đã xóa lượt điểm danh.");
});
window.addEventListener("pagehide", releaseCamera);
window.addEventListener("online", () => void flushOutbox());
window.addEventListener("offline", () => setScanStatus("warn", "Mất mạng", "Lượt quét mới sẽ được giữ trên điện thoại và tự gửi lại."));
