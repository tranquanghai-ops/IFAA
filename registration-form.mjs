export const REGISTRATION_QUESTION_TYPES = Object.freeze({
  short_text: "Trả lời ngắn",
  long_text: "Đoạn văn",
  single_choice: "Chọn một",
  multiple_choice: "Chọn nhiều",
  dropdown: "Danh sách thả xuống",
  number: "Số",
  date: "Ngày",
  boolean: "Có / Không"
});

export const REGISTRATION_PROFILE_FIELDS = Object.freeze({
  personalEmail: "Email cá nhân",
  phone: "Số điện thoại"
});

const OPTION_TYPES = new Set(["single_choice", "multiple_choice", "dropdown"]);
const QUESTION_TYPES = new Set(Object.keys(REGISTRATION_QUESTION_TYPES));

const text = (value, max = 5000) => String(value ?? "").trim().slice(0, max);

export function normalizeRegistrationProfileFields(value = {}) {
  return Object.fromEntries(Object.keys(REGISTRATION_PROFILE_FIELDS).map((key) => {
    const source = value?.[key] || {};
    const enabled = source.enabled === true;
    return [key, { enabled, required: enabled && source.required === true }];
  }));
}

export function normalizeRegistrationFormItems(value = []) {
  const ids = new Set();
  return (Array.isArray(value) ? value : []).slice(0, 60).map((source, index) => {
    const kind = source?.kind === "content" ? "content" : "question";
    let id = text(source?.id, 80).replace(/[^A-Za-z0-9_-]/g, "");
    if (!id || ids.has(id)) id = `${kind}_${index + 1}`;
    ids.add(id);
    if (kind === "content") {
      const linkUrl = /^https:\/\//i.test(text(source?.linkUrl, 1000)) ? text(source.linkUrl, 1000) : "";
      return { id, kind, title: text(source?.title, 200), content: text(source?.content, 10000), linkUrl, linkLabel: text(source?.linkLabel, 160), order: index + 1 };
    }
    const type = QUESTION_TYPES.has(source?.type) ? source.type : "short_text";
    const options = OPTION_TYPES.has(type)
      ? [...new Set((Array.isArray(source?.options) ? source.options : []).map((option) => text(option, 300)).filter(Boolean))].slice(0, 50)
      : [];
    return { id, kind, type, label: text(source?.label, 500), required: source?.required === true, options, order: index + 1 };
  }).filter((item) => item.kind === "content" ? (item.title || item.content || item.linkUrl) : item.label);
}

export function registrationConfig(event = {}) {
  const legacyQuestions = Array.isArray(event.registrationQuestions)
    ? event.registrationQuestions.map((item) => ({ ...item, kind: "question" }))
    : [];
  const items = normalizeRegistrationFormItems(event.registrationFormItems?.length ? event.registrationFormItems : legacyQuestions);
  return { profileFields: normalizeRegistrationProfileFields(event.registrationProfileFields), items };
}

export function eventNeedsRegistrationForm(event = {}) {
  const config = registrationConfig(event);
  return Object.values(config.profileFields).some((field) => field.enabled)
    || config.items.length > 0;
}

export function canQuickEditEvent(role, uid, event = {}) {
  return role === "owner" || role === "admin" || (role === "subadmin" && !!uid && event.createdByUid === uid);
}

export function formatRegistrationAnswer(value) {
  return Array.isArray(value) ? value.join("; ") : value === true ? "Có" : value === false ? "Không" : value ?? "";
}

export function validateRegistrationConfig(profileFields, items) {
  const normalizedFields = normalizeRegistrationProfileFields(profileFields);
  const normalizedItems = normalizeRegistrationFormItems(items);
  for (const item of normalizedItems) {
    if (item.kind === "question" && OPTION_TYPES.has(item.type) && item.options.length < 2) {
      throw Error(`Câu hỏi “${item.label}” cần ít nhất 2 lựa chọn.`);
    }
  }
  return { profileFields: normalizedFields, items: normalizedItems };
}

export function validPersonalEmail(value) {
  const email = text(value, 254);
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validPhone(value) {
  const phone = text(value, 40);
  if (!phone) return true;
  return /^[0-9+().\-\s]{6,40}$/.test(phone) && (phone.match(/\d/g) || []).length >= 6;
}

export function validateRegistrationSubmission(event, profileValues = {}, answerValues = {}) {
  const { profileFields, items } = registrationConfig(event);
  const errors = {};
  const profile = {
    personalEmail: text(profileValues.personalEmail, 254),
    phone: text(profileValues.phone, 40)
  };
  if (profileFields.personalEmail.enabled) {
    if (profileFields.personalEmail.required && !profile.personalEmail) errors.personalEmail = "Vui lòng nhập Email cá nhân.";
    else if (!validPersonalEmail(profile.personalEmail)) errors.personalEmail = "Email cá nhân chưa đúng định dạng.";
  }
  if (profileFields.phone.enabled) {
    if (profileFields.phone.required && !profile.phone) errors.phone = "Vui lòng nhập Số điện thoại.";
    else if (!validPhone(profile.phone)) errors.phone = "Số điện thoại chưa hợp lệ.";
  }

  const answers = {};
  for (const item of items.filter((entry) => entry.kind === "question")) {
    const raw = answerValues[item.id];
    let value;
    if (item.type === "multiple_choice") value = [...new Set((Array.isArray(raw) ? raw : []).map((entry) => text(entry, 300)).filter((entry) => item.options.includes(entry)))];
    else if (item.type === "number") value = raw === "" || raw == null ? "" : Number(raw);
    else if (item.type === "boolean") value = raw === true || raw === "true" ? true : raw === false || raw === "false" ? false : "";
    else value = text(raw, item.type === "long_text" ? 10000 : 2000);

    const empty = value === "" || value == null || (Array.isArray(value) && !value.length) || (typeof value === "number" && !Number.isFinite(value));
    if (item.required && empty) errors[item.id] = "Vui lòng trả lời câu hỏi này.";
    if (!empty && OPTION_TYPES.has(item.type) && item.type !== "multiple_choice" && !item.options.includes(value)) errors[item.id] = "Lựa chọn không hợp lệ.";
    if (!empty && item.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors[item.id] = "Ngày chưa hợp lệ.";
    if (!empty) answers[item.id] = value;
  }
  return { profile, answers, errors, valid: !Object.keys(errors).length };
}

export function registrationFormSnapshot(event = {}) {
  const { profileFields, items } = registrationConfig(event);
  return {
    profileFields,
    items: items.filter((item) => item.kind === "question").map((item) => ({ id: item.id, label: item.label, type: item.type, required: item.required, options: item.options, order: item.order }))
  };
}
