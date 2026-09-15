import test from "node:test";
import assert from "node:assert/strict";
import {
  canQuickEditEvent,
  eventNeedsRegistrationForm,
  formatRegistrationAnswer,
  normalizeRegistrationFormItems,
  registrationConfig,
  registrationFormSnapshot,
  validateRegistrationConfig,
  validateRegistrationSubmission
} from "../registration-form.mjs";

test("event cũ không cấu hình vẫn dùng đăng ký nhanh", () => {
  assert.equal(eventNeedsRegistrationForm({ title: "Sự kiện cũ" }), false);
  assert.deepEqual(registrationConfig({}), {
    profileFields: {
      personalEmail: { enabled: false, required: false },
      phone: { enabled: false, required: false }
    },
    items: []
  });
});

test("quick edit tuân thủ vai trò và quyền sở hữu của sub-admin", () => {
  const event = { createdByUid: "owner-of-event" };
  assert.equal(canQuickEditEvent("owner", "any", event), true);
  assert.equal(canQuickEditEvent("admin", "any", event), true);
  assert.equal(canQuickEditEvent("subadmin", "owner-of-event", event), true);
  assert.equal(canQuickEditEvent("subadmin", "another-user", event), false);
  assert.equal(canQuickEditEvent("", "owner-of-event", event), false);
});

test("profile field và content block kích hoạt biểu mẫu", () => {
  assert.equal(eventNeedsRegistrationForm({ registrationProfileFields: { phone: { enabled: true } } }), true);
  assert.equal(eventNeedsRegistrationForm({ registrationFormItems: [{ id: "info", kind: "content", title: "Lưu ý" }] }), true);
});

test("chuẩn hóa loại câu hỏi, thứ tự và lựa chọn", () => {
  const items = normalizeRegistrationFormItems([
    { id: "q1", kind: "question", type: "multiple_choice", label: "Ca tham gia", options: ["Sáng", "Chiều", "Sáng"] },
    { id: "q1", kind: "question", type: "unknown", label: "Ghi chú" }
  ]);
  assert.deepEqual(items.map((item) => item.id), ["q1", "question_2"]);
  assert.deepEqual(items[0].options, ["Sáng", "Chiều"]);
  assert.equal(items[1].type, "short_text");
  assert.deepEqual(items.map((item) => item.order), [1, 2]);
});

test("câu hỏi lựa chọn cần ít nhất hai phương án", () => {
  assert.throws(() => validateRegistrationConfig({}, [
    { id: "q1", kind: "question", type: "dropdown", label: "Chọn ca", options: ["Sáng"] }
  ]), /ít nhất 2 lựa chọn/);
});

test("kiểm tra field bắt buộc và giữ đúng kiểu câu trả lời", () => {
  const event = {
    registrationProfileFields: {
      personalEmail: { enabled: true, required: true },
      phone: { enabled: true, required: false }
    },
    registrationFormItems: [
      { id: "short", kind: "question", type: "short_text", label: "Tên đội", required: true },
      { id: "multi", kind: "question", type: "multiple_choice", label: "Ca", options: ["Sáng", "Chiều"] },
      { id: "count", kind: "question", type: "number", label: "Số người" },
      { id: "agree", kind: "question", type: "boolean", label: "Đồng ý", required: true }
    ]
  };
  const invalid = validateRegistrationSubmission(event, { personalEmail: "sai", phone: "12" }, { short: "", agree: "" });
  assert.equal(invalid.valid, false);
  assert.deepEqual(Object.keys(invalid.errors).sort(), ["agree", "personalEmail", "phone", "short"]);

  const valid = validateRegistrationSubmission(event, { personalEmail: "sv@example.com", phone: "+84 901 234 567" }, {
    short: "IFA Team",
    multi: ["Sáng", "Không hợp lệ", "Sáng"],
    count: "3",
    agree: "true"
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.answers, { short: "IFA Team", multi: ["Sáng"], count: 3, agree: true });
});

test("snapshot chỉ lưu schema câu hỏi tại thời điểm đăng ký", () => {
  const snapshot = registrationFormSnapshot({
    registrationFormItems: [
      { id: "intro", kind: "content", title: "Lưu ý" },
      { id: "q1", kind: "question", type: "long_text", label: "Mong đợi", required: true }
    ]
  });
  assert.equal(snapshot.items.length, 1);
  assert.deepEqual(snapshot.items[0], { id: "q1", label: "Mong đợi", type: "long_text", required: true, options: [], order: 2 });
});

test("Excel hiển thị multiple choice bằng dấu chấm phẩy và giữ long text", () => {
  assert.equal(formatRegistrationAnswer(["Sáng", "Chiều"]), "Sáng; Chiều");
  assert.equal(formatRegistrationAnswer("Nội dung\nnhiều dòng"), "Nội dung\nnhiều dòng");
});
