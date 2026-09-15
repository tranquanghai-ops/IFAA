import { collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, Timestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";
import { REGISTRATION_QUESTION_TYPES, normalizeRegistrationFormItems, normalizeRegistrationProfileFields, validateRegistrationConfig } from "../../../registration-form.mjs";

export function createAdminEventService({ db, select, safe, toMillis, formatTimestamp, formatVietnamDate, parseVietnamDate, getEvents, setEvents, getGroups, getAttendanceSessions, getUser, getIsOwner, getIsSubAdmin, defaultFaculty, externalCategories, trashRetentionMs, shareCode, groupCode, groupPosition, configuredPublicBaseUrl, confirmAction, notice, copyText, refreshGroupOptions, setLimitInputState, renderEventFaculties, fetchRegistrations, removeRegistration, deleteCachedExport, onRender }) {
  let statusFilter = "all";
  let eventView = localStorage.getItem("ifaa-admin-event-view") === "list" ? "list" : "cards";
  let registrationFormItems = [];

  const registrationItemId = (kind) => `${kind}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;

  function readRegistrationBuilder() {
    document.querySelectorAll("[data-registration-item]").forEach((card) => {
      const item = registrationFormItems.find((entry) => entry.id === card.dataset.registrationItem);
      if (!item) return;
      if (item.kind === "content") {
        item.title = card.querySelector('[data-item-field="title"]').value;
        item.content = card.querySelector('[data-item-field="content"]').value;
        item.linkUrl = card.querySelector('[data-item-field="linkUrl"]').value;
        item.linkLabel = card.querySelector('[data-item-field="linkLabel"]').value;
      } else {
        item.label = card.querySelector('[data-item-field="label"]').value;
        item.type = card.querySelector('[data-item-field="type"]').value;
        item.required = card.querySelector('[data-item-field="required"]').checked;
        item.options = card.querySelector('[data-item-field="options"]').value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      }
    });
    return registrationFormItems;
  }

  function renderRegistrationBuilder() {
    const target = select("#registrationFormItems");
    target.innerHTML = registrationFormItems.map((item, index) => {
      const tools = `<div class="registration-item-tools"><button type="button" class="btn btn-small" data-registration-action="up" ${index ? "" : "disabled"}>↑</button><button type="button" class="btn btn-small" data-registration-action="down" ${index < registrationFormItems.length - 1 ? "" : "disabled"}>↓</button>${item.kind === "question" ? '<button type="button" class="btn btn-small" data-registration-action="duplicate">Nhân bản</button>' : ""}<button type="button" class="btn btn-small btn-danger" data-registration-action="delete">Xóa</button></div>`;
      if (item.kind === "content") return `<article class="registration-builder-item content-builder-item" data-registration-item="${safe(item.id)}"><div class="registration-item-head"><b>Khối nội dung</b>${tools}</div><div class="form-grid"><div class="field span-2"><label>Tiêu đề</label><input data-item-field="title" maxlength="200" value="${safe(item.title)}"></div><div class="field span-2"><label>Nội dung</label><textarea data-item-field="content" maxlength="10000">${safe(item.content)}</textarea></div><div class="field"><label>Liên kết HTTPS</label><input data-item-field="linkUrl" type="url" value="${safe(item.linkUrl)}"></div><div class="field"><label>Nhãn liên kết</label><input data-item-field="linkLabel" maxlength="160" value="${safe(item.linkLabel)}"></div></div></article>`;
      const typeOptions = Object.entries(REGISTRATION_QUESTION_TYPES).map(([value, label]) => `<option value="${value}" ${item.type === value ? "selected" : ""}>${label}</option>`).join("");
      const optionClass = ["single_choice", "multiple_choice", "dropdown"].includes(item.type) ? "" : "hidden";
      return `<article class="registration-builder-item" data-registration-item="${safe(item.id)}"><div class="registration-item-head"><b>Câu hỏi ${index + 1}</b>${tools}</div><div class="form-grid"><div class="field span-2"><label>Nội dung câu hỏi</label><input data-item-field="label" maxlength="500" value="${safe(item.label)}" required></div><div class="field"><label>Loại câu hỏi</label><select data-item-field="type">${typeOptions}</select></div><label class="check event-option"><input data-item-field="required" type="checkbox" ${item.required ? "checked" : ""}> Bắt buộc</label><div class="field span-2 ${optionClass}" data-options-field><label>Các lựa chọn — mỗi dòng một mục</label><textarea data-item-field="options">${safe((item.options || []).join("\n"))}</textarea></div></div></article>`;
    }).join("") || '<p class="empty registration-builder-empty">Chưa có câu hỏi hoặc nội dung bổ sung.</p>';
  }

  function registrationPreviewHtml(profileFields, items) {
    const fields = [];
    if (profileFields.personalEmail.enabled) fields.push(`<div class="field registration-question"><label>Email cá nhân${profileFields.personalEmail.required ? ' <span class="required-mark">*</span>' : ""}</label><input type="email" placeholder="name@example.com" disabled></div>`);
    if (profileFields.phone.enabled) fields.push(`<div class="field registration-question"><label>Số điện thoại${profileFields.phone.required ? ' <span class="required-mark">*</span>' : ""}</label><input type="tel" placeholder="Số điện thoại" disabled></div>`);
    for (const item of items) {
      if (item.kind === "content") {
        fields.push(`<section class="registration-content-block"><h3>${safe(item.title)}</h3><p>${safe(item.content).replace(/\n/g, "<br>")}</p>${item.linkUrl ? `<a href="${safe(item.linkUrl)}" target="_blank" rel="noopener noreferrer">${safe(item.linkLabel || "Xem liên kết")}</a>` : ""}</section>`);
        continue;
      }
      const label = `${safe(item.label)}${item.required ? " *" : ""}`;
      if (item.type === "long_text") fields.push(`<div class="field registration-question"><label>${label}</label><textarea disabled></textarea></div>`);
      else if (["single_choice", "multiple_choice", "boolean"].includes(item.type)) {
        const values = item.type === "boolean" ? ["Có", "Không"] : item.options;
        fields.push(`<fieldset class="registration-question registration-choice"><legend>${label}</legend><div class="registration-options">${values.map((value) => `<label><input type="${item.type === "multiple_choice" ? "checkbox" : "radio"}" disabled> ${safe(value)}</label>`).join("")}</div></fieldset>`);
      } else if (item.type === "dropdown") fields.push(`<div class="field registration-question"><label>${label}</label><select disabled><option>— Chọn —</option>${item.options.map((value) => `<option>${safe(value)}</option>`).join("")}</select></div>`);
      else fields.push(`<div class="field registration-question"><label>${label}</label><input type="${item.type === "number" ? "number" : item.type === "date" ? "date" : "text"}" disabled></div>`);
    }
    return `<div class="registration-preview-profile"><b>Thông tin hệ thống</b><p>Họ tên · MSSV · Email trường · Ngành/Lớp được tự động điền.</p></div><div class="registration-form-fields">${fields.join("") || '<p class="empty">Sự kiện này giữ cơ chế đăng ký nhanh.</p>'}</div>`;
  }

  function bindRegistrationFormControls() {
    const syncProfileToggle = (enabledSelector, requiredSelector) => {
      const enabled = select(enabledSelector), required = select(requiredSelector);
      required.disabled = !enabled.checked;
      if (!enabled.checked) required.checked = false;
    };
    select("#requirePersonalEmail").onchange = () => syncProfileToggle("#requirePersonalEmail", "#personalEmailRequired");
    select("#requirePhone").onchange = () => syncProfileToggle("#requirePhone", "#phoneRequired");
    select("#addRegistrationQuestion").onclick = () => { readRegistrationBuilder(); registrationFormItems.push({ id: registrationItemId("question"), kind: "question", type: "short_text", label: "", required: false, options: [], order: registrationFormItems.length + 1 }); renderRegistrationBuilder(); };
    select("#addRegistrationContent").onclick = () => { readRegistrationBuilder(); registrationFormItems.push({ id: registrationItemId("content"), kind: "content", title: "", content: "", linkUrl: "", linkLabel: "", order: registrationFormItems.length + 1 }); renderRegistrationBuilder(); };
    select("#registrationFormItems").onchange = (event) => {
      if (event.target.dataset.itemField === "type") { readRegistrationBuilder(); renderRegistrationBuilder(); }
    };
    select("#registrationFormItems").onclick = (event) => {
      const button = event.target.closest("[data-registration-action]");
      if (!button) return;
      readRegistrationBuilder();
      const card = button.closest("[data-registration-item]");
      const index = registrationFormItems.findIndex((item) => item.id === card.dataset.registrationItem);
      if (index < 0) return;
      if (button.dataset.registrationAction === "delete") registrationFormItems.splice(index, 1);
      if (button.dataset.registrationAction === "up" && index > 0) [registrationFormItems[index - 1], registrationFormItems[index]] = [registrationFormItems[index], registrationFormItems[index - 1]];
      if (button.dataset.registrationAction === "down" && index < registrationFormItems.length - 1) [registrationFormItems[index + 1], registrationFormItems[index]] = [registrationFormItems[index], registrationFormItems[index + 1]];
      if (button.dataset.registrationAction === "duplicate") registrationFormItems.splice(index + 1, 0, { ...registrationFormItems[index], id: registrationItemId("question"), options: [...registrationFormItems[index].options] });
      renderRegistrationBuilder();
    };
    select("#previewRegistrationForm").onclick = () => {
      try {
        const config = validateRegistrationConfig({ personalEmail: { enabled: select("#requirePersonalEmail").checked, required: select("#personalEmailRequired").checked }, phone: { enabled: select("#requirePhone").checked, required: select("#phoneRequired").checked } }, readRegistrationBuilder());
        select("#registrationPreviewBody").innerHTML = registrationPreviewHtml(config.profileFields, config.items);
        select("#registrationPreviewDialog").showModal();
      } catch (error) { notice(error.message, "error"); }
    };
    document.querySelectorAll("[data-close-registration-preview]").forEach((button) => button.onclick = () => select("#registrationPreviewDialog").close());
  }

  function eventEnd(event) {
    const date = new Date(`${event.date}T${event.endTime || event.startTime || "23:59"}:00`);
    return Number.isNaN(date.getTime()) ? Infinity : date.getTime();
  }

  function eventPastAttendanceGrace(event) {
    const end = eventEnd(event);
    return Number.isFinite(end) && Date.now() > end + 24 * 60 * 60 * 1000;
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
      return formatVietnamDate(event.date);
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
    const openAt = toMillis(event.openAt);
    const closeAt = toMillis(event.closeAt);
    if (now > eventEnd(event)) return "Sự kiện đã kết thúc";
    if (event.status === "hidden" || event.status === "draft") return "Sự kiện đang được ẩn";
    if (openAt && now < openAt) return `Mở đăng ký lúc ${formatTimestamp(event.openAt)} · Còn ${countdown(openAt)}`;
    if (event.status === "closed" || (closeAt && now > closeAt)) return closeAt ? `Đã đóng đăng ký lúc ${formatTimestamp(event.closeAt)}` : "Đăng ký đã được Admin đóng";
    if (!closeAt) return "Đang mở đăng ký · Admin sẽ đóng đăng ký";
    return `Đóng đăng ký lúc ${formatTimestamp(event.closeAt)} · Còn ${countdown(closeAt)}`;
  }

  function isExternalEvent(event) {
    return event.externalRegistration === true || externalCategories.has(event.category);
  }

  function eventIsFull(event) {
    return !isExternalEvent(event) && !event.unlimitedCapacity && Number(event.capacity || 0) > 0 && Number(event.registeredCount || 0) >= Number(event.capacity || 0);
  }

  function isNewEvent(event) {
    const created = toMillis(event.createdAt);
    return event.showAsNew !== false && !!created && Date.now() - created >= 0 && Date.now() - created < 86400000;
  }

  function eventPosition(event) {
    const position = Number(event.sortOrder);
    return Number.isFinite(position) ? position : -(toMillis(event.createdAt) || 0);
  }

  function eventState(event) {
    if (event.status === "hidden" || event.status === "draft") return "hidden";
    const now = Date.now();
    if (event.status === "closed" || now > eventEnd(event) || now > (toMillis(event.closeAt) ?? Infinity)) return "ended";
    if (now < (toMillis(event.openAt) ?? 0)) return "upcoming";
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

  function createUniqueEventCode(length = 7) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const used = new Set([
      ...getEvents().map((item) => shareCode(item.shareCode)),
      ...getGroups().map((item) => groupCode(item))
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

  function renderEvents() {
    const events = getEvents();
    const groups = getGroups();
    const attendanceSessions = getAttendanceSessions();
    const user = getUser();
    const activeEvents = events.filter((item) => !item.deletedAt);
    const trashedEvents = events.filter((item) => item.deletedAt);
    const activeGroups = groups.filter((item) => !item.deletedAt);
    const counts = activeEvents.reduce((result, item) => {
      result[eventState(item)] += 1;
      return result;
    }, { upcoming: 0, open: 0, ended: 0, hidden: 0 });
    select("#metricEvents").textContent = activeEvents.length;
    select("#metricUpcoming").textContent = counts.upcoming;
    select("#metricOpen").textContent = counts.open;
    select("#metricEnded").textContent = counts.ended;
    select("#metricHidden").textContent = counts.hidden;
    select("#metricRegs").textContent = activeEvents.reduce((total, item) => total + Number(item.registeredCount || 0), 0);

    const filteredEvents = (statusFilter === "all" ? activeEvents.filter((event) => eventState(event) !== "hidden") : activeEvents.filter((event) => eventState(event) === statusFilter))
      .slice().sort((a, b) => Number(isExternalEvent(a)) - Number(isExternalEvent(b)) || eventPosition(a) - eventPosition(b));
    const orderedGroups = activeGroups.slice().sort((a, b) => groupPosition(a) - groupPosition(b));
    select("#eventRows").className = `admin-event-groups view-${eventView}`;
    document.querySelectorAll("[data-event-view]").forEach((button) => button.classList.toggle("active", button.dataset.eventView === eventView));
    const groupedAdminEvents = new Map();
    filteredEvents.forEach((event) => {
      const key = event.groupId || "__ungrouped__";
      if (!groupedAdminEvents.has(key)) groupedAdminEvents.set(key, []);
      groupedAdminEvents.get(key).push(event);
    });
    const adminEventCard = (event) => {
      const canManage = !getIsSubAdmin() || event.createdByUid === user.uid;
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
        <div class="event-actions admin-card-actions"><button class="btn" data-edit="${event.id}" ${canManage ? "" : "disabled"}>Sửa</button><button class="btn btn-soft" data-copy-event="${event.id}">Sao chép</button><button class="btn btn-soft" data-quick-registrations="${event.id}" ${hasRegistrations ? "" : "disabled"}>Xem danh sách</button><button class="btn btn-download-list" data-export-event="${event.id}" ${hasRegistrations ? "" : "disabled"}><span class="sheet-icon" aria-hidden="true">▦</span> Tải danh sách</button>${!isExternalEvent(event) ? `<button class="btn btn-calendar" data-attendance-event="${event.id}" ${eventPastAttendanceGrace(event) && !attendanceSessions.some((item) => item.eventId === event.id && !item.deletedAt) ? "disabled" : ""}>${eventPastAttendanceGrace(event) ? "Sự kiện đã kết thúc" : attendanceSessions.some((item) => item.eventId === event.id && !item.deletedAt) ? "Quản lý điểm danh" : "＋ Điểm danh sự kiện"}</button>` : ""}<button class="btn btn-danger" data-delete="${event.id}" ${canManage ? "" : "disabled"}>Xóa</button></div>
      </article>`;
    };
    let adminTone = 0;
    select("#eventRows").innerHTML = filteredEvents.length ? [...groupedAdminEvents.entries()].sort(([a], [b]) => {
      if (a === "__ungrouped__") return 1;
      if (b === "__ungrouped__") return -1;
      return groupPosition(groups.find((item) => item.id === a) || {}) - groupPosition(groups.find((item) => item.id === b) || {});
    }).map(([groupId, items]) => {
      const eventGroup = groups.find((item) => item.id === groupId);
      const title = groupId === "__ungrouped__" ? "Sự kiện không thuộc nhóm" : (eventGroup?.name || items[0]?.groupName || "Nhóm sự kiện");
      const limitText = groupId === "__ungrouped__" ? "" : eventGroup?.unlimited ? "" : `Tối đa ${eventGroup?.maxRegistrations || items[0]?.groupMaxRegistrations || 1}/sự kiện`;
      const toneClass = groupId === "__ungrouped__" ? "admin-group-ungrouped" : `group-tone-${adminTone++ % 5}`;
      const groupIndex = orderedGroups.findIndex((item) => item.id === groupId);
      const groupRegistrationCount = activeEvents.filter((item) => item.groupId === groupId).reduce((total, item) => total + Number(item.registeredCount || 0), 0);
      const groupMove = groupId === "__ungrouped__" ? `<b>${items.length} sự kiện</b>` : `<div class="admin-group-move"><b>${items.length} sự kiện · ${groupRegistrationCount} lượt đăng ký</b><button class="btn btn-small btn-download-list" data-export-group="${groupId}" ${groupRegistrationCount ? "" : "disabled"}><span class="sheet-icon" aria-hidden="true">▦</span> Tải danh sách nhóm</button>${eventGroup?.shareCode ? `<button class="btn btn-small btn-copy-link" data-copy-group-link="${groupId}">🔗 Sao chép link nhóm</button>` : ""}<button class="btn btn-small" data-move-group="${groupId}" data-direction="-1" ${groupIndex <= 0 ? "disabled" : ""}>↑ Lên</button><button class="btn btn-small" data-move-group="${groupId}" data-direction="1" ${groupIndex < 0 || groupIndex >= orderedGroups.length - 1 ? "disabled" : ""}>↓ Xuống</button></div>`;
      return `<section class="admin-event-group ${toneClass}"><div class="admin-event-group-head"><div><span>${groupId === "__ungrouped__" ? "SỰ KIỆN RIÊNG" : "NHÓM SỰ KIỆN"}</span><h3>${safe(title)}</h3>${limitText ? `<small>${safe(limitText)}</small>` : ""}</div>${groupMove}</div><div class="event-grid admin-event-grid">${items.map((item) => adminEventCard(item)).join("")}</div></section>`;
    }).join("") : '<div class="card empty">Không có sự kiện ở trạng thái này.</div>';

    if (select("#trashRows")) {
      select("#trashRows").innerHTML = getIsOwner() && trashedEvents.length
        ? trashedEvents.slice().sort((a, b) => (toMillis(b.deletedAt) || 0) - (toMillis(a.deletedAt) || 0)).map((item) => {
            const deletedTime = toMillis(item.deletedAt);
            const purgeTime = deletedTime ? deletedTime + trashRetentionMs : 0;
            return `<tr><td><b>${safe(item.title)}</b><br><small>${safe(item.groupName || "Không thuộc nhóm")}</small></td><td>${safe(formatVietnamDate(item.date) || "—")}</td><td>${deletedTime ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(deletedTime)) : "—"}<br><small>${safe(item.deletedByEmail || "")}</small></td><td><b>${purgeTime ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(purgeTime)) : "—"}</b></td><td>${Number(item.registeredCount || 0)}</td><td><div class="actions"><button class="btn btn-small btn-restore" data-restore-event="${item.id}">↶ Khôi phục</button><button class="btn btn-small btn-danger" data-purge-event="${item.id}">Xóa vĩnh viễn</button></div></td></tr>`;
          }).join("")
        : '<tr><td colspan="6" class="empty">Thùng rác đang trống.</td></tr>';
    }
    return { activeEvents, orderedGroups };
  }

  function updateEventCountdowns() {
    let stateChanged = false;
    document.querySelectorAll("[data-admin-timing]").forEach((node) => {
      const event = getEvents().find((item) => item.id === node.dataset.adminTiming);
      if (!event) return;
      const nextState = eventState(event);
      if (node.dataset.adminState !== nextState) stateChanged = true;
      else node.textContent = adminTimingStatus(event);
    });
    if (stateChanged) onRender();
  }

  function subscribeEvents(onLoaded) {
    const user = getUser();
    const eventsQuery = getIsSubAdmin()
      ? query(collection(db, "events"), where("createdByUid", "==", user.uid))
      : query(collection(db, "events"), orderBy("createdAt", "desc"));
    return onSnapshot(eventsQuery, (snapshot) => {
      setEvents(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      onRender();
      onLoaded?.();
    }, (error) => notice(error.message, "error"));
  }

  function inputDateTimeParts(value) {
    if (!value) return { date: "", time: "" };
    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return { date: "", time: "" };
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    const text = local.toISOString();
    return { date: text.slice(0, 10), time: text.slice(11, 16) };
  }

  const validTime24 = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const dateTimeValue = (date, time) => date && validTime24(time) ? new Date(`${date}T${time}:00`) : null;

  function openEvent(event = null, copy = false) {
    select("#eventForm").reset();
    delete select("#saveEventBtn").dataset.immediateOpenBase;
    select("#saveEventBtn").textContent = "Lưu sự kiện";
    select("#descriptionEditor").innerHTML = event?.descriptionHtml || (event?.description ? `<p>${safe(event.description).replace(/\n/g, "<br>")}</p>` : "");
    select("#eventFormError").classList.add("hidden");
    select("#eventId").value = copy ? "" : (event?.id || "");
    select("#eventDialogTitle").textContent = copy ? "Sao chép sự kiện" : event ? "Chỉnh sửa sự kiện" : "Tạo sự kiện";
    for (const key of ["title", "category", "location", "startTime", "endTime", "capacity", "status"]) if (event && select("#" + key)) select("#" + key).value = event[key] ?? "";
    select("#date").value = event ? formatVietnamDate(event.date) : "";
    if (!select("#category").value) select("#category").value = "Sự kiện Khoa";
    if (event?.status === "draft") select("#status").value = "hidden";
    if (event) {
      const opens = inputDateTimeParts(event.openAt);
      const closes = inputDateTimeParts(event.closeAt);
      select("#openDate").value = formatVietnamDate(opens.date);
      select("#openTime").value = opens.time;
      select("#closeDate").value = formatVietnamDate(closes.date);
      select("#closeTime").value = closes.time;
    } else {
      select("#status").value = "open";
      select("#category").value = "Sự kiện Khoa";
    }
    select("#eventAllowCancellation").checked = !!event?.allowCancellation;
    select("#eventHot").checked = !!event?.isHot;
    select("#eventShowAsNew").checked = copy ? true : event ? event.showAsNew !== false : true;
    select("#eventCreateShareLink").checked = copy ? false : !!event?.shareCode;
    select("#eventCreateShareLink").dataset.locked = !copy && !!event?.shareCode ? "true" : "";
    select("#eventHideFromPublic").checked = copy ? false : !!event?.linkOnly;
    select("#eventShareLinkHelp").textContent = !copy && event?.shareCode ? `Mã liên kết hiện tại: ${shareCode(event.shareCode)}` : "Có thể tạo ngay hoặc tạo sau tại trang quản lý sự kiện.";
    select("#unlimitedCapacity").checked = !!event?.unlimitedCapacity;
    select("#hideRegistrationCount").checked = !!event?.hideRegistrationCount;
    if (event?.unlimitedCapacity) select("#capacity").value = "";
    select("#registrationUrl").value = event?.registrationUrl || "";
    const storedCloseMode = event?.closeMode === "endOfDay" ? "beforeEvent" : (event?.closeMode || (event ? "manual" : "after24"));
    const closeMode = copy ? (event ? storedCloseMode : "manual") : storedCloseMode;
    const closeModeInput = document.querySelector(`input[name="closeMode"][value="${closeMode}"]`) || document.querySelector('input[name="closeMode"][value="after24"]');
    if (closeModeInput) closeModeInput.checked = true;
    toggleExternalEventFields();
    setCapacityState();
    setCloseModeState();
    syncEventVisibilityOptions();
    refreshGroupOptions(event?.groupId || "");
    select("#groupId").disabled = !copy && !!event && (event.registeredCount || 0) > 0;
    select("#newGroupFields").classList.add("hidden");
    select("#newGroupMax").value = 2;
    select("#newGroupUnlimited").checked = false;
    setLimitInputState(select("#newGroupUnlimited"), select("#newGroupMax"));
    renderEventFaculties(event?.allowedFaculties?.length ? event.allowedFaculties : [defaultFaculty]);
    const profileFields = normalizeRegistrationProfileFields(event?.registrationProfileFields);
    select("#requirePersonalEmail").checked = profileFields.personalEmail.enabled;
    select("#personalEmailRequired").checked = profileFields.personalEmail.required;
    select("#personalEmailRequired").disabled = !profileFields.personalEmail.enabled;
    select("#requirePhone").checked = profileFields.phone.enabled;
    select("#phoneRequired").checked = profileFields.phone.required;
    select("#phoneRequired").disabled = !profileFields.phone.enabled;
    registrationFormItems = normalizeRegistrationFormItems(event?.registrationFormItems || event?.registrationQuestions || []);
    if (copy) registrationFormItems = registrationFormItems.map((item) => ({ ...item, id: registrationItemId(item.kind), options: [...(item.options || [])] }));
    renderRegistrationBuilder();
    const canApplyToGroup = !copy && !!event?.id && !!event?.groupId;
    select("#applyGroupFieldsOption").classList.toggle("hidden", !canApplyToGroup);
    document.querySelectorAll(".group-sync-field").forEach((input) => { input.checked = false; });
    select("#eventDialog").showModal();
  }

  function toggleExternalEventFields() {
    const external = externalCategories.has(select("#category").value);
    select("#externalRegistrationField").classList.toggle("hidden", !external);
    select("#registrationUrl").required = external;
    setCapacityState();
  }

  function setCapacityState() {
    const external = externalCategories.has(select("#category").value);
    const unlimited = select("#unlimitedCapacity").checked;
    select("#capacity").disabled = external || unlimited;
    select("#capacity").required = !external && !unlimited;
    if (!external && !unlimited && !Number(select("#capacity").value)) select("#capacity").value = 50;
    select("#capacityHelp").textContent = external ? "Sự kiện này đăng ký ở trang bên ngoài." : unlimited ? "Đã tắt giới hạn số người đăng ký." : "Nhập số người tối đa được đăng ký.";
  }

  function selectedCloseMode() {
    return document.querySelector('input[name="closeMode"]:checked')?.value || "after24";
  }

  function setCloseModeState() {
    const mode = selectedCloseMode();
    const manual = mode === "manual";
    select("#closeRegistrationFields").classList.toggle("hidden", !manual);
    select("#closeDate").disabled = !manual;
    select("#closeTime").disabled = !manual;
    select("#closeDate").required = manual;
    select("#closeTime").required = manual;
    const help = {
      after12: "Hệ thống sẽ đóng đăng ký sau 12 giờ tính từ lúc mở.",
      after24: "Hệ thống sẽ đóng đăng ký sau 24 giờ tính từ lúc mở.",
      beforeEvent: "Hệ thống sẽ đóng đăng ký ngay trước giờ bắt đầu sự kiện.",
      admin: "Đăng ký tiếp tục mở cho đến khi Admin chuyển trạng thái sang kết thúc.",
      manual: "Nhập chính xác ngày và giờ đóng đăng ký."
    };
    select("#closeModeHelp").textContent = help[mode] || help.after24;
  }

  function syncEventVisibilityOptions() {
    const hidden = select("#eventHideFromPublic").checked;
    if (hidden) select("#eventCreateShareLink").checked = true;
    select("#eventCreateShareLink").disabled = hidden || select("#eventCreateShareLink").dataset.locked === "true";
  }

  async function prepareEventData(id, submit) {
    const data = {};
    for (const key of ["title", "category", "location", "startTime", "endTime", "status"]) data[key] = select("#" + key).value.trim();
    data.date = parseVietnamDate(select("#date").value);
    data.descriptionHtml = select("#descriptionEditor").innerHTML.trim();
    data.description = select("#descriptionEditor").innerText.trim();
    const existingEvent = id ? getEvents().find((item) => item.id === id) : null;
    data.linkOnly = select("#eventHideFromPublic").checked;
    data.shareCode = existingEvent?.shareCode || (select("#eventCreateShareLink").checked || data.linkOnly ? createUniqueEventCode() : "");
    const openDateText = parseVietnamDate(select("#openDate").value);
    const openTimeText = select("#openTime").value.trim();
    const closeDateText = parseVietnamDate(select("#closeDate").value);
    const closeTimeText = select("#closeTime").value.trim();
    data.openAt = null;
    data.closeAt = null;
    data.closeMode = selectedCloseMode();
    data.autoCloseRegistration = false;
    data.externalRegistration = externalCategories.has(data.category);
    data.registrationUrl = select("#registrationUrl").value.trim();
    data.unlimitedCapacity = !data.externalRegistration && select("#unlimitedCapacity").checked;
    data.hideRegistrationCount = select("#hideRegistrationCount").checked;
    data.capacity = data.externalRegistration ? 1 : data.unlimitedCapacity ? 1000000000 : Number(select("#capacity").value);
    data.allowedFaculties = [...document.querySelectorAll(".event-faculty:checked")].map((input) => input.value);
    data.allowCancellation = select("#eventAllowCancellation").checked;
    data.isHot = select("#eventHot").checked;
    data.showAsNew = select("#eventShowAsNew").checked;
    const registrationConfig = validateRegistrationConfig({
      personalEmail: { enabled: select("#requirePersonalEmail").checked, required: select("#personalEmailRequired").checked },
      phone: { enabled: select("#requirePhone").checked, required: select("#phoneRequired").checked }
    }, readRegistrationBuilder());
    data.registrationProfileFields = registrationConfig.profileFields;
    data.registrationFormItems = registrationConfig.items;
    data.updatedAt = serverTimestamp();
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
    const eventEndValue = new Date(`${data.date}T${data.endTime || data.startTime || "23:59"}:00`).getTime();
    const now = Date.now();
    if (!Number.isFinite(eventStart) || !Number.isFinite(eventEndValue)) throw Error("Ngày hoặc giờ sự kiện không hợp lệ.");
    const immediateOpenBase = data.openAt?.toMillis() ?? (Number(submit.dataset.immediateOpenBase) || Date.now());
    if (!data.openAt) submit.dataset.immediateOpenBase = String(immediateOpenBase);
    if (data.closeMode === "after12") data.closeAt = Timestamp.fromMillis(immediateOpenBase + 12 * 60 * 60 * 1000);
    else if (data.closeMode === "after24") data.closeAt = Timestamp.fromMillis(immediateOpenBase + 24 * 60 * 60 * 1000);
    else if (data.closeMode === "beforeEvent") data.closeAt = Timestamp.fromDate(new Date(`${data.date}T${data.startTime || "00:00"}:00`));
    else if (data.closeMode === "manual") data.closeAt = Timestamp.fromDate(manualCloseValue);
    else data.closeAt = null;
    const warnings = [];
    if (data.endTime && !data.startTime) warnings.push("Đã nhập giờ kết thúc nhưng chưa nhập giờ bắt đầu; sự kiện vẫn được lưu là sự kiện cả ngày.");
    if (data.startTime && data.endTime && eventEndValue <= eventStart) warnings.push("Giờ kết thúc sự kiện đang trước hoặc bằng giờ bắt đầu.");
    if (!id && eventStart <= now) warnings.push("Ngày và giờ bắt đầu sự kiện đã ở trong quá khứ.");
    if (data.openAt && data.closeAt && data.openAt.toMillis() >= data.closeAt.toMillis()) warnings.push("Thời gian đóng đăng ký đang trước hoặc bằng thời gian mở đăng ký.");
    if (!id && data.closeAt && data.closeAt.toMillis() <= now) warnings.push("Thời gian đóng đăng ký đã ở trong quá khứ.");
    if (data.closeAt && data.closeAt.toMillis() > eventStart) warnings.push("Thời gian đóng đăng ký đang sau giờ bắt đầu sự kiện.");
    if (warnings.length && !(await confirmAction({ title: "Cảnh báo ngày giờ chưa hợp lý", message: warnings.map((message) => `• ${message}`).join("\n"), confirmLabel: "Vẫn lưu sự kiện" }))) return null;
    if (!data.allowedFaculties.length) throw Error("Vui lòng chọn ít nhất một khoa/đơn vị.");
    if (new Blob([JSON.stringify(data)]).size > 900000) throw Error("Nội dung mô tả hoặc hình ảnh quá lớn. Vui lòng giảm kích thước hình.");
    return data;
  }

  async function moveEvent(eventId, direction) {
    const events = getEvents();
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

  async function createEventLink(selectedEvent, button) {
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

  async function trashEvent(selected, button) {
    if (!selected) return;
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
      const user = getUser();
      await updateDoc(doc(db, "events", selected.id), {
        deletedAt: serverTimestamp(), deletedByUid: user.uid, deletedByEmail: user.email,
        deletedPreviousStatus: selected.status || "open", updatedAt: serverTimestamp()
      });
      notice("Đã chuyển sự kiện vào thùng rác. Danh sách đăng ký vẫn được giữ nguyên.", "success");
    } catch (error) {
      button.disabled = false;
      button.textContent = "Xóa";
      notice(`Không thể chuyển sự kiện vào thùng rác: ${error.message}`, "error");
    }
  }

  async function restoreEvent(selected, button) {
    if (!getIsOwner()) return notice("Chỉ Chủ sở hữu được khôi phục sự kiện.", "error");
    if (!selected) return;
    button.disabled = true;
    try {
      await updateDoc(doc(db, "events", selected.id), {
        deletedAt: null, deletedByUid: "", deletedByEmail: "", restoredAt: serverTimestamp(),
        restoredByEmail: getUser().email, status: selected.deletedPreviousStatus || selected.status || "open", updatedAt: serverTimestamp()
      });
      notice(`Đã khôi phục sự kiện “${selected.title}”.`, "success");
    } catch (error) {
      button.disabled = false;
      notice(error.message || "Không thể khôi phục sự kiện.", "error");
    }
  }

  async function permanentlyDeleteEvent(selected) {
    if (!selected || !getIsOwner()) throw Error("Chỉ Chủ sở hữu được xóa vĩnh viễn.");
    const registrations = await fetchRegistrations("eventId", selected.id);
    for (const registration of registrations) await removeRegistration(registration);
    await deleteCachedExport(`exports/registrations/event-${selected.id}.xlsx`);
    await deleteDoc(doc(db, "events", selected.id));
  }

  async function purgeEvent(selected, button) {
    if (!getIsOwner()) return notice("Chỉ Chủ sở hữu được xóa vĩnh viễn.", "error");
    if (!selected) return;
    const approved = await confirmAction({ title: "Xóa vĩnh viễn?", message: `Sự kiện “${selected.title}” và toàn bộ lượt đăng ký liên quan sẽ bị xóa vĩnh viễn.`, verification: "XÓA" });
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

  function setStatusFilter(value) {
    statusFilter = value;
  }

  function setEventView(value) {
    eventView = value === "list" ? "list" : "cards";
    localStorage.setItem("ifaa-admin-event-view", eventView);
  }

  return {
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
    setStatusFilter,
    subscribeEvents,
    syncEventVisibilityOptions,
    toggleExternalEventFields,
    trashEvent,
    updateEventCountdowns
  };
}
