import { deleteObject, getBlob, listAll, ref, uploadBytesResumable } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";
import { EVENT_ATTACHMENT_MAX_BYTES, formatAttachmentSize, normalizeEventAttachments, validateEventAttachmentFile } from "../../../event-attachments.mjs";

export function createEventAttachmentService({ storage, select, safe, notice }) {
  let eventId = "";
  let existing = [];
  let pending = [];
  const removed = new Map();

  const itemId = () => crypto.randomUUID().replace(/-/g, "");

  function render() {
    const rows = [
      ...existing.filter((item) => !removed.has(item.id)).map((item) => `<article class="attachment-row"><div><b>📄 ${safe(item.name)}</b><small>${formatAttachmentSize(item.size)}</small></div><div class="attachment-actions"><button type="button" class="btn btn-small" data-attachment-download="${safe(item.id)}">Tải xuống</button><button type="button" class="btn btn-small btn-danger" data-attachment-remove="${safe(item.id)}">Xóa</button></div></article>`),
      ...[...removed.values()].map((item) => `<article class="attachment-row attachment-removed"><div><b>📄 ${safe(item.name)}</b><small>Sẽ xóa khi lưu sự kiện</small></div><button type="button" class="btn btn-small" data-attachment-restore="${safe(item.id)}">Hoàn tác</button></article>`),
      ...pending.map((item) => `<article class="attachment-row"><div><b>📄 ${safe(item.file.name)}</b><small>${item.error ? safe(item.error) : item.uploading ? `Đang tải lên ${item.progress}%` : `${formatAttachmentSize(item.file.size)} · Chờ lưu sự kiện`}</small>${item.uploading ? `<progress max="100" value="${item.progress}"></progress>` : ""}</div><button type="button" class="btn btn-small btn-danger" data-attachment-pending-remove="${safe(item.id)}" ${item.uploading ? "disabled" : ""}>Bỏ</button></article>`)
    ];
    select("#eventAttachmentList").innerHTML = rows.join("") || '<p class="empty attachment-empty">Chưa có tài liệu đính kèm.</p>';
    select("#eventAttachmentCount").textContent = `${existing.length - removed.size + pending.length}/40 file`;
  }

  function openEvent(event = null) {
    eventId = event?.id || "";
    existing = normalizeEventAttachments(event || {});
    pending = [];
    removed.clear();
    select("#eventAttachmentInput").value = "";
    render();
  }

  function addFiles(files) {
    const errors = [];
    for (const file of files) {
      try {
        validateEventAttachmentFile(file);
        if (existing.length - removed.size + pending.length >= 40) throw Error("Mỗi sự kiện hỗ trợ tối đa 40 tài liệu.");
        pending.push({ id: itemId(), file, uploading: false, progress: 0, error: "" });
      } catch (error) { errors.push(`${file?.name || "File"}: ${error.message}`); }
    }
    render();
    if (errors.length) notice(errors.join("\n"), "error");
  }

  async function downloadAttachment(item) {
    try {
      const blob = await getBlob(ref(storage, item.storagePath), EVENT_ATTACHMENT_MAX_BYTES + 1);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = item.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { notice(error.message || "Không thể tải tài liệu.", "error"); }
  }

  function uploadOne(targetEventId, item) {
    const validated = validateEventAttachmentFile(item.file);
    const storagePath = `event-attachments/${targetEventId}/${item.id}.${validated.extension}`;
    item.uploading = true;
    item.progress = 0;
    item.error = "";
    render();
    return new Promise((resolve, reject) => {
      const task = uploadBytesResumable(ref(storage, storagePath), item.file, {
        contentType: validated.contentType,
        cacheControl: "private,max-age=0,no-store",
        customMetadata: { attachmentId: item.id }
      });
      task.on("state_changed", (snapshot) => {
        item.progress = Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100);
        render();
      }, (error) => {
        item.uploading = false;
        item.error = error.message || "Upload thất bại";
        render();
        reject(error);
      }, () => {
        item.uploading = false;
        item.progress = 100;
        render();
        resolve({
          id: item.id,
          name: item.file.name.slice(0, 300),
          storagePath,
          size: validated.size,
          contentType: validated.contentType,
          uploadedAt: new Date().toISOString()
        });
      });
    });
  }

  async function deletePaths(paths) {
    const failures = [];
    for (const path of paths) {
      try { await deleteObject(ref(storage, path)); }
      catch (error) { if (error?.code !== "storage/object-not-found") failures.push(error); }
    }
    if (failures.length) throw failures[0];
  }

  async function prepareSave(targetEventId) {
    const uploaded = [];
    try {
      for (const item of pending) uploaded.push(await uploadOne(targetEventId, item));
      return {
        attachments: [...existing.filter((item) => !removed.has(item.id)), ...uploaded],
        uploadedPaths: uploaded.map((item) => item.storagePath),
        removedPaths: [...removed.values()].map((item) => item.storagePath)
      };
    } catch (error) {
      await deletePaths(uploaded.map((item) => item.storagePath)).catch(() => {});
      throw Error(`Không thể tải tài liệu lên: ${error.message || error}`);
    }
  }

  async function rollbackSave(prepared) {
    await deletePaths(prepared?.uploadedPaths || []);
  }

  async function finalizeSave(prepared, targetEventId) {
    try { await deletePaths(prepared?.removedPaths || []); }
    catch (error) { notice(`Sự kiện đã lưu nhưng chưa dọn được một file cũ: ${error.message}`, "error"); }
    eventId = targetEventId;
    existing = prepared.attachments;
    pending = [];
    removed.clear();
    render();
  }

  async function cleanupEventAttachments(targetEventId) {
    const folder = await listAll(ref(storage, `event-attachments/${targetEventId}`));
    await deletePaths(folder.items.map((item) => item.fullPath));
  }

  function bindControls() {
    const input = select("#eventAttachmentInput");
    const dropZone = select("#eventAttachmentDropZone");
    input.onchange = () => { addFiles([...input.files]); input.value = ""; };
    dropZone.ondragover = (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); };
    dropZone.ondragleave = () => dropZone.classList.remove("is-dragging");
    dropZone.ondrop = (event) => { event.preventDefault(); dropZone.classList.remove("is-dragging"); addFiles([...event.dataTransfer.files]); };
    select("#eventAttachmentList").onclick = (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.attachmentPendingRemove) pending = pending.filter((item) => item.id !== button.dataset.attachmentPendingRemove);
      if (button.dataset.attachmentRemove) {
        const item = existing.find((value) => value.id === button.dataset.attachmentRemove);
        if (item) removed.set(item.id, item);
      }
      if (button.dataset.attachmentRestore) removed.delete(button.dataset.attachmentRestore);
      if (button.dataset.attachmentDownload) {
        const item = existing.find((value) => value.id === button.dataset.attachmentDownload);
        if (item) void downloadAttachment(item);
      }
      render();
    };
  }

  return { bindControls, cleanupEventAttachments, finalizeSave, openEvent, prepareSave, rollbackSave };
}
