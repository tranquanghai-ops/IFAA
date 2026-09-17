import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adminHtml = readFileSync("admin/index.html", "utf8");
const studentModule = readFileSync("student.mjs", "utf8");
const adminEventModule = readFileSync("admin/modules/events/event-service.mjs", "utf8");
const styles = readFileSync("styles.css", "utf8");

test("form Admin có đúng thứ tự category, group, description và registration builder", () => {
  const category = adminHtml.indexOf('id="category"');
  const group = adminHtml.indexOf('id="groupId"');
  const description = adminHtml.indexOf('id="descriptionEditor"');
  const builder = adminHtml.indexOf('class="span-2 registration-builder-section"');
  const attachments = adminHtml.indexOf('class="span-2 event-attachment-section"');
  const eventDate = adminHtml.indexOf('id="date"');
  assert.ok(category >= 0 && category < group);
  assert.ok(group < description);
  assert.ok(description < builder);
  assert.ok(builder < attachments);
  assert.ok(attachments < eventDate);
  assert.equal(adminHtml.match(/id="groupId"/g)?.length, 1);
  assert.equal(adminHtml.match(/class="span-2 registration-builder-section"/g)?.length, 1);
});

test("modal registration dùng đúng chiều rộng dialog và chỉ cuộn trong nội dung", () => {
  assert.match(styles, /#registrationFormDialog,#registrationPreviewDialog\{[^}]*width:min\(760px,calc\(100vw - 24px\)\)[^}]*overflow:hidden/);
  assert.match(styles, /#registrationFormDialog \.registration-form-modal,#registrationPreviewDialog \.registration-preview-modal\{[^}]*width:100%[^}]*max-width:none[^}]*box-sizing:border-box/);
  assert.doesNotMatch(styles, /\.registration-form-modal,\.registration-preview-modal\{width:min\(760px,100%\)/);
});

test("trạng thái Form Builder rỗng gọn và khu vực tài liệu không tràn mobile", () => {
  assert.match(styles, /\.registration-builder-empty\{[^}]*margin:0[^}]*padding:10px 4px[^}]*text-align:left/);
  assert.match(adminHtml, /id="eventAttachmentInput"[^>]*accept="\.pdf,\.doc,\.docx,\.xls,\.xlsx,\.ppt,\.pptx,\.zip"[^>]*multiple/);
  assert.match(styles, /\.attachment-row>div:first-child\{[^}]*min-width:0/);
  assert.match(styles, /\.public-attachment-row\{[^}]*grid-template-columns:auto minmax\(0,1fr\) auto/);
});

test("radio và checkbox phía sinh viên giữ đúng semantics và label bao quanh control", () => {
  assert.match(studentModule, /<label><input type="radio"[^>]*> \$\{safe\(label\)\}<\/label>/);
  assert.match(studentModule, /<label><input type="checkbox"[^>]*> \$\{safe\(option\)\}<\/label>/);
  assert.match(studentModule, /class="field registration-question" data-registration-field="personalEmail"/);
  assert.match(studentModule, /class="field registration-question" data-registration-field="phone"/);
});

test("question card responsive không kéo control ra xa label", () => {
  assert.match(styles, /\.registration-question\{[^}]*min-width:0[^}]*border-left:4px solid var\(--brand\)/);
  assert.match(styles, /\.registration-options label[^}]*display:flex[^}]*justify-content:flex-start[^}]*gap:10px/);
  assert.match(styles, /\.registration-options input\[type="radio"\][^}]*width:19px!important[^}]*height:19px!important/);
  assert.match(styles, /\.registration-options input\[type="checkbox"\][^}]*width:19px!important[^}]*height:19px!important/);
  assert.match(styles, /\.registration-builder-section,\.event-attachment-section\{padding:13px\}/);
});

test("Preview dùng cùng card và option layout, không có thao tác ghi dữ liệu", () => {
  assert.match(adminEventModule, /class="field registration-question"/);
  assert.match(adminEventModule, /class="registration-question registration-choice"/);
  const previewStart = adminEventModule.indexOf("function registrationPreviewHtml");
  const previewEnd = adminEventModule.indexOf("function bindRegistrationFormControls", previewStart);
  const previewSource = adminEventModule.slice(previewStart, previewEnd);
  assert.doesNotMatch(previewSource, /setDoc|updateDoc|addDoc|runTransaction/);
});

test("Admin hoặc creator có thao tác xem nhanh và tải đăng ký ngay trên public", () => {
  const publicHtml = readFileSync("index.html", "utf8");
  assert.match(studentModule, /function canManagePublicRegistrations\(event\)/);
  assert.match(studentModule, /canManageResource\(adminAccess, event, user\.uid\)/);
  assert.match(studentModule, /data-public-registrations/);
  assert.match(studentModule, /data-public-export/);
  assert.match(studentModule, /where\("eventId", "==", eventId\)/);
  assert.match(studentModule, /XLSX\.writeFile/);
  assert.match(publicHtml, /id="publicRegistrationDialog"/);
  assert.match(studentModule, />Xem danh sách<\/button>/);
  assert.doesNotMatch(studentModule, />Xem nhanh danh sách<\/button>/);
  assert.match(studentModule, /function ensurePublicRegistrationDialog\(\)/);
  assert.match(studentModule, /function ensureXlsx\(\)/);
  assert.match(studentModule, /const XLSX = await ensureXlsx\(\)/);
  assert.match(studentModule, /const PUBLIC_REGISTRATION_PAGE_SIZE = 20/);
  assert.match(studentModule, /orderBy\("createdAt", "asc"\)/);
  assert.match(studentModule, /startAfter\(cursor\)/);
  assert.match(studentModule, /limit\(PUBLIC_REGISTRATION_PAGE_SIZE\)/);
  assert.match(studentModule, /offset \+ index \+ 1/);
  assert.match(studentModule, /async function fetchManagedRegistrations[\s\S]*orderBy\("createdAt", "asc"\)[\s\S]*async function fetchManagedRegistrationPage/);
  assert.match(styles, /\.event-actions \.btn-public-registration\{[^}]*flex:0 1 auto[^}]*padding:8px 10px/);
});

test("Tài khoản Admin không chạy truy vấn lịch sử điểm danh chỉ dành cho sinh viên", () => {
  assert.match(studentModule, /if \(studentIdentifier\(user\.email\)\) \{[\s\S]*where\("email", "==", user\.email\)/);
  assert.match(studentModule, /else \{\s*attendanceByEvent = new Map\(\);/);
});
