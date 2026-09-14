import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-firestore.js";

export function createAdminGroupService({ db, select, safe, toMillis, getGroups, setGroups, getEvents, getUser, getIsOwner, getIsSubAdmin, shareCode, configuredPublicBaseUrl, copyText, notice, confirmAction, trashRetentionMs, getEventState, getCalendarRange, getCalendarStamp, getPermanentlyDeleteEvent, deleteCachedExport, getFetchRegistrations, getDownloadRegistrationExcel, onRender, onGroupsUpdated }) {
  function groupCode(group) {
    return shareCode(group?.shareCode || group?.name) || group?.id || "NHOM";
  }

  function groupPosition(group) {
    const position = Number(group.sortOrder);
    return Number.isFinite(position) ? position : -(toMillis(group.createdAt) || 0);
  }

  function groupShareUrl(group) {
    const url = configuredPublicBaseUrl();
    url.searchParams.set("e", groupCode(group));
    return url.toString();
  }

  function refreshGroupOptions(selected = "") {
    const target = select("#groupId");
    target.innerHTML = '<option value="">Không nhóm</option>' + getGroups().filter((group) => !group.deletedAt).map((group) => `<option value="${group.id}">${safe(group.name)} — ${group.unlimited ? "không giới hạn" : `tối đa ${group.maxRegistrations}`}</option>`).join("") + '<option value="__new__">＋ Tạo nhóm mới</option>';
    target.value = selected || "";
  }

  function setLimitInputState(checkbox, input, help) {
    input.disabled = checkbox.checked;
    input.required = !checkbox.checked;
    if (help) help.textContent = checkbox.checked ? "Đã tắt giới hạn lượt đăng ký cho nhóm này." : "Mặc định là 2, có thể thay đổi từ 1 đến 20.";
  }

  function openGroup(group = null) {
    select("#groupForm").reset();
    select("#groupEditId").value = group?.id || "";
    select("#groupDialogTitle").textContent = group ? "Chỉnh sửa nhóm sự kiện" : "Tạo nhóm sự kiện";
    select("#groupName").value = group?.name || "";
    select("#groupShareCode").value = group ? groupCode(group) : "";
    select("#groupMaxRegistrations").value = group?.maxRegistrations || 2;
    select("#groupUnlimited").checked = !!group?.unlimited;
    setLimitInputState(select("#groupUnlimited"), select("#groupMaxRegistrations"), select("#groupLimitHelp"));
    select("#groupLinkOnly").checked = !!group?.linkOnly;
    select("#groupBulkStatus").value = "";
    select("#groupFormError").classList.add("hidden");
    select("#groupDialog").showModal();
  }

  function renderGroups({ activeEvents, orderedGroups }) {
    const groups = getGroups();
    const trashedGroups = groups.filter((item) => item.deletedAt);
    select("#groupRows").innerHTML = orderedGroups.map((group, groupIndex) => {
      const groupedItems = activeEvents.filter((item) => item.groupId === group.id);
      const eventCount = groupedItems.length;
      const groupRegisteredCount = groupedItems.reduce((total, item) => total + Number(item.registeredCount || 0), 0);
      const visibility = group.linkOnly ? '<span class="tag upcoming">CHỈ QUA LINK</span>' : '<span class="tag open">TRANG CHUNG</span>';
      const limit = group.unlimited ? '<b>Không giới hạn</b>' : `Tối đa <b>${Number(group.maxRegistrations) || 1}</b>/sự kiện`;
      const hiddenCount = groupedItems.filter((item) => getEventState()(item) === "hidden").length;
      const endedCount = groupedItems.filter((item) => getEventState()(item) === "ended").length;
      const groupState = hiddenCount === eventCount && eventCount ? "Đã ẩn toàn bộ" : endedCount === eventCount && eventCount ? "Đã kết thúc" : "Theo từng sự kiện";
      return `<tr><td><b>${safe(group.name)}</b><br><small>Mã: ${safe(groupCode(group))}</small></td><td>${limit}</td><td>${eventCount}<br><small>${groupState}</small></td><td>${visibility}</td><td><div class="actions"><button class="btn btn-small btn-soft" data-copy-group-link="${group.id}">Sao chép liên kết</button><button class="btn btn-small btn-calendar" data-calendar-group="${group.id}">＋ Lịch cả nhóm</button><button class="btn btn-small btn-download-list" data-export-group="${group.id}" ${groupRegisteredCount ? "" : "disabled"}><span class="sheet-icon" aria-hidden="true">▦</span> Tải danh sách nhóm</button></div></td><td><div class="actions"><button class="btn btn-small" data-move-group="${group.id}" data-direction="-1" ${groupIndex <= 0 ? "disabled" : ""}>↑</button><button class="btn btn-small" data-move-group="${group.id}" data-direction="1" ${groupIndex >= orderedGroups.length - 1 ? "disabled" : ""}>↓</button><button class="btn btn-small" data-edit-group="${group.id}">Sửa nhóm</button><button class="btn btn-small btn-danger" data-delete-group="${group.id}">Xóa nhóm</button></div></td></tr>`;
    }).join("") || '<tr><td colspan="6" class="empty">Chưa có nhóm sự kiện.</td></tr>';
    if (select("#trashGroupRows")) {
      select("#trashGroupRows").innerHTML = getIsOwner() && trashedGroups.length
        ? trashedGroups.slice().sort((a, b) => (toMillis(b.deletedAt) || 0) - (toMillis(a.deletedAt) || 0)).map((item) => {
            const deletedTime = toMillis(item.deletedAt), purgeTime = deletedTime ? deletedTime + trashRetentionMs : 0;
            const itemCount = getEvents().filter((event) => event.deletedWithGroupId === item.id).length;
            return `<tr><td><b>${safe(item.name)}</b><br><small>Mã: ${safe(groupCode(item))}</small></td><td>${itemCount}</td><td>${deletedTime ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(deletedTime)) : "—"}<br><small>${safe(item.deletedByEmail || "")}</small></td><td><b>${purgeTime ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(purgeTime)) : "—"}</b></td><td><div class="actions"><button class="btn btn-small btn-restore" data-restore-group="${item.id}">↶ Khôi phục nhóm</button><button class="btn btn-small btn-danger" data-purge-group="${item.id}">Xóa vĩnh viễn</button></div></td></tr>`;
          }).join("")
        : '<tr><td colspan="5" class="empty">Không có nhóm trong thùng rác.</td></tr>';
    }
  }

  function subscribeGroups() {
    const user = getUser();
    const groupsQuery = getIsSubAdmin()
      ? query(collection(db, "eventGroups"), where("createdByUid", "==", user.uid))
      : query(collection(db, "eventGroups"), orderBy("createdAt", "desc"));
    return onSnapshot(groupsQuery, (snapshot) => {
      setGroups(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (toMillis(b.createdAt) || 0) - (toMillis(a.createdAt) || 0)));
      refreshGroupOptions(select("#groupId").value);
      onRender();
      onGroupsUpdated();
    }, (error) => notice(error.message, "error"));
  }

  async function permanentlyDeleteGroup(selected) {
    if (!selected || !getIsOwner()) throw Error("Chỉ Chủ sở hữu được xóa vĩnh viễn.");
    const groupedTrashEvents = getEvents().filter((item) => item.deletedWithGroupId === selected.id && item.deletedAt);
    for (const groupedEvent of groupedTrashEvents) await getPermanentlyDeleteEvent()(groupedEvent);
    await deleteCachedExport(`exports/registrations/group-${selected.id}.xlsx`);
    await deleteDoc(doc(db, "eventGroups", selected.id));
  }

  async function moveGroup(groupId, direction) {
    const ordered = getGroups().filter((item) => !item.deletedAt).slice().sort((a, b) => groupPosition(a) - groupPosition(b));
    const from = ordered.findIndex((item) => item.id === groupId), to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    const selected = ordered[from], target = ordered[to];
    try {
      await Promise.all([
        updateDoc(doc(db, "eventGroups", selected.id), { sortOrder: groupPosition(target), updatedAt: serverTimestamp() }),
        updateDoc(doc(db, "eventGroups", target.id), { sortOrder: groupPosition(selected), updatedAt: serverTimestamp() })
      ]);
      notice("Đã cập nhật vị trí nhóm sự kiện.", "success");
    } catch (error) { notice(error.message || "Không thể thay đổi vị trí nhóm.", "error"); }
  }

  async function saveGroup(event) {
    event.preventDefault();
    const submit = event.submitter || event.target.querySelector('button[type="submit"],button:not([type])');
    const error = select("#groupFormError");
    submit.disabled = true; submit.textContent = "Đang lưu…"; error.classList.add("hidden");
    try {
      const id = select("#groupEditId").value, name = select("#groupName").value.trim(), code = shareCode(select("#groupShareCode").value || name);
      const unlimited = select("#groupUnlimited").checked, maxRegistrations = Number(select("#groupMaxRegistrations").value), bulkStatus = select("#groupBulkStatus").value;
      if (!name || (!unlimited && (!Number.isInteger(maxRegistrations) || maxRegistrations < 1 || maxRegistrations > 20))) throw Error("Vui lòng nhập tên nhóm và giới hạn từ 1 đến 20.");
      if (!code) throw Error("Mã liên kết nhóm không hợp lệ.");
      const groups = getGroups(), events = getEvents();
      if (groups.some((item) => item.id !== id && groupCode(item) === code)) throw Error(`Mã liên kết ${code} đã được một nhóm khác sử dụng.`);
      if (id && !unlimited) {
        const groupRegistrations = await getFetchRegistrations()("groupId", id), countsByUser = new Map();
        groupRegistrations.forEach((item) => countsByUser.set(item.uid || item.email, (countsByUser.get(item.uid || item.email) || 0) + 1));
        const highestCurrentCount = Math.max(0, ...countsByUser.values());
        if (maxRegistrations < highestCurrentCount) throw Error(`Không thể giảm giới hạn xuống ${maxRegistrations}; hiện có người đã đăng ký ${highestCurrentCount} sự kiện trong nhóm.`);
      }
      const groupedEvents = id ? events.filter((item) => item.groupId === id) : [];
      const statusNames = { closed: "kết thúc", hidden: "ẩn", open: "hiển thị lại" };
      if (bulkStatus && groupedEvents.length && !(await confirmAction({ title: "Cập nhật cả nhóm?", message: `Áp dụng trạng thái “${statusNames[bulkStatus]}” cho toàn bộ ${groupedEvents.length} sự kiện trong nhóm này?` }))) throw Error("Đã hủy thay đổi trạng thái nhóm.");
      const effectiveMax = unlimited ? (Number.isInteger(maxRegistrations) && maxRegistrations >= 1 ? maxRegistrations : 2) : maxRegistrations;
      const data = { name, shareCode: code, maxRegistrations: effectiveMax, unlimited, linkOnly: select("#groupLinkOnly").checked, updatedAt: serverTimestamp() };
      if (id) {
        await updateDoc(doc(db, "eventGroups", id), data);
        await Promise.all(groupedEvents.map((item) => updateDoc(doc(db, "events", item.id), { groupName: name, groupMaxRegistrations: effectiveMax, ...(bulkStatus ? { status: bulkStatus } : {}), updatedAt: serverTimestamp() })));
      } else {
        const groupPositions = groups.map(groupPosition).filter(Number.isFinite), sortOrder = groupPositions.length ? Math.min(...groupPositions) - 1 : 0;
        const user = getUser();
        await addDoc(collection(db, "eventGroups"), { ...data, sortOrder, createdByUid: user.uid, createdByEmail: user.email.toLowerCase(), createdAt: serverTimestamp() });
      }
      select("#groupDialog").close();
      notice(bulkStatus && groupedEvents.length ? `Đã cập nhật nhóm và ${statusNames[bulkStatus]} ${groupedEvents.length} sự kiện.` : id ? "Đã cập nhật nhóm sự kiện." : "Đã tạo nhóm sự kiện.", "success");
    } catch (saveError) { error.textContent = saveError.message || "Không thể lưu nhóm sự kiện."; error.classList.remove("hidden"); }
    finally { submit.disabled = false; submit.textContent = "Lưu nhóm"; }
  }

  function downloadGroupCalendar(groupId) {
    const group = getGroups().find((item) => item.id === groupId);
    const calendarRange = getCalendarRange(), calendarStamp = getCalendarStamp();
    const groupEvents = getEvents().filter((item) => item.groupId === groupId && calendarRange(item)).sort((a, b) => `${a.date}T${a.startTime || ""}`.localeCompare(`${b.date}T${b.startTime || ""}`));
    if (!group || !groupEvents.length) return notice("Nhóm này chưa có sự kiện hợp lệ để thêm vào lịch.", "error");
    const escapeIcs = (value) => String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const blocks = groupEvents.map((item) => { const range = calendarRange(item); const starts = range.allDay ? `DTSTART;VALUE=DATE:${calendarStamp(range.start, true)}` : `DTSTART;TZID=Asia/Ho_Chi_Minh:${calendarStamp(range.start)}`; const ends = range.allDay ? `DTEND;VALUE=DATE:${calendarStamp(range.end, true)}` : `DTEND;TZID=Asia/Ho_Chi_Minh:${calendarStamp(range.end)}`; return ["BEGIN:VEVENT", `UID:${escapeIcs(item.id)}@ifaa`, `DTSTAMP:${stamp}`, starts, ends, `SUMMARY:${escapeIcs(item.title)}`, `LOCATION:${escapeIcs(item.location)}`, `DESCRIPTION:${escapeIcs(item.description || "Sự kiện IFA+A")}`, "END:VEVENT"].join("\r\n"); });
    const calendar = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IFAA//Event Registration//VI", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...blocks, "END:VCALENDAR", ""].join("\r\n");
    const href = URL.createObjectURL(new Blob(["\uFEFF", calendar], { type: "text/calendar;charset=utf-8" })), anchor = document.createElement("a");
    anchor.href = href; anchor.download = `IFAA_${shareCode(group.name) || "NHOM-SU-KIEN"}.ics`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(href), 1500);
    notice(`Đã tạo tệp lịch gồm ${groupEvents.length} sự kiện. Mở tệp để nhập một lần vào Google Calendar.`, "success");
  }

  async function handleGroupClick(button) {
    if (button.dataset.moveGroup) { await moveGroup(button.dataset.moveGroup, Number(button.dataset.direction)); return true; }
    if (button.id === "newGroupBtn") { openGroup(); return true; }
    if (button.dataset.closeGroup !== undefined) { select("#groupDialog").close(); return true; }
    if (button.dataset.editGroup) { openGroup(getGroups().find((item) => item.id === button.dataset.editGroup)); return true; }
    if (button.dataset.exportGroup) { await getDownloadRegistrationExcel()("", button.dataset.exportGroup, button); return true; }
    if (button.dataset.calendarGroup) { downloadGroupCalendar(button.dataset.calendarGroup); return true; }
    if (button.dataset.copyGroupLink) { const selected = getGroups().find((item) => item.id === button.dataset.copyGroupLink); await copyText(groupShareUrl(selected || { id: button.dataset.copyGroupLink }), "Đã sao chép liên kết riêng của nhóm."); return true; }
    if (button.dataset.deleteGroup) {
      const selected = getGroups().find((item) => item.id === button.dataset.deleteGroup && !item.deletedAt); if (!selected) return true;
      const groupedEvents = getEvents().filter((item) => item.groupId === selected.id && !item.deletedAt);
      if (!(await confirmAction({ title: "Chuyển nhóm vào thùng rác?", message: groupedEvents.length ? `Nhóm “${selected.name}” và ${groupedEvents.length} sự kiện bên trong sẽ được chuyển vào thùng rác.` : `Bạn có chắc muốn chuyển nhóm “${selected.name}” vào thùng rác?`, verification: "XÓA" }))) return true;
      button.disabled = true; button.textContent = "Đang chuyển…";
      try { const user = getUser(); await updateDoc(doc(db, "eventGroups", selected.id), { deletedAt: serverTimestamp(), deletedByUid: user.uid, deletedByEmail: user.email, updatedAt: serverTimestamp() }); await Promise.all(groupedEvents.map((item) => updateDoc(doc(db, "events", item.id), { deletedAt: serverTimestamp(), deletedByUid: user.uid, deletedByEmail: user.email, deletedPreviousStatus: item.status || "open", deletedWithGroupId: selected.id, updatedAt: serverTimestamp() }))); notice("Đã chuyển nhóm sự kiện vào thùng rác.", "success"); } catch (error) { button.disabled = false; button.textContent = "Xóa nhóm"; notice(error.message || "Không thể chuyển nhóm vào thùng rác.", "error"); }
      return true;
    }
    if (button.dataset.restoreGroup) {
      if (!getIsOwner()) { notice("Chỉ Chủ sở hữu được khôi phục nhóm.", "error"); return true; }
      const selected = getGroups().find((item) => item.id === button.dataset.restoreGroup && item.deletedAt); if (!selected) return true;
      const groupedEvents = getEvents().filter((item) => item.deletedWithGroupId === selected.id && item.deletedAt); button.disabled = true;
      try { const user = getUser(); await updateDoc(doc(db, "eventGroups", selected.id), { deletedAt: null, deletedByUid: "", deletedByEmail: "", restoredAt: serverTimestamp(), restoredByEmail: user.email, updatedAt: serverTimestamp() }); await Promise.all(groupedEvents.map((item) => updateDoc(doc(db, "events", item.id), { deletedAt: null, deletedByUid: "", deletedByEmail: "", deletedWithGroupId: "", status: item.deletedPreviousStatus || item.status || "open", restoredAt: serverTimestamp(), restoredByEmail: user.email, updatedAt: serverTimestamp() }))); notice(`Đã khôi phục nhóm “${selected.name}” và ${groupedEvents.length} sự kiện.`, "success"); } catch (error) { button.disabled = false; notice(error.message || "Không thể khôi phục nhóm.", "error"); }
      return true;
    }
    if (button.dataset.purgeGroup) {
      if (!getIsOwner()) { notice("Chỉ Chủ sở hữu được xóa vĩnh viễn.", "error"); return true; }
      const selected = getGroups().find((item) => item.id === button.dataset.purgeGroup && item.deletedAt); if (!selected) return true;
      if (!(await confirmAction({ title: "Xóa vĩnh viễn nhóm?", message: `Nhóm “${selected.name}”, các sự kiện và lượt đăng ký liên quan sẽ bị xóa vĩnh viễn.`, verification: "XÓA" }))) return true;
      button.disabled = true; try { await permanentlyDeleteGroup(selected); notice("Đã xóa vĩnh viễn nhóm sự kiện.", "success"); } catch (error) { button.disabled = false; notice(error.message || "Không thể xóa vĩnh viễn nhóm.", "error"); }
      return true;
    }
    return false;
  }

  function bindGroupControls() {
    select("#groupUnlimited").onchange = () => setLimitInputState(select("#groupUnlimited"), select("#groupMaxRegistrations"), select("#groupLimitHelp"));
    select("#groupForm").onsubmit = saveGroup;
  }

  return { bindGroupControls, groupCode, groupPosition, handleGroupClick, openGroup, permanentlyDeleteGroup, refreshGroupOptions, renderGroups, setLimitInputState, subscribeGroups };
}
