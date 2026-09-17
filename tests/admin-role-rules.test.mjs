import { after, before, beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const ownerEmail = "tranquanghai@tdtu.edu.vn";
const highEmail = "high@tdtu.edu.vn";
const facultyEmail = "faculty@tdtu.edu.vn";
const interiorHeadEmail = "interior-head@tdtu.edu.vn";
const graphicHeadEmail = "graphic-head@tdtu.edu.vn";
const interiorSubEmail = "interior-sub@tdtu.edu.vn";
const graphicSubEmail = "graphic-sub@tdtu.edu.vn";
const facultySubEmail = "faculty-sub@tdtu.edu.vn";
const legacyAdminEmail = "legacy-admin@tdtu.edu.vn";
const legacySubEmail = "legacy-sub@tdtu.edu.vn";
const digitalGradHeadEmail = "digital-grad-head@tdtu.edu.vn";
const multiSubEmail = "multi-sub@tdtu.edu.vn";
let env;

const dbFor = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
const role = (email, value, scopeType, scopeId = "", scopeIds = null) => ({ email, role: value, scopeType, scopeId, ...(scopeIds ? { scopeIds } : {}), addedByUid: "owner", addedAt: new Date() });
const eventData = (uid, email, overrides = {}) => ({
  title: "Event", category: "Ngành Thiết kế nội thất", location: "A", status: "open",
  capacity: 20, registeredCount: 0, allowedFaculties: ["IFA"], groupId: "", groupName: "",
  groupMaxRegistrations: 0, coManagerUids: [], scopeType: "department", scopeId: "interior",
  createdByUid: uid, createdByEmail: email, createdByName: uid, createdAt: new Date(),
  ...overrides
});

async function seed() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "admins", highEmail), role(highEmail, "high_admin", "global")),
      setDoc(doc(db, "admins", facultyEmail), role(facultyEmail, "faculty_admin", "faculty", "mtcn")),
      setDoc(doc(db, "admins", interiorHeadEmail), role(interiorHeadEmail, "department_admin", "department", "interior")),
      setDoc(doc(db, "admins", graphicHeadEmail), role(graphicHeadEmail, "department_admin", "department", "graphic")),
      setDoc(doc(db, "admins", interiorSubEmail), role(interiorSubEmail, "sub_admin", "department", "interior")),
      setDoc(doc(db, "admins", graphicSubEmail), role(graphicSubEmail, "sub_admin", "department", "graphic")),
      setDoc(doc(db, "admins", facultySubEmail), role(facultySubEmail, "sub_admin", "faculty", "mtcn")),
      setDoc(doc(db, "admins", legacyAdminEmail), { email: legacyAdminEmail, role: "admin" }),
      setDoc(doc(db, "admins", legacySubEmail), { email: legacySubEmail, role: "subadmin" }),
      setDoc(doc(db, "admins", digitalGradHeadEmail), role(digitalGradHeadEmail, "department_admin", "department", "digital-art", ["digital-art", "graduate"])),
      setDoc(doc(db, "admins", multiSubEmail), role(multiSubEmail, "sub_admin", "department", "interior", ["interior", "graduate"])),
      setDoc(doc(db, "events", "INTERIOR"), eventData("interior-sub", interiorSubEmail)),
      setDoc(doc(db, "events", "GRAPHIC"), eventData("graphic-sub", graphicSubEmail, { category: "Ngành Đồ họa", scopeId: "graphic" })),
      setDoc(doc(db, "events", "GRADUATE"), eventData("multi-sub", multiSubEmail, { category: "Sau đại học", scopeId: "graduate" })),
      setDoc(doc(db, "events", "EXTERNAL"), eventData("interior-sub", interiorSubEmail, { category: "Sự kiện Khoa khác" })),
      setDoc(doc(db, "attendanceSessions", "INTERIOR_ATT"), { title: "Attendance", status: "open", scopeType: "department", scopeId: "interior", createdByUid: "interior-sub", createdByEmail: interiorSubEmail, createdAt: new Date(), coManagerUids: [], checkinCount: 0, pendingCount: 0 }),
      setDoc(doc(db, "attendanceSessions", "GRADUATE_ATT"), { title: "Graduate Attendance", status: "open", scopeType: "department", scopeId: "graduate", createdByUid: "multi-sub", createdByEmail: multiSubEmail, createdAt: new Date(), coManagerUids: [], checkinCount: 0, pendingCount: 0 })
    ]);
  });
}

