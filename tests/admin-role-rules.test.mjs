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
let env;

const dbFor = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
const role = (email, value, scopeType, scopeId = "") => ({ email, role: value, scopeType, scopeId, addedByUid: "owner", addedAt: new Date() });
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
      setDoc(doc(db, "events", "INTERIOR"), eventData("interior-sub", interiorSubEmail)),
      setDoc(doc(db, "events", "GRAPHIC"), eventData("graphic-sub", graphicSubEmail, { category: "Ngành Đồ họa", scopeId: "graphic" })),
      setDoc(doc(db, "events", "EXTERNAL"), eventData("interior-sub", interiorSubEmail, { category: "Sự kiện Khoa khác" })),
      setDoc(doc(db, "attendanceSessions", "INTERIOR_ATT"), { title: "Attendance", status: "open", scopeType: "department", scopeId: "interior", createdByUid: "interior-sub", createdByEmail: interiorSubEmail, createdAt: new Date(), coManagerUids: [], checkinCount: 0, pendingCount: 0 })
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

  test("Legacy Admin/Sub-admin giữ behavior không cần migration", async () => {
    const legacyEvent = eventData("legacy-sub", legacySubEmail);
    delete legacyEvent.scopeType;
    delete legacyEvent.scopeId;
    await assertSucceeds(addDoc(collection(dbFor("legacy-sub", legacySubEmail), "events"), legacyEvent));
    await assertSucceeds(updateDoc(doc(dbFor("legacy-admin", legacyAdminEmail), "events", "GRAPHIC"), { title: "Legacy Admin" }));
  });
});
