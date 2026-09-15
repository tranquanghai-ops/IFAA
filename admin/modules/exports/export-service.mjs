import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { ref, getBytes, getMetadata, uploadBytes, deleteObject } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";
import { formatRegistrationAnswer, registrationConfig } from "../../../registration-form.mjs";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;

export function createAdminExportService({ db, storage, canUseStorageCache, getEvents, getGroups, getAttendanceSessions, fetchRegistrations, notice, formatTimestamp, toMillis, formatVietnamDate, dayPeriod, shareCode }) {
  function createWorkbookArtifact(filename, sheetName, rows, columns = []) {
    const sheet = XLSX.utils.json_to_sheet(rows);
    if (columns.length) sheet["!cols"] = columns;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, String(sheetName || "Danh sách").slice(0, 31));
    const output = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true });
    return { filename, bytes: output instanceof Uint8Array ? output : new Uint8Array(output) };
  }

  function downloadWorkbookBytes(filename, bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_CONTENT_TYPE }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadCachedWorkbook(path, version) {
    if (!canUseStorageCache()) return false;
    const fileRef = ref(storage, path);
    try {
      const metadata = await getMetadata(fileRef);
      if (metadata.customMetadata?.version !== version) return false;
      const bytes = await getBytes(fileRef, MAX_EXPORT_BYTES);
      downloadWorkbookBytes(metadata.customMetadata?.downloadName || path.split("/").pop(), bytes);
      return true;
    } catch (error) {
      if (error?.code === "storage/object-not-found") return false;
      throw error;
    }
  }

  async function saveAndDownloadCachedWorkbook(path, version, artifact) {
    if (artifact.bytes.byteLength >= MAX_EXPORT_BYTES) throw Error("File Excel vượt quá giới hạn 20 MB.");
    if (!canUseStorageCache()) {
      downloadWorkbookBytes(artifact.filename, artifact.bytes);
      return false;
    }
    await uploadBytes(ref(storage, path), artifact.bytes, {
      contentType: XLSX_CONTENT_TYPE,
      cacheControl: "private, no-store, max-age=0",
      customMetadata: { version, downloadName: artifact.filename }
    });
    downloadWorkbookBytes(artifact.filename, artifact.bytes);
    return true;
  }

  async function deleteCachedExport(path) {
    try { await deleteObject(ref(storage, path)); }
    catch (error) { if (error?.code !== "storage/object-not-found") console.warn("Không thể xóa file Excel cache:", error); }
  }

  function downloadWorkbook(filename, sheetName, rows) {
    const sheet = XLSX.utils.json_to_sheet(rows), workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    XLSX.writeFile(workbook, filename);
  }

  function writeRegistrationWorkbook(list, eventId = "", groupId = "") {
    const events = getEvents();
    const groups = getGroups();
    const selectedEvent = events.find((event) => event.id === eventId);
    const selectedGroup = groups.find((group) => group.id === groupId);
    const baseColumns = new Set(["STT", "MSSV/Mã số", "Họ tên", "Khoa/Đơn vị", "Đối tượng", "Email", "Sự kiện", "Ngày sự kiện", "Giờ bắt đầu", "Giờ kết thúc", "Buổi", "Thời gian đăng ký", "Nhóm sự kiện"]);
    const configuredEvents = selectedEvent ? [selectedEvent] : events.filter((event) => event.groupId === groupId);
    const includePersonalEmail = configuredEvents.some((event) => registrationConfig(event).profileFields.personalEmail.enabled) || list.some((registration) => registration.profileSnapshot?.personalEmail || registration.personalEmail);
    const includePhone = configuredEvents.some((event) => registrationConfig(event).profileFields.phone.enabled) || list.some((registration) => registration.profileSnapshot?.phone || registration.phone);
    const questionColumns = [];
    const questionColumnByKey = new Map();
    list.forEach((registration) => (registration.registrationFormSnapshot?.items || []).forEach((question) => {
      const key = `${registration.eventId || ""}:${question.id}:${question.label}`;
      if (questionColumnByKey.has(key)) return;
      let label = String(question.label || "Câu hỏi bổ sung").trim() || "Câu hỏi bổ sung";
      const used = new Set([...baseColumns, ...questionColumns.map((item) => item.column)]);
      if (used.has(label)) {
        let suffix = 2;
        while (used.has(`${label} (${suffix})`)) suffix += 1;
        label = `${label} (${suffix})`;
      }
      questionColumns.push({ key, eventId: registration.eventId || "", id: question.id, label: question.label, column: label });
      questionColumnByKey.set(key, label);
    }));
    const rows = list.map((registration, index) => {
      const registrationEvent = events.find((event) => event.id === registration.eventId);
      const row = { STT: index + 1, "MSSV/Mã số": registration.identifier || registration.mssv, "Họ tên": registration.name, "Khoa/Đơn vị": registration.faculty, "Đối tượng": registration.participantType || "Sinh viên", Email: registration.email, "Sự kiện": registrationEvent?.title || registration.eventTitle, "Ngày sự kiện": formatVietnamDate(registrationEvent?.date || registration.eventDate), "Giờ bắt đầu": registrationEvent?.startTime || "", "Giờ kết thúc": registrationEvent?.endTime || "", "Buổi": dayPeriod(registrationEvent?.startTime), "Thời gian đăng ký": formatTimestamp(registration.createdAt) };
      if (!groupId) row["Nhóm sự kiện"] = registration.groupName || "Không nhóm";
      if (includePersonalEmail) row["Email cá nhân"] = registration.profileSnapshot?.personalEmail || registration.personalEmail || "";
      if (includePhone) row["Số điện thoại"] = registration.profileSnapshot?.phone || registration.phone || "";
      (registration.registrationFormSnapshot?.items || []).forEach((question) => {
        const key = `${registration.eventId || ""}:${question.id}:${question.label}`;
        const column = questionColumnByKey.get(key);
        if (column) row[column] = formatRegistrationAnswer(registration.answers?.[question.id]);
      });
      return row;
    });
    const exportName = selectedEvent?.title || (selectedGroup ? `Nhom_${selectedGroup.name}` : "Danh_sach_dang_ky");
    const cleanName = exportName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70) || "Su_kien";
    return createWorkbookArtifact(
      `IFAA_${cleanName}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      (selectedEvent?.title || selectedGroup?.name || "Đăng ký").slice(0, 31),
      rows,
      [{ wch: 6 }, { wch: 15 }, { wch: 24 }, { wch: 28 }, { wch: 14 }, { wch: 32 }, { wch: 32 }, { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 20 }, { wch: 24 }]
    );
  }

  function timestampCachePart(value) {
    if (Number.isFinite(value?.seconds)) return `${value.seconds}-${Number(value.nanoseconds || 0)}`;
    return value ? String(toMillis(value) || value) : "0";
  }

  function shortCacheHash(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function registrationCacheInfo(eventId = "", groupId = "") {
    const events = getEvents();
    const groups = getGroups();
    if (eventId) {
      const item = events.find((event) => event.id === eventId) || {};
      const version = shortCacheHash(["registration-v2", eventId, item.registeredCount || 0, timestampCachePart(item.updatedAt), item.title || "", item.date || ""].join("|"));
      return { path: `exports/registrations/event-${eventId}.xlsx`, version };
    }
    const related = events.filter((event) => event.groupId === groupId).sort((a, b) => a.id.localeCompare(b.id));
    const selectedGroup = groups.find((group) => group.id === groupId) || {};
    const signature = related.map((event) => [event.id, event.registeredCount || 0, timestampCachePart(event.updatedAt), event.title || "", event.date || ""].join(":"));
    return { path: `exports/registrations/group-${groupId}.xlsx`, version: shortCacheHash(["registration-group-v2", groupId, timestampCachePart(selectedGroup.updatedAt), ...signature].join("|")) };
  }

  async function downloadRegistrationExcel(eventId = "", groupId = "", button = null) {
    const originalHtml = button?.innerHTML;
    if (button) {
      button.disabled = true;
      button.textContent = "Đang tải…";
    }
    try {
      const cache = registrationCacheInfo(eventId, groupId);
      const cached = await downloadCachedWorkbook(cache.path, cache.version);
      if (cached) {
        notice("Đã tải file Excel lưu sẵn từ Storage, không đọc lại danh sách Firestore.", "success");
        return;
      }
      const list = eventId ? await fetchRegistrations("eventId", eventId) : await fetchRegistrations("groupId", groupId);
      if (!list.length) {
        notice("Chưa có dữ liệu đăng ký để xuất.", "error");
        return;
      }
      const artifact = writeRegistrationWorkbook(list, eventId, groupId);
      const cachedForReuse = await saveAndDownloadCachedWorkbook(cache.path, cache.version, artifact);
      notice(cachedForReuse
        ? `Đã tạo và lưu file ${list.length} lượt đăng ký. Những lần tải tiếp theo không đọc lại Firestore.`
        : `Đã tạo và tải trực tiếp file ${list.length} lượt đăng ký.`, "success");
    } catch (error) {
      notice(error.message || "Không thể xuất dữ liệu.", "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = originalHtml;
      }
    }
  }

  function attendanceExportRows(rows) {
    return rows.filter((item) => item.mssv).map((item, index, filteredRows) => ({ STT: filteredRows.length - index, MSSV: item.mssv, "Họ và tên": item.name || "Không có dữ liệu", "Người quét": item.scannerName || item.scannerMssv || "", "Thời gian": formatTimestamp(item.checkedAt) }));
  }

  function attendanceCacheInfo(item) {
    const version = shortCacheHash(["attendance-v1", item.id, item.checkinCount || 0, item.pendingCount || 0, timestampCachePart(item.updatedAt), item.title || ""].join("|"));
    return { path: `exports/attendance/session-${item.id}.xlsx`, version };
  }

  async function quickExportAttendance(sessionId, button) {
    const item = getAttendanceSessions().find((value) => value.id === sessionId); if (!item) return;
    const oldText = button.textContent; button.disabled = true; button.textContent = "Đang tải…";
    try {
      const cache = attendanceCacheInfo(item);
      const cached = await downloadCachedWorkbook(cache.path, cache.version);
      if (cached) {
        notice("Đã tải file điểm danh lưu sẵn từ Storage, không đọc lại danh sách Firestore.", "success");
        return;
      }
      const snapshot = await getDocs(query(collection(db, "checkins"), where("sessionId", "==", sessionId)));
      const rows = snapshot.docs.map((entry) => entry.data()).filter((entry) => !entry.deletedAt && entry.mssv).sort((a, b) => (toMillis(b.checkedAt) || 0) - (toMillis(a.checkedAt) || 0));
      const artifact = createWorkbookArtifact(`DIEM_DANH_${shareCode(item.title)}.xlsx`, "Danh sach diem danh", attendanceExportRows(rows), [{ wch: 6 }, { wch: 15 }, { wch: 28 }, { wch: 28 }, { wch: 22 }]);
      const cachedForReuse = await saveAndDownloadCachedWorkbook(cache.path, cache.version, artifact);
      notice(cachedForReuse
        ? `Đã tạo và lưu file ${rows.length} lượt điểm danh. Những lần tải tiếp theo không đọc lại Firestore.`
        : `Đã tạo và tải trực tiếp file ${rows.length} lượt điểm danh.`, "success");
    } catch (error) { notice("Không thể tải danh sách: " + error.message, "error"); }
    finally { button.disabled = false; button.textContent = oldText; }
  }

  return { attendanceExportRows, deleteCachedExport, downloadRegistrationExcel, downloadWorkbook, quickExportAttendance };
}