before(async () => {
  env = await initializeTestEnvironment({ projectId: "ifa-activities-role-scope", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
});
beforeEach(async () => { await env.clearFirestore(); await seed(); });
after(async () => env.cleanup());

describe("Admin role hierarchy", () => {
  test("System admin tạo High admin; High admin không tạo peer/System", async () => {
    await assertSucceeds(setDoc(doc(dbFor("owner", ownerEmail), "admins", "new-high@tdtu.edu.vn"), { ...role("new-high@tdtu.edu.vn", "high_admin", "global"), addedByUid: "owner" }));
    await assertFails(setDoc(doc(dbFor("high", highEmail), "admins", "peer@tdtu.edu.vn"), { ...role("peer@tdtu.edu.vn", "high_admin", "global"), addedByUid: "high" }));
    await assertFails(setDoc(doc(dbFor("high", highEmail), "admins", "system@tdtu.edu.vn"), { ...role("system@tdtu.edu.vn", "system_admin", "global"), addedByUid: "high" }));
  });

  test("High admin quản lý lower roles nhưng không sửa System/High", async () => {
    await assertSucceeds(setDoc(doc(dbFor("high", highEmail), "admins", "new-faculty@tdtu.edu.vn"), { ...role("new-faculty@tdtu.edu.vn", "faculty_admin", "faculty", "mtcn"), addedByUid: "high" }));
    await assertSucceeds(setDoc(doc(dbFor("high", highEmail), "admins", "new-head@tdtu.edu.vn"), { ...role("new-head@tdtu.edu.vn", "department_admin", "department", "interior"), addedByUid: "high" }));
    await assertFails(updateDoc(doc(dbFor("high", highEmail), "admins", highEmail), { role: "system_admin" }));
    await assertSucceeds(updateDoc(doc(dbFor("owner", ownerEmail), "admins", legacySubEmail), { role: "sub_admin", scopeType: "faculty", scopeId: "mtcn" }));
  });

  test("Faculty admin chỉ quản lý Sub-admin", async () => {
    await assertSucceeds(setDoc(doc(dbFor("faculty", facultyEmail), "admins", "new-sub@tdtu.edu.vn"), { ...role("new-sub@tdtu.edu.vn", "sub_admin", "department", "interior"), addedByUid: "faculty" }));
    await assertFails(setDoc(doc(dbFor("faculty", facultyEmail), "admins", "new-head@tdtu.edu.vn"), { ...role("new-head@tdtu.edu.vn", "department_admin", "department", "interior"), addedByUid: "faculty" }));
  });

  test("Department admin chỉ quản lý Sub-admin ngành mình", async () => {
    await assertSucceeds(setDoc(doc(dbFor("interior-head", interiorHeadEmail), "admins", "own-sub@tdtu.edu.vn"), { ...role("own-sub@tdtu.edu.vn", "sub_admin", "department", "interior"), addedByUid: "interior-head" }));
    await assertFails(setDoc(doc(dbFor("interior-head", interiorHeadEmail), "admins", "other-sub@tdtu.edu.vn"), { ...role("other-sub@tdtu.edu.vn", "sub_admin", "department", "graphic"), addedByUid: "interior-head" }));
    await assertFails(deleteDoc(doc(dbFor("interior-head", interiorHeadEmail), "admins", graphicSubEmail)));
  });

  test("Sub-admin không quản lý role hoặc tự đổi scope", async () => {
    await assertFails(setDoc(doc(dbFor("interior-sub", interiorSubEmail), "admins", "x@tdtu.edu.vn"), { ...role("x@tdtu.edu.vn", "sub_admin", "department", "interior"), addedByUid: "interior-sub" }));
    await assertFails(updateDoc(doc(dbFor("interior-sub", interiorSubEmail), "admins", interiorSubEmail), { scopeId: "graphic" }));
  });
});

describe("Scoped Event, Group and Attendance", () => {
  test("Department admin quản lý own department, không cross-department", async () => {
    await assertSucceeds(updateDoc(doc(dbFor("interior-head", interiorHeadEmail), "events", "INTERIOR"), { title: "Updated" }));
    await assertFails(updateDoc(doc(dbFor("interior-head", interiorHeadEmail), "events", "GRAPHIC"), { title: "Denied" }));
  });

  test("Department admin tạo đúng Event/Group scope, sai scope bị chặn", async () => {
    await assertSucceeds(addDoc(collection(dbFor("interior-head", interiorHeadEmail), "events"), eventData("interior-head", interiorHeadEmail)));
    await assertFails(addDoc(collection(dbFor("interior-head", interiorHeadEmail), "events"), eventData("interior-head", interiorHeadEmail, { category: "Ngành Đồ họa", scopeId: "graphic" })));
    await assertSucceeds(addDoc(collection(dbFor("interior-head", interiorHeadEmail), "eventGroups"), { name: "Own", maxRegistrations: 2, unlimited: false, scopeType: "department", scopeId: "interior", createdByUid: "interior-head", createdByEmail: interiorHeadEmail, createdAt: new Date() }));
    await assertFails(addDoc(collection(dbFor("interior-head", interiorHeadEmail), "eventGroups"), { name: "Other", maxRegistrations: 2, unlimited: false, scopeType: "department", scopeId: "graphic", createdByUid: "interior-head", createdByEmail: interiorHeadEmail, createdAt: new Date() }));
  });

  test("External Event: creator/hierarchy YES, unrelated Sub-admin NO", async () => {
    await assertSucceeds(updateDoc(doc(dbFor("interior-sub", interiorSubEmail), "events", "EXTERNAL"), { title: "Creator" }));
    await assertFails(updateDoc(doc(dbFor("graphic-sub", graphicSubEmail), "events", "EXTERNAL"), { title: "Unrelated" }));
    await assertSucceeds(updateDoc(doc(dbFor("interior-head", interiorHeadEmail), "events", "EXTERNAL"), { title: "Department" }));
    await assertSucceeds(updateDoc(doc(dbFor("faculty", facultyEmail), "events", "EXTERNAL"), { title: "Faculty" }));
    await assertSucceeds(updateDoc(doc(dbFor("high", highEmail), "events", "EXTERNAL"), { title: "High" }));
  });

  test("Mọi Sub-admin tạo External Event nhưng scope phải đúng", async () => {
    await assertSucceeds(addDoc(collection(dbFor("interior-sub", interiorSubEmail), "events"), eventData("interior-sub", interiorSubEmail, { category: "Sự kiện Trường" })));
    await assertFails(addDoc(collection(dbFor("interior-sub", interiorSubEmail), "events"), eventData("interior-sub", interiorSubEmail, { category: "Sự kiện Trường", scopeId: "graphic" })));
    await assertSucceeds(addDoc(collection(dbFor("faculty-sub", facultySubEmail), "events"), eventData("faculty-sub", facultySubEmail, { category: "Sự kiện Khoa khác", scopeType: "faculty", scopeId: "mtcn" })));
    await assertSucceeds(addDoc(collection(dbFor("faculty-sub", facultySubEmail), "events"), eventData("faculty-sub", facultySubEmail)));
  });

  test("Attendance scope và cross-department read/update được enforce", async () => {
    await assertSucceeds(getDoc(doc(dbFor("interior-head", interiorHeadEmail), "attendanceSessions", "INTERIOR_ATT")));
    await assertFails(getDoc(doc(dbFor("graphic-head", graphicHeadEmail), "attendanceSessions", "INTERIOR_ATT")));
    await assertSucceeds(updateDoc(doc(dbFor("interior-head", interiorHeadEmail), "attendanceSessions", "INTERIOR_ATT"), { title: "Managed" }));
  });

  test("Attendance liên kết Event legacy dùng scope suy ra từ category", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const legacyEvent = eventData("interior-head", interiorHeadEmail);
      delete legacyEvent.scopeType;
      delete legacyEvent.scopeId;
      await setDoc(doc(context.firestore(), "events", "LEGACY_INTERIOR"), legacyEvent);
    });
    const base = {
      eventId: "LEGACY_INTERIOR", title: "Legacy linked Attendance", status: "open",
      scopeType: "department", scopeId: "interior", createdByUid: "owner",
      createdByEmail: ownerEmail, createdAt: new Date(), coManagerUids: [],
      checkinCount: 0, pendingCount: 0
    };
    await assertSucceeds(addDoc(collection(dbFor("owner", ownerEmail), "attendanceSessions"), base));
    // Owner có quyền tạo mọi scope; lần ghi này chỉ có thể bị chặn vì scope không khớp Event nguồn.
    await assertFails(addDoc(collection(dbFor("owner", ownerEmail), "attendanceSessions"), { ...base, scopeId: "graphic" }));
  });

  test("Legacy Admin/Sub-admin giữ behavior không cần migration", async () => {
    const legacyEvent = eventData("legacy-sub", legacySubEmail);
    delete legacyEvent.scopeType;
    delete legacyEvent.scopeId;
    await assertSucceeds(addDoc(collection(dbFor("legacy-sub", legacySubEmail), "events"), legacyEvent));
    await assertSucceeds(updateDoc(doc(dbFor("legacy-admin", legacyAdminEmail), "events", "GRAPHIC"), { title: "Legacy Admin" }));
  });
});

