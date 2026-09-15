export const EVENT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export const EVENT_ATTACHMENT_TYPES = Object.freeze({
  pdf: ["application/pdf"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  zip: ["application/zip", "application/x-zip-compressed"]
});

const cleanText = (value, max) => String(value ?? "").trim().slice(0, max);

export function attachmentExtension(filename) {
  const match = cleanText(filename, 500).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

export function validateEventAttachmentFile(file) {
  const extension = attachmentExtension(file?.name);
  if (!EVENT_ATTACHMENT_TYPES[extension]) throw Error("Chỉ hỗ trợ PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX hoặc ZIP.");
  const size = Number(file?.size || 0);
  if (!Number.isFinite(size) || size <= 0) throw Error("File trống hoặc không đọc được.");
  if (size > EVENT_ATTACHMENT_MAX_BYTES) throw Error("Mỗi tài liệu không được vượt quá 20 MB.");
  const contentType = cleanText(file?.type, 200).toLowerCase();
  if (contentType && !EVENT_ATTACHMENT_TYPES[extension].includes(contentType)) throw Error(`Loại nội dung của file .${extension} không hợp lệ.`);
  return { extension, contentType: contentType || EVENT_ATTACHMENT_TYPES[extension][0], size };
}

export function normalizeEventAttachments(event = {}) {
  const eventId = cleanText(event.id, 200);
  const prefix = `event-attachments/${eventId}/`;
  const ids = new Set();
  return (Array.isArray(event.attachments) ? event.attachments : []).slice(0, 40).map((value) => {
    const id = cleanText(value?.id, 100);
    const storagePath = cleanText(value?.storagePath, 500);
    const extension = attachmentExtension(storagePath);
    const size = Number(value?.size || 0);
    const contentType = cleanText(value?.contentType, 200).toLowerCase();
    if (!eventId || !/^[A-Za-z0-9_-]{16,100}$/.test(id) || ids.has(id) || !EVENT_ATTACHMENT_TYPES[extension]
      || storagePath !== `${prefix}${id}.${extension}`
      || (contentType && !EVENT_ATTACHMENT_TYPES[extension].includes(contentType))
      || !Number.isFinite(size) || size <= 0 || size > EVENT_ATTACHMENT_MAX_BYTES) return null;
    ids.add(id);
    return {
      id,
      name: cleanText(value?.name, 300) || `Tài liệu.${extension}`,
      storagePath,
      size,
      contentType: contentType || EVENT_ATTACHMENT_TYPES[extension][0],
      uploadedAt: cleanText(value?.uploadedAt, 50)
    };
  }).filter(Boolean);
}

export function formatAttachmentSize(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
