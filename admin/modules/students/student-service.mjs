import { collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, query, serverTimestamp, setDoc, startAfter, where, writeBatch } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

const FACULTY_MAJORS = ["Thiết kế đồ họa", "Thiết kế công nghiệp", "Thiết kế nội thất", "Thiết kế thời trang", "Nghệ thuật số"];
const MAJOR_BY_CLASS_CODE = { "101": "Thiết kế đồ họa", "102": "Thiết kế công nghiệp", "103": "Thiết kế nội thất", "104": "Thiết kế thời trang", "105": "Nghệ thuật số" };

export function createAdminStudentService({ db, storage, select, safe, getUser, hasHighAdminAccess, notice, confirmAction, normalizeAttendanceHeader, loadFacultyDataset, publishFacultyDataset, downloadWorkbook }) {
  let facultyStudents = [];
  let facultyNameSearchCache = null;
  let facultyStudentDatasetMeta = {};
  let facultyStudentPage = 1;
  let facultyStudentCursor = null;
  let facultyStudentHasNext = false;
  let facultyStudentTotal = 0;
  let expiredFacultyStudents = [];

  function validStudentId(value) { return /^(?=.{8,12}$)(?=.*\d)[A-Z0-9]+$/.test(String(value || "").trim().toUpperCase()); }
  function normalizeSearch(value) { return String(value || "").trim().toLocaleLowerCase("vi"); }
  function studentRecord(value = {}) {
    const mssv = String(value.mssv || value.identifier || "").trim().toUpperCase();
    const studentClass = String(value.studentClass || value.class || "").trim();
    const classCode = /^\d{6,}$/.test(studentClass) ? studentClass.slice(3, 6) : "";
    const yy = /^1\d{7,}$/.test(mssv) ? Number(mssv.slice(1, 3)) : null;
    return { mssv, name: String(value.name || "").trim().replace(/\s+/g, " "), email: String(value.email || (mssv ? mssv.toLowerCase() + "@student.tdtu.edu.vn" : "")).trim().toLowerCase(), personalEmail: String(value.personalEmail || "").trim().toLowerCase(), phone: String(value.phone || "").trim(), gender: String(value.gender || "").trim(), major: String(value.major || "").trim() || MAJOR_BY_CLASS_CODE[classCode] || "", studentClass, admissionYear: value.admissionYear || (yy !== null ? 2000 + yy : ""), course: value.course || (yy !== null ? yy + 4 : "") };
  }
  function facultyDatasetSummary(rows) {
    const classesByMajor = {};
    rows.forEach((item) => {
      if (item.major && item.studentClass) (classesByMajor[item.major] ||= []).push(item.studentClass);
    });
    Object.keys(classesByMajor).forEach((major) => { classesByMajor[major] = [...new Set(classesByMajor[major])].sort(); });
    return {
      count: rows.length,
      majors: [...new Set(rows.map((item) => item.major).filter(Boolean))].sort(),
      classes: [...new Set(rows.map((item) => item.studentClass).filter(Boolean))].sort(),
      classesByMajor
    };
  }
  function showFacultyDatasetStatus(text, state = "") {
    const target = select("#facultyDatasetStatus");
    if (!target) return;
    target.textContent = text;
    target.dataset.state = state;
  }
  async function facultyDatasetBaseRows() {
    if (Number(facultyStudentDatasetMeta.datasetVersion || 0)) {
      try { return (await loadFacultyDataset(storage, facultyStudentDatasetMeta)).map(studentRecord); }
      catch (error) { console.warn("Không tải được dữ liệu SV nén, tạo lại từ Firestore:", error); }
    }
    const snapshot = await getDocs(collection(db, "facultyStudents"));
    return snapshot.docs.map((item) => studentRecord({ ...item.data(), mssv: item.id }));
  }
  async function publishFacultyRows(records, message = "Đang cập nhật dữ liệu nén…") {
    showFacultyDatasetStatus(message, "loading");
    const rows = [...new Map(records.map(studentRecord).filter((item) => validStudentId(item.mssv) && item.name).map((item) => [item.mssv, item])).values()];
    const publicRows = rows.map(({ personalEmail, phone, ...item }) => item);
    const result = await publishFacultyDataset(storage, publicRows);
    const summary = facultyDatasetSummary(rows);
    const metadata = { ...summary, datasetVersion: result.version, datasetPath: result.path, datasetUrl: result.url, datasetEncoding: "gzip", datasetBytes: result.bytes, datasetUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await setDoc(doc(db, "facultyStudentMeta", "current"), metadata, { merge: true });
    facultyStudentDatasetMeta = { ...facultyStudentDatasetMeta, ...metadata };
    facultyStudentTotal = rows.length;
    facultyNameSearchCache = publicRows;
    showFacultyDatasetStatus(`Dữ liệu nén: ${rows.length} SV · ${(result.bytes / 1024).toFixed(1)} KB`, "success");
    return rows;
  }
  async function updateFacultyDataset(transform, message = "Đang cập nhật dữ liệu nén…") {
    const current = await facultyDatasetBaseRows();
    return publishFacultyRows(await transform(current), message);
  }
  async function updateFacultyDatasetAfterWrite(transform) {
    try { return await updateFacultyDataset(transform); }
    catch (error) {
      facultyStudentDatasetMeta = { ...facultyStudentDatasetMeta, datasetVersion: 0 };
      try {
        await setDoc(doc(db, "facultyStudentMeta", "current"), { datasetVersion: 0, datasetPath: "", datasetSyncError: String(error.message || error).slice(0, 300), updatedAt: serverTimestamp() }, { merge: true });
      } catch {}
      showFacultyDatasetStatus("Dữ liệu nén cần tạo lại; trang quét đang dùng chế độ tra từng MSSV.", "error");
      throw error;
    }
  }
  async function rebuildFacultyDataset() {
    showFacultyDatasetStatus("Đang đọc danh sách Firestore để tạo file nén…", "loading");
    const snapshot = await getDocs(collection(db, "facultyStudents"));
    const rows = snapshot.docs.map((item) => studentRecord({ ...item.data(), mssv: item.id }));
    return publishFacultyRows(rows, "Đang tải file nén lên Cloud Storage…");
  }
  function renderFacultyStudents(rows = facultyStudents) {
    const searching = normalizeSearch(select("#facultyStudentSearch")?.value);
    select("#facultyStudentCount").textContent = searching ? `${rows.length} sinh viên` : `${rows.length} đang hiển thị`;
    select("#facultyStudentTotalTop").textContent = `Tổng: ${facultyStudentTotal || rows.length} sinh viên`;
    const edit = (item, field, value, type = "text") => value ? safe(value) : type === "select" ? `<select class="student-inline" data-student-field="${field}" data-student-id="${safe(item.mssv)}"><option value="">— Chọn —</option>${field === "major" ? FACULTY_MAJORS.map((v) => `<option>${safe(v)}</option>`).join("") : '<option>Nam</option><option>Nữ</option>'}</select>` : `<input class="student-inline" data-student-field="${field}" data-student-id="${safe(item.mssv)}" placeholder="Bổ sung..." value="">`;
    const contactInput = (item, field, value, type) => `<input class="student-inline" data-student-field="${field}" data-student-id="${safe(item.mssv)}" type="${type}" maxlength="${type === "email" ? 254 : 40}" placeholder="Bổ sung..." value="${safe(value)}">`;
    select("#facultyStudentRows").innerHTML = rows.map((item) => `<tr><td><b>${safe(item.mssv)}</b></td><td>${edit(item, "name", item.name)}</td><td>${edit(item, "gender", item.gender, "select")}</td><td>${edit(item, "major", item.major, "select")}</td><td>${edit(item, "studentClass", item.studentClass)}</td><td>${contactInput(item, "personalEmail", item.personalEmail, "email")}</td><td>${contactInput(item, "phone", item.phone, "tel")}</td><td><button class="btn btn-small btn-danger" data-remove-faculty-student="${safe(item.mssv)}">Xóa</button></td></tr>`).join("") || '<tr><td colspan="8" class="empty">Không có sinh viên phù hợp.</td></tr>';
    select("#attendanceStudentOptions").innerHTML = rows.map((item) => `<option value="${safe(item.mssv)}">${safe(item.name)}</option><option value="${safe(item.name)}">${safe(item.mssv)}</option>`).join("");
    select("#facultyStudentPageInfo").textContent = `Trang ${facultyStudentPage}`;
    select("#facultyStudentPrev").disabled = facultyStudentPage <= 1;
    select("#facultyStudentNext").disabled = !facultyStudentHasNext;
  }
  async function loadFacultyStudentMeta() {
    const snap = await getDoc(doc(db, "facultyStudentMeta", "current"));
    let data = snap.exists() ? snap.data() : {};
    if (!snap.exists() && hasHighAdminAccess()) {
      const count = (await getCountFromServer(collection(db, "facultyStudents"))).data().count;
      data = { count, majors: [], classes: [], classesByMajor: {} };
      await setDoc(doc(db, "facultyStudentMeta", "current"), { ...data, updatedAt: serverTimestamp() }, { merge: true });
    }
    facultyStudentDatasetMeta = data;
    facultyStudentTotal = Number(data.count || 0);
    try { facultyStudentTotal = (await getCountFromServer(collection(db, "facultyStudents"))).data().count; } catch {}
    select("#facultyStudentTotalTop").textContent = `Tổng: ${facultyStudentTotal} sinh viên`;
    if (data.datasetVersion) showFacultyDatasetStatus(`Dữ liệu nén: ${Number(data.count || 0)} SV · ${data.datasetBytes ? (Number(data.datasetBytes) / 1024).toFixed(1) + " KB" : "đã sẵn sàng"}`, "success");
    else showFacultyDatasetStatus("Chưa tạo dữ liệu nén cho trang điểm danh.", "warn");
    const majors = [...new Set([...FACULTY_MAJORS, ...(data.majors || [])])].sort();
    const byMajor = data.classesByMajor || {};
    const classes = [...new Set(data.classes || [])].sort();
    select("#facultyStudentMajorFilter").innerHTML = '<option value="">Tất cả ngành</option>' + majors.map((v) => `<option>${safe(v)}</option>`).join("");
    select("#facultyStudentMajorFilter").onchange = () => { const selected = select("#facultyStudentMajorFilter").value; const filtered = selected && byMajor[selected] ? byMajor[selected] : classes; select("#facultyStudentClassFilter").innerHTML = '<option value="">Tất cả lớp</option>' + [...new Set(filtered)].sort().map((v) => `<option>${safe(v)}</option>`).join(""); };
    select("#facultyStudentClassFilter").innerHTML = '<option value="">Tất cả lớp</option>' + classes.map((v) => `<option>${safe(v)}</option>`).join("");
    await loadExpiredFacultyStudents();
  }
  function studentTrainingExpired(item) { const year = Number(item.admissionYear); return year > 0 && new Date().getFullYear() > year + 7; }
  async function loadExpiredFacultyStudents() {
    try {
      const snapshot = await getDocs(query(collection(db, "facultyStudents"), where("admissionYear", "<=", new Date().getFullYear() - 8)));
      expiredFacultyStudents = snapshot.docs.map((item) => studentRecord({ ...item.data(), mssv: item.id })).filter(studentTrainingExpired);
      const expiredNotice = select("#facultyStudentExpiredNotice");
      if (!expiredFacultyStudents.length) { expiredNotice.classList.add("hidden"); select("#facultyStudentExpiredPanel").classList.add("hidden"); return; }
      expiredNotice.textContent = `Có ${expiredFacultyStudents.length} sinh viên đã hết hạn đào tạo`;
      expiredNotice.classList.remove("hidden");
      select("#facultyStudentExpiredRows").innerHTML = expiredFacultyStudents.map((item) => `<tr><td><b>${safe(item.mssv)}</b></td><td>${safe(item.name)}</td><td>${safe(item.admissionYear)}</td><td>K${safe(item.course)}</td><td><button class="btn btn-small btn-danger" data-remove-expired-student="${safe(item.mssv)}">Xóa</button></td></tr>`).join("");
    } catch (error) { notice("Không thể kiểm tra sinh viên hết hạn: " + error.message, "error"); }
  }
  async function loadFacultyStudentPage(reset = false) {
    if (reset) { facultyStudentPage = 1; facultyStudentCursor = null; }
    const search = normalizeSearch(select("#facultyStudentSearch").value), major = select("#facultyStudentMajorFilter").value, studentClass = select("#facultyStudentClassFilter").value, size = Number(select("#facultyStudentPageSize").value || 15);
    if (search && validStudentId(search.toUpperCase())) {
      const snap = await getDoc(doc(db, "facultyStudents", search.toUpperCase())); facultyStudents = snap.exists() ? [studentRecord({ ...snap.data(), mssv: snap.id })] : []; facultyStudentHasNext = false;
    } else {
      if (search) {
        if (!facultyNameSearchCache) {
          try { facultyNameSearchCache = (await loadFacultyDataset(storage, facultyStudentDatasetMeta)).map(studentRecord); }
          catch {
            const all = await getDocs(query(collection(db, "facultyStudents"), limit(5000)));
            facultyNameSearchCache = all.docs.map((item) => studentRecord({ ...item.data(), mssv: item.id }));
          }
        }
        const matches = facultyNameSearchCache.filter((item) => normalizeSearch(item.name).includes(search) && (!major || item.major === major) && (!studentClass || item.studentClass === studentClass)).slice(0, size);
        facultyStudents = (await Promise.all(matches.map(async (item) => {
          const snapshot = await getDoc(doc(db, "facultyStudents", item.mssv));
          return snapshot.exists() ? studentRecord({ ...snapshot.data(), mssv: snapshot.id }) : item;
        })));
        facultyStudentHasNext = false;
        select("#facultyStudentPrompt").classList.add("hidden"); select("#facultyStudentTableWrap").classList.remove("hidden"); renderFacultyStudents(facultyStudents.slice(0, size)); return;
      }
      const constraints = []; if (studentClass) constraints.push(where("studentClass", "==", studentClass)); else if (major) constraints.push(where("major", "==", major)); constraints.push(limit(size)); if (facultyStudentCursor) constraints.push(startAfter(facultyStudentCursor));
      const snap = await getDocs(query(collection(db, "facultyStudents"), ...constraints)); facultyStudents = snap.docs.map((item) => studentRecord({ ...item.data(), mssv: item.id })).filter((item) => !major || item.major === major); facultyStudentCursor = snap.docs.at(-1) || null; facultyStudentHasNext = snap.docs.length === size;
      if (search) facultyStudents = facultyStudents.filter((item) => normalizeSearch(item.name).includes(search));
    }
    select("#facultyStudentPrompt").classList.add("hidden"); select("#facultyStudentTableWrap").classList.remove("hidden"); renderFacultyStudents();
  }
  function resolveFacultyStudent(value) {
    const key = normalizeSearch(value);
    const exact = facultyStudents.filter((item) => normalizeSearch(item.mssv) === key || normalizeSearch(item.name) === key);
    if (exact.length === 1) return studentRecord(exact[0]);
    const partial = facultyStudents.filter((item) => normalizeSearch(item.mssv).includes(key) || normalizeSearch(item.name).includes(key));
    return partial.length === 1 ? studentRecord(partial[0]) : null;
  }
  async function readFacultyStudentFile(file) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
    if (!rows.length) return [];
    const keys = Object.keys(rows[0]), find = (...names) => keys.find((key) => names.includes(normalizeAttendanceHeader(key)));
    const mssvKey = find("mssv", "masv", "masinhvien", "studentid"), nameKey = find("hoten", "hovaten", "name", "fullname"), familyKey = find("holot", "hodem", "ho"), givenKey = find("ten", "firstname"), genderKey = find("gioitinh", "gender"), majorKey = find("nganh", "nganhhoc", "major"), classKey = find("lop", "lopquanly", "class"), personalEmailKey = find("emailcanhan", "personalemail"), phoneKey = find("sodienthoai", "dienthoai", "phone");
    if (!mssvKey || (!nameKey && !(familyKey && givenKey))) throw Error("File danh sách SV khoa cần có cột MSSV và Họ và tên (hoặc Họ lót + Tên).");
    return rows.map((row) => studentRecord({ mssv: row[mssvKey], name: nameKey ? row[nameKey] : `${row[familyKey] || ""} ${row[givenKey] || ""}`, gender: row[genderKey], major: row[majorKey], studentClass: row[classKey], personalEmail: row[personalEmailKey], phone: row[phoneKey] })).filter((item) => validStudentId(item.mssv) && item.name);
  }
  async function saveFacultyStudents(records) {
    if (!hasHighAdminAccess()) throw Error("Chỉ Chủ sở hữu hoặc Admin cấp cao được cập nhật danh sách SV khoa.");
    const unique = [...new Map(records.map(studentRecord).filter((item) => validStudentId(item.mssv) && item.name).map((item) => [item.mssv, item])).values()];
    const user = getUser();
    for (let offset = 0; offset < unique.length; offset += 450) {
      const batch = writeBatch(db);
      unique.slice(offset, offset + 450).forEach((item) => batch.set(doc(db, "facultyStudents", item.mssv), { ...item, nameLower: normalizeSearch(item.name), updatedByUid: user.uid, updatedByEmail: user.email, updatedAt: serverTimestamp() }, { merge: true }));
      await batch.commit();
    }
    await updateFacultyDatasetAfterWrite((current) => {
      const map = new Map(current.map((item) => [item.mssv, item]));
      unique.forEach((item) => map.set(item.mssv, { ...map.get(item.mssv), ...item }));
      return [...map.values()];
    });
    await loadFacultyStudentMeta();
    return unique.length;
  }
  function bindStudentControls() {
    select("#facultyStudentSearchBtn").onclick = () => loadFacultyStudentPage(true).catch((error) => notice(error.message, "error"));
    select("#facultyStudentLoadBtn").onclick = () => loadFacultyStudentPage(true).catch((error) => notice(error.message, "error"));
    select("#facultyStudentNext").onclick = () => { facultyStudentPage += 1; loadFacultyStudentPage().catch((error) => notice(error.message, "error")); };
    select("#facultyStudentPrev").onclick = () => { if (facultyStudentPage > 1) { facultyStudentPage -= 1; facultyStudentCursor = null; loadFacultyStudentPage(true).catch((error) => notice(error.message, "error")); } };
    select("#facultyStudentResetBtn").onclick = () => { select("#facultyStudentSearch").value = ""; select("#facultyStudentMajorFilter").value = ""; select("#facultyStudentClassFilter").value = ""; facultyStudentPage = 1; facultyStudentCursor = null; select("#facultyStudentTableWrap").classList.add("hidden"); select("#facultyStudentPrompt").classList.remove("hidden"); select("#facultyStudentCount").textContent = "0 sinh viên"; };
    select("#facultyStudentForm").onsubmit = async (event) => {
      event.preventDefault();
      try {
        const count = await saveFacultyStudents([{ mssv: select("#facultyStudentMssv").value, name: select("#facultyStudentName").value, gender: select("#facultyStudentGender").value, major: select("#facultyStudentMajor").value, studentClass: select("#facultyStudentClass").value, personalEmail: select("#facultyStudentPersonalEmail").value, phone: select("#facultyStudentPhone").value }]);
        event.target.reset(); notice(`Đã lưu ${count} sinh viên.`, "success");
      } catch (error) { notice(error.message, "error"); }
    };
    select("#facultyStudentFile").onchange = async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      try { const rows = await readFacultyStudentFile(file), count = await saveFacultyStudents(rows); notice(`Đã cập nhật ${count} sinh viên và dữ liệu nén cho trang điểm danh.`, "success"); }
      catch (error) { notice(error.message, "error"); }
      event.target.value = "";
    };
    select("#facultyDatasetRebuild").onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const rows = await rebuildFacultyDataset();
        await loadFacultyStudentMeta();
        notice(`Đã tạo lại dữ liệu nén cho ${rows.length} sinh viên.`, "success");
      } catch (error) { showFacultyDatasetStatus("Không thể tạo dữ liệu nén.", "error"); notice(error.message, "error"); }
      finally { button.disabled = false; }
    };
    select("#facultyStudentTemplate").onclick = () => downloadWorkbook("MAU_DANH_SACH_SV_KHOA.xlsx", "Danh sach SV khoa", [{ MSSV: "12300325", "Họ và tên": "Nguyễn Văn A", "Giới tính": "Nam", "Ngành": "Thiết kế nội thất", "Lớp": "230H0101", "Email cá nhân": "", "Số điện thoại": "" }]);
    select("#facultyStudentExport").onclick = async () => {
      try {
        const snapshot = await getDocs(collection(db, "facultyStudents"));
        const rows = snapshot.docs.map((item) => studentRecord({ ...item.data(), mssv: item.id }));
        downloadWorkbook("DANH_SACH_SV_KHOA.xlsx", "Danh sach SV khoa", rows.map((item, index) => ({ STT: index + 1, MSSV: item.mssv, "Họ và tên": item.name, "Giới tính": item.gender, "Ngành": item.major, "Lớp": item.studentClass, "Email cá nhân": item.personalEmail, "Số điện thoại": item.phone })));
      } catch (error) { notice(error.message, "error"); }
    };
    select("#facultyStudentRows").onchange = async (event) => {
      const field = event.target.closest("[data-student-field]"); if (!field) return;
      try {
        const mssv = field.dataset.studentId, key = field.dataset.studentField, value = field.value.trim();
        await setDoc(doc(db, "facultyStudents", mssv), { [key]: value, ...(key === "name" ? { nameLower: normalizeSearch(value) } : {}), updatedByUid: getUser().uid, updatedAt: serverTimestamp() }, { merge: true });
        await updateFacultyDatasetAfterWrite((rows) => rows.map((item) => item.mssv === mssv ? { ...item, [key]: value } : item));
        notice("Đã tự lưu thông tin sinh viên và cập nhật dữ liệu nén.", "success");
      }
      catch (error) { notice("Không thể tự lưu: " + error.message, "error"); }
    };
    select("#facultyStudentRows").onclick = async (event) => {
      const button = event.target.closest("[data-remove-faculty-student]"); if (!button) return;
      const approved = await confirmAction({ title: "Xóa sinh viên?", message: `Xóa MSSV ${button.dataset.removeFacultyStudent} khỏi danh sách SV khoa?` });
      if (approved) {
        const mssv = button.dataset.removeFacultyStudent;
        await deleteDoc(doc(db, "facultyStudents", mssv));
        await updateFacultyDatasetAfterWrite((rows) => rows.filter((item) => item.mssv !== mssv));
        notice("Đã xóa sinh viên và cập nhật dữ liệu nén.", "success");
      }
    };
    select("#facultyStudentExpiredNotice").onclick = () => select("#facultyStudentExpiredPanel").classList.toggle("hidden");
    select("#facultyStudentExpiredRows").onclick = async (event) => {
      const button = event.target.closest("[data-remove-expired-student]"); if (!button) return;
      if (!(await confirmAction({ title: "Xóa sinh viên hết hạn?", message: `Xóa MSSV ${button.dataset.removeExpiredStudent} khỏi danh sách khoa?` }))) return;
      const mssv = button.dataset.removeExpiredStudent;
      await deleteDoc(doc(db, "facultyStudents", mssv));
      await updateFacultyDatasetAfterWrite((rows) => rows.filter((item) => item.mssv !== mssv));
      await loadExpiredFacultyStudents();
    };
    select("#facultyStudentExpiredDeleteAll").onclick = async () => {
      if (!expiredFacultyStudents.length || !(await confirmAction({ title: "Xóa toàn bộ sinh viên hết hạn?", message: `Xóa ${expiredFacultyStudents.length} sinh viên hết hạn khỏi danh sách khoa?` }))) return;
      for (let offset = 0; offset < expiredFacultyStudents.length; offset += 450) { const batch = writeBatch(db); expiredFacultyStudents.slice(offset, offset + 450).forEach((item) => batch.delete(doc(db, "facultyStudents", item.mssv))); await batch.commit(); }
      const expiredIds = new Set(expiredFacultyStudents.map((item) => item.mssv));
      await updateFacultyDatasetAfterWrite((rows) => rows.filter((item) => !expiredIds.has(item.mssv)));
      await loadExpiredFacultyStudents(); await loadFacultyStudentMeta(); notice("Đã xóa danh sách sinh viên hết hạn.", "success");
    };
  }

  return {
    bindStudentControls,
    getFacultyStudentDatasetMeta: () => facultyStudentDatasetMeta,
    getFacultyStudents: () => facultyStudents,
    loadFacultyStudentMeta,
    normalizeSearch,
    resolveFacultyStudent,
    studentRecord,
    validStudentId
  };
}
