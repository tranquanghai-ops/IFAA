import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_ATTACHMENT_MAX_BYTES,
  attachmentExtension,
  formatAttachmentSize,
  normalizeEventAttachments,
  validateEventAttachmentFile
} from "../event-attachments.mjs";

test("chấp nhận các định dạng tài liệu được hỗ trợ và chuẩn hóa MIME bị bỏ trống", () => {
  const cases = [
    ["guide.pdf", "application/pdf"],
    ["guide.doc", "application/msword"],
    ["guide.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["table.xls", "application/vnd.ms-excel"],
    ["table.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["slides.ppt", "application/vnd.ms-powerpoint"],
    ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["bundle.zip", "application/zip"]
  ];
  for (const [name, type] of cases) {
    assert.deepEqual(validateEventAttachmentFile({ name, type, size: 1024 }), {
      extension: attachmentExtension(name), contentType: type, size: 1024
    });
  }
  assert.equal(validateEventAttachmentFile({ name: "GUIDE.PDF", type: "", size: 1 }).contentType, "application/pdf");
});

test("từ chối extension, MIME, file trống và file lớn hơn 20 MB", () => {
  assert.throws(() => validateEventAttachmentFile({ name: "script.html", type: "text/html", size: 10 }), /Chỉ hỗ trợ/);
  assert.throws(() => validateEventAttachmentFile({ name: "fake.pdf", type: "text/html", size: 10 }), /không hợp lệ/);
  assert.throws(() => validateEventAttachmentFile({ name: "empty.pdf", type: "application/pdf", size: 0 }), /File trống/);
  assert.throws(() => validateEventAttachmentFile({ name: "large.pdf", type: "application/pdf", size: EVENT_ATTACHMENT_MAX_BYTES + 1 }), /20 MB/);
});

test("event cũ không có attachments vẫn tương thích", () => {
  assert.deepEqual(normalizeEventAttachments({ id: "OLD" }), []);
  assert.deepEqual(normalizeEventAttachments({ id: "OLD", attachments: null }), []);
});

test("chỉ nhận metadata thuộc đúng namespace của event và loại bản ghi trùng hoặc nguy hiểm", () => {
  const valid = {
    id: "abcdefghijklmnop",
    name: "Tài liệu.pdf",
    storagePath: "event-attachments/E/abcdefghijklmnop.pdf",
    size: 2048,
    contentType: "application/pdf",
    uploadedAt: "2026-09-15T00:00:00.000Z"
  };
  const result = normalizeEventAttachments({
    id: "E",
    attachments: [
      valid,
      { ...valid },
      { ...valid, id: "otherattachment1", storagePath: "event-attachments/OTHER/otherattachment1.pdf" },
      { ...valid, id: "traversalfile01", storagePath: "event-attachments/E/../traversalfile01.pdf" },
      { ...valid, id: "htmlattachment01", storagePath: "event-attachments/E/htmlattachment01.html" },
      { ...valid, id: "../../badidentifier", storagePath: "event-attachments/E/badidentifier.pdf" }
    ]
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].storagePath, valid.storagePath);
});

test("định dạng kích thước file dễ đọc", () => {
  assert.equal(formatAttachmentSize(512), "512 B");
  assert.equal(formatAttachmentSize(1536), "1.5 KB");
  assert.equal(formatAttachmentSize(2 * 1024 * 1024), "2.0 MB");
});
