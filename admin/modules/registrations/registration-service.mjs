import { collection, doc, getDocs, limit, query, runTransaction, serverTimestamp, startAfter, where } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { formatRegistrationAnswer } from "../../../registration-form.mjs";

export function createAdminRegistrationService({ db, select, safe, formatTimestamp, toMillis, formatVietnamDate, getEvents, getGroups, eventState, eventPosition, groupPosition, isExternalEvent, notice, confirmAction }) {
  let registrations = [];
  let pageSize = 20;
  const statusFilters = new Set(["open", "ended"]);
  let pageIndex = 0;
  let pageCursors = [null];
  let hasNext = false;
  let loading = false;
  let loadedEventId = "";
  let requestId = 0;
  let quickEventId = "";
  let quickPageIndex = 0;
  let quickPageCursors = [null];
  let quickHasNext = false;
  let quickLoading = false;
  let quickRequestId = 0;
  let quickRows = [];

  function registrationStatusMatches(event) {
    const state = eventState(event);
    return (state === "open" && statusFilters.has("open"))
      || (state === "ended" && statusFilters.has("ended"))
      || (state === "hidden" && statusFilters.has("hidden"));
  }

  function refreshRegistrationFilters() {
    const groups = getGroups();
    const events = getEvents();
    const selectedGroup = select("#groupFilter").value;
    const selectedEvent = select("#eventFilter").value;
    select("#groupFilter").innerHTML = '<option value="">Tất cả nhóm sự kiện</option>' + groups.filter((group) => !group.deletedAt).slice().sort((a, b) => groupPosition(a) - groupPosition(b)).map((group) => `<option value="${group.id}">${safe(group.name)}</option>`).join("");
    if (groups.some((group) => group.id === selectedGroup)) select("#groupFilter").value = selectedGroup;
    const activeGroup = select("#groupFilter").value;
    const availableEvents = events.filter((event) => !event.deletedAt && !isExternalEvent(event) && registrationStatusMatches(event) && (!activeGroup || event.groupId === activeGroup)).slice().sort((a, b) => eventPosition(a) - eventPosition(b));
    select("#eventFilter").innerHTML = '<option value="">— Chọn sự kiện để tải danh sách —</option>' + availableEvents.map((event) => `<option value="${event.id}">${safe(event.title)} · ${safe(formatVietnamDate(event.date))}</option>`).join("");
    if (availableEvents.some((event) => event.id === selectedEvent)) select("#eventFilter").value = selectedEvent;
  }

  function filteredRegistrations() {
    return loadedEventId === select("#eventFilter").value ? registrations : [];
  }

  function resetRegistrationPage() {
    registrations = [];
    pageIndex = 0;
    pageCursors = [null];
    hasNext = false;
    loadedEventId = "";
  }

  async function fetchRegistrations(field, value) {
    if (!value) return [];
    const snapshot = await getDocs(query(collection(db, "registrations"), where(field, "==", value)));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (toMillis(b.createdAt) || 0) - (toMillis(a.createdAt) || 0));
  }

  async function loadRegistrationPage(direction = 0) {
    const eventId = select("#eventFilter").value;
    if (!eventId) {
      resetRegistrationPage();
      renderRegistrations();
      return;
    }
    let targetPage = direction === 0 ? 0 : pageIndex + direction;
    if (targetPage < 0 || (direction > 0 && !hasNext)) return;
    if (direction === 0) {
      pageCursors = [null];
      pageIndex = 0;
    }
    const cursor = pageCursors[targetPage];
    if (targetPage > 0 && !cursor) return;
    const activeRequestId = ++requestId;
    loading = true;
    renderRegistrations();
    try {
      const clauses = [where("eventId", "==", eventId)];
      if (cursor) clauses.push(startAfter(cursor));
      clauses.push(limit(pageSize + 1));
      const snapshot = await getDocs(query(collection(db, "registrations"), ...clauses));
      if (activeRequestId !== requestId || select("#eventFilter").value !== eventId) return;
      const visibleDocs = snapshot.docs.slice(0, pageSize);
      registrations = visibleDocs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (toMillis(b.createdAt) || 0) - (toMillis(a.createdAt) || 0));
      pageIndex = targetPage;
      hasNext = snapshot.docs.length > pageSize;
      loadedEventId = eventId;
      if (hasNext && visibleDocs.length) pageCursors[targetPage + 1] = visibleDocs[visibleDocs.length - 1];
    } catch (error) {
      if (activeRequestId === requestId) {
        resetRegistrationPage();
        notice(error.message || "Không thể tải danh sách đăng ký.", "error");
      }
    } finally {
      if (activeRequestId === requestId) {
        loading = false;
        renderRegistrations();
      }
    }
  }

  function renderRegistrations() {
    const eventId = select("#eventFilter").value;
    const list = filteredRegistrations();
    const selectedEvent = getEvents().find((item) => item.id === eventId);
    select("#resetEventBtn").disabled = !eventId || Number(selectedEvent?.registeredCount || 0) < 1;
    select("#exportBtn").disabled = !eventId && !select("#groupFilter").value;
    select("#registrationPagination").classList.toggle("hidden", !eventId || loading || (!list.length && !hasNext));
    select("#registrationPrev").disabled = pageIndex <= 0 || loading;
    select("#registrationNext").disabled = !hasNext || loading;
    select("#registrationPageText").textContent = `Trang ${pageIndex + 1}`;
    if (!eventId) {
      select("#registrationLoadHint").textContent = "Danh sách chưa được tải để tiết kiệm lượt đọc dữ liệu.";
      select("#regRows").innerHTML = '<tr><td colspan="8" class="empty">Vui lòng chọn một sự kiện để xem danh sách đăng ký.</td></tr>';
      return;
    }
    if (loading) {
      select("#registrationLoadHint").textContent = `Đang tải tối đa ${pageSize} lượt đăng ký…`;
      select("#regRows").innerHTML = '<tr><td colspan="8" class="empty">Đang tải danh sách đăng ký…</td></tr>';
      return;
    }
    select("#registrationLoadHint").textContent = list.length ? `Đang hiển thị ${list.length} người ở trang ${pageIndex + 1}.` : "Sự kiện này chưa có người đăng ký.";
    select("#regRows").innerHTML = list.map((registration, index) => `<tr><td class="col-stt">${pageIndex * pageSize + index + 1}</td><td class="col-identifier"><b>${safe(registration.identifier || registration.mssv)}</b></td><td>${safe(registration.name)}</td><td>${safe(registration.faculty)}</td><td>${safe(registration.participantType || "Sinh viên")}</td><td>${safe(registration.eventTitle)}</td><td>${formatTimestamp(registration.createdAt)}</td><td><div class="actions"><button class="btn btn-small" data-registration-detail="${registration.id}">Chi tiết</button><button class="btn btn-small btn-danger" data-delete-registration="${registration.id}">Xóa</button></div></td></tr>`).join("") || '<tr><td colspan="8" class="empty">Sự kiện này chưa có người đăng ký.</td></tr>';
  }

  function openRegistrationDetail(registration) {
    if (!registration) return;
    const snapshot = registration.profileSnapshot || {};
    const formSnapshot = registration.registrationFormSnapshot || {};
    const questions = Array.isArray(formSnapshot.items) ? formSnapshot.items : [];
    const answers = registration.answers || {};
    const answerRows = questions.map((question) => {
      const raw = answers[question.id];
      const value = formatRegistrationAnswer(raw);
      return `<div class="registration-detail-row"><b>${safe(question.label)}</b><p>${safe(value) || "—"}</p></div>`;
    }).join("");
    select("#registrationDetailSummary").textContent = `${registration.name || ""} · ${registration.identifier || registration.mssv || ""}`;
    select("#registrationDetailBody").innerHTML = `<div class="registration-detail-grid"><div><b>Email trường</b><span>${safe(snapshot.email || registration.email || "—")}</span></div><div><b>Email cá nhân</b><span>${safe(snapshot.personalEmail || registration.personalEmail || "—")}</span></div><div><b>Số điện thoại</b><span>${safe(snapshot.phone || registration.phone || "—")}</span></div><div><b>Ngành/Lớp</b><span>${safe([snapshot.major || registration.major, snapshot.studentClass].filter(Boolean).join(" · ") || "—")}</span></div></div>${answerRows ? `<section class="registration-answer-list"><h3>Câu trả lời bổ sung</h3>${answerRows}</section>` : '<p class="empty">Đăng ký này không có câu trả lời bổ sung.</p>'}`;
    select("#registrationDetailDialog").showModal();
  }

  function openRegistrationDetailById(id) {
    openRegistrationDetail(registrations.find((item) => item.id === id) || quickRows.find((item) => item.id === id));
  }

  function renderQuickRegistrations() {
    const selectedEvent = getEvents().find((item) => item.id === quickEventId);
    select("#quickRegistrationTitle").textContent = selectedEvent?.title || "Danh sách đăng ký";
    select("#quickRegistrationSummary").textContent = quickLoading ? "Đang tải danh sách…" : `Trang ${quickPageIndex + 1} · ${quickRows.length} người`;
    select("#quickRegistrationPrev").disabled = quickLoading || quickPageIndex <= 0;
    select("#quickRegistrationNext").disabled = quickLoading || !quickHasNext;
    select("#quickRegistrationPageText").textContent = `Trang ${quickPageIndex + 1}`;
    if (quickLoading) {
      select("#quickRegistrationRows").innerHTML = '<tr><td colspan="6" class="empty">Đang tải danh sách đăng ký…</td></tr>';
      return;
    }
    select("#quickRegistrationRows").innerHTML = quickRows.map((registration, index) => `<tr><td class="col-stt">${quickPageIndex * pageSize + index + 1}</td><td class="col-identifier"><b>${safe(registration.identifier || registration.mssv)}</b></td><td>${safe(registration.name)}</td><td>${safe(registration.faculty)}</td><td>${safe(registration.participantType || "Sinh viên")}</td><td>${formatTimestamp(registration.createdAt)}<br><button class="btn btn-small" data-registration-detail="${registration.id}">Chi tiết</button></td></tr>`).join("") || '<tr><td colspan="6" class="empty">Sự kiện này chưa có người đăng ký.</td></tr>';
  }

  async function loadQuickRegistrationPage(direction = 0) {
    const eventId = quickEventId;
    if (!eventId) return;
    let targetPage = direction === 0 ? 0 : quickPageIndex + direction;
    if (targetPage < 0 || (direction > 0 && !quickHasNext)) return;
    if (direction === 0) {
      quickPageCursors = [null];
      quickPageIndex = 0;
    }
    const cursor = quickPageCursors[targetPage];
    if (targetPage > 0 && !cursor) return;
    const activeRequestId = ++quickRequestId;
    quickLoading = true;
    renderQuickRegistrations();
    try {
      const clauses = [where("eventId", "==", eventId)];
      if (cursor) clauses.push(startAfter(cursor));
      clauses.push(limit(pageSize + 1));
      const snapshot = await getDocs(query(collection(db, "registrations"), ...clauses));
      if (activeRequestId !== quickRequestId || eventId !== quickEventId) return;
      const visibleDocs = snapshot.docs.slice(0, pageSize);
      quickRows = visibleDocs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (toMillis(b.createdAt) || 0) - (toMillis(a.createdAt) || 0));
      quickPageIndex = targetPage;
      quickHasNext = snapshot.docs.length > pageSize;
      if (quickHasNext && visibleDocs.length) quickPageCursors[targetPage + 1] = visibleDocs[visibleDocs.length - 1];
    } catch (error) {
      quickRows = [];
      quickHasNext = false;
      notice(error.message || "Không thể tải danh sách đăng ký.", "error");
    } finally {
      if (activeRequestId === quickRequestId) {
        quickLoading = false;
        renderQuickRegistrations();
      }
    }
  }

  async function openQuickRegistrations(eventId) {
    const selectedEvent = getEvents().find((item) => item.id === eventId);
    if (!selectedEvent || Number(selectedEvent.registeredCount || 0) < 1) return;
    quickEventId = eventId;
    quickPageIndex = 0;
    quickPageCursors = [null];
    quickHasNext = false;
    quickRows = [];
    select("#quickRegistrationDialog").showModal();
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
      if (eventSnapshot.exists()) transaction.update(eventRef, { registeredCount: Math.max(0, Number(eventSnapshot.data().registeredCount || 0) - 1), registrationMutationId: registration.id, updatedAt: serverTimestamp() });
      transaction.delete(registrationRef);
      if (limitRef && limitSnapshot?.exists()) {
        const registrationLimit = limitSnapshot.data();
        const eventIds = (registrationLimit.eventIds || []).filter((id) => id !== liveRegistration.eventId);
        transaction.update(limitRef, { count: eventIds.length, eventIds, updatedAt: serverTimestamp() });
      }
    });
  }

  function findLoadedRegistration(id) {
    return registrations.find((item) => item.id === id);
  }

  function syncStatusFilters(values) {
    statusFilters.clear();
    values.forEach((value) => statusFilters.add(value));
  }

  function setPageSize(value) {
    pageSize = Number(value) || 20;
  }

  async function resetSelectedEventRegistrations() {
    const eventId = select("#eventFilter").value;
    const selectedEvent = getEvents().find((item) => item.id === eventId);
    if (!selectedEvent) return;
    const button = select("#resetEventBtn");
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
      renderRegistrations();
    }
  }

  return {
    fetchRegistrations,
    findLoadedRegistration,
    loadQuickRegistrationPage,
    loadRegistrationPage,
    openQuickRegistrations,
    openRegistrationDetailById,
    refreshRegistrationFilters,
    removeRegistration,
    renderRegistrations,
    resetRegistrationPage,
    resetSelectedEventRegistrations,
    setPageSize,
    syncStatusFilters
  };
}