describe("Multi-scope admin", () => {
  test("Trưởng ngành digital-art+graduate quản lý Event thuộc cả hai scope, không phải Interior", async () => {
    await assertSucceeds(updateDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "events", "GRADUATE"), { title: "Graduate managed" }));
    await assertSucceeds(addDoc(collection(dbFor("dg-head", digitalGradHeadEmail), "events"), eventData("dg-head", digitalGradHeadEmail, { category: "Ngành Nghệ thuật số", scopeId: "digital-art" })));
    await assertSucceeds(addDoc(collection(dbFor("dg-head", digitalGradHeadEmail), "events"), eventData("dg-head", digitalGradHeadEmail, { category: "Sau đại học", scopeId: "graduate" })));
    await assertFails(addDoc(collection(dbFor("dg-head", digitalGradHeadEmail), "events"), eventData("dg-head", digitalGradHeadEmail, { category: "Ngành Thiết kế nội thất", scopeId: "interior" })));
    await assertFails(updateDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "events", "INTERIOR"), { title: "Denied" }));
  });

  test("Trưởng ngành multi-scope tạo Sub-admin: subset cho phép, ngoài scope bị chặn", async () => {
    await assertSucceeds(setDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "admins", "s1@tdtu.edu.vn"), { ...role("s1@tdtu.edu.vn", "sub_admin", "department", "digital-art", ["digital-art"]), addedByUid: "dg-head" }));
    await assertSucceeds(setDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "admins", "s2@tdtu.edu.vn"), { ...role("s2@tdtu.edu.vn", "sub_admin", "department", "graduate", ["graduate"]), addedByUid: "dg-head" }));
    await assertSucceeds(setDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "admins", "s3@tdtu.edu.vn"), { ...role("s3@tdtu.edu.vn", "sub_admin", "department", "digital-art", ["digital-art", "graduate"]), addedByUid: "dg-head" }));
    await assertFails(setDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "admins", "s4@tdtu.edu.vn"), { ...role("s4@tdtu.edu.vn", "sub_admin", "department", "digital-art", ["digital-art", "interior"]), addedByUid: "dg-head" }));
    await assertFails(setDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "admins", "s5@tdtu.edu.vn"), { ...role("s5@tdtu.edu.vn", "sub_admin", "department", "interior", ["interior"]), addedByUid: "dg-head" }));
  });

  test("Trưởng ngành không thể sửa/xóa Sub-admin ngoài subset dù đang thấy", async () => {
    await assertFails(updateDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "admins", multiSubEmail), { role: "sub_admin" }));
    await assertFails(deleteDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "admins", multiSubEmail)));
  });

  test("Sub-admin multi-scope (interior+graduate) thao tác đúng hai scope, DENY digital-art", async () => {
    await assertSucceeds(addDoc(collection(dbFor("multi-sub", multiSubEmail), "events"), eventData("multi-sub", multiSubEmail, { category: "Ngành Thiết kế nội thất", scopeId: "interior" })));
    await assertSucceeds(addDoc(collection(dbFor("multi-sub", multiSubEmail), "events"), eventData("multi-sub", multiSubEmail, { category: "Sau đại học", scopeId: "graduate" })));
    await assertFails(addDoc(collection(dbFor("multi-sub", multiSubEmail), "events"), eventData("multi-sub", multiSubEmail, { category: "Ngành Đồ họa", scopeId: "graphic" })));
    await assertSucceeds(addDoc(collection(dbFor("multi-sub", multiSubEmail), "eventGroups"), { name: "Grad", maxRegistrations: 2, unlimited: false, scopeType: "department", scopeId: "graduate", createdByUid: "multi-sub", createdByEmail: multiSubEmail, createdAt: new Date() }));
    await assertFails(addDoc(collection(dbFor("multi-sub", multiSubEmail), "eventGroups"), { name: "Graphics", maxRegistrations: 2, unlimited: false, scopeType: "department", scopeId: "graphic", createdByUid: "multi-sub", createdByEmail: multiSubEmail, createdAt: new Date() }));
  });

  test("Scope ghi không hợp lệ bị chặn: unknown, rỗng, thiếu scopeId khớp", async () => {
    await assertFails(setDoc(doc(dbFor("owner", ownerEmail), "admins", "x1@tdtu.edu.vn"), { ...role("x1@tdtu.edu.vn", "department_admin", "department", "digital-art", ["digital-art", "khong-ton-tai"]), addedByUid: "owner" }));
    await assertFails(setDoc(doc(dbFor("owner", ownerEmail), "admins", "x2@tdtu.edu.vn"), { ...role("x2@tdtu.edu.vn", "sub_admin", "department", "digital-art", []), addedByUid: "owner" }));
    await assertFails(setDoc(doc(dbFor("owner", ownerEmail), "admins", "x3@tdtu.edu.vn"), { ...role("x3@tdtu.edu.vn", "department_admin", "department", "graduate", ["digital-art", "graduate"]), addedByUid: "owner" }));
  });

  test("Tự đổi scope/role của chính mình bị chặn", async () => {
    await assertFails(updateDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "admins", digitalGradHeadEmail), { scopeIds: ["digital-art", "graduate", "interior"] }));
    await assertFails(updateDoc(doc(dbFor("multi-sub", multiSubEmail), "admins", multiSubEmail), { scopeIds: ["graphic"] }));
  });

  test("Sub-admin multi-scope vẫn không quản lý role/user Admin", async () => {
    await assertFails(setDoc(doc(dbFor("multi-sub", multiSubEmail), "admins", "newsub@tdtu.edu.vn"), { ...role("newsub@tdtu.edu.vn", "sub_admin", "department", "graduate", ["graduate"]), addedByUid: "multi-sub" }));
  });

  test("Attendance multi-scope: đọc/tạo đúng scope, DENY scope ngoài danh sách", async () => {
    await assertSucceeds(getDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "attendanceSessions", "GRADUATE_ATT")));
    await assertFails(getDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "attendanceSessions", "INTERIOR_ATT")));
    await assertSucceeds(updateDoc(doc(dbFor("dg-head", digitalGradHeadEmail), "attendanceSessions", "GRADUATE_ATT"), { title: "Managed" }));
    await assertSucceeds(addDoc(collection(dbFor("dg-head", digitalGradHeadEmail), "attendanceSessions"), { title: "New Grad Att", status: "open", scopeType: "department", scopeId: "graduate", createdByUid: "dg-head", createdByEmail: digitalGradHeadEmail, createdAt: new Date(), coManagerUids: [], checkinCount: 0, pendingCount: 0 }));
    await assertFails(addDoc(collection(dbFor("dg-head", digitalGradHeadEmail), "attendanceSessions"), { title: "Bad Scope", status: "open", scopeType: "department", scopeId: "interior", createdByUid: "dg-head", createdByEmail: digitalGradHeadEmail, createdAt: new Date(), coManagerUids: [], checkinCount: 0, pendingCount: 0 }));
    await assertSucceeds(getDoc(doc(dbFor("multi-sub", multiSubEmail), "attendanceSessions", "GRADUATE_ATT")));
  });

  test("Legacy scopeId đơn (không scopeIds) vẫn ghi và quản lý được", async () => {
    await assertSucceeds(setDoc(doc(dbFor("owner", ownerEmail), "admins", "legacy-head@tdtu.edu.vn"), role("legacy-head@tdtu.edu.vn", "department_admin", "department", "interior")));
    await assertSucceeds(updateDoc(doc(dbFor("interior-head", interiorHeadEmail), "events", "INTERIOR"), { title: "Legacy still works" }));
  });
});
