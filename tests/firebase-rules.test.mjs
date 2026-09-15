import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, increment, query, runTransaction,
  serverTimestamp, setDoc, updateDoc, where, writeBatch
} from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";

const projectId = "ifa-activities";
const ownerEmail = "tranquanghai@tdtu.edu.vn";
const adminEmail = "admin@tdtu.edu.vn";
const legacyAdminEmail = "legacy@tdtu.edu.vn";
const subEmail = "sub@tdtu.edu.vn";
const otherSubEmail = "other-sub@tdtu.edu.vn";
const scannerEmail = "scanner@student.tdtu.edu.vn";
const leaderEmail = "leader@student.tdtu.edu.vn";
const studentEmail = "student@student.tdtu.edu.vn";
const student2Email = "student2@student.tdtu.edu.vn";
const outsiderEmail = "outside@example.com";
const coManagerEmail = "co-manager@tdtu.edu.vn";
let env;

const auth = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true });
const dbFor = (uid, email) => auth(uid, email).firestore();
const storageFor = (uid, email) => auth(uid, email).storage();
const unauthenticatedStorage = () => env.unauthenticatedContext().storage();

async function seedBase() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "admins", adminEmail), { email: adminEmail, role: "admin" }),
      setDoc(doc(db, "admins", legacyAdminEmail), { email: legacyAdminEmail }),
      setDoc(doc(db, "admins", subEmail), { email: subEmail, role: "subadmin" }),
      setDoc(doc(db, "admins", otherSubEmail), { email: otherSubEmail, role: "subadmin" }),
      setDoc(doc(db, "attendanceSessions", "OWN"), {
        status: "open", createdByUid: "sub", createdByEmail: subEmail,
        checkinCount: 0, pendingCount: 0
      }),
      setDoc(doc(db, "attendanceSessions", "OTHER"), {
        status: "open", createdByUid: "other-sub", createdByEmail: otherSubEmail,
        checkinCount: 0, pendingCount: 0
      }),
      setDoc(doc(db, "scannerAssignments", "OWN_" + scannerEmail), {
        sessionId: "OWN", email: scannerEmail, role: "scanner", active: true
      }),
      setDoc(doc(db, "scannerAssignments", "OWN_" + leaderEmail), {
        sessionId: "OWN", email: leaderEmail, role: "leader", active: true
      }),
      setDoc(doc(db, "profiles", "student"), {
        uid: "student", email: studentEmail, participantType: "student",
        identifier: "52200001", mssv: "52200001", name: "Student",
        phone: "", faculty: "IFA", major: ""
      }),
      setDoc(doc(db, "profiles", "student2"), {
        uid: "student2", email: student2Email, participantType: "student",
        identifier: "52200002", mssv: "52200002", name: "Student 2",
        phone: "", faculty: "IFA", major: ""
      }),
      setDoc(doc(db, "profiles", "co-manager"), {
        uid: "co-manager", email: coManagerEmail, participantType: "staff",
        identifier: coManagerEmail, name: "Co Manager", phone: "", faculty: "IFA", major: ""
      }),
      setDoc(doc(db, "events", "CO_EVENT"), {
        title: "Assigned event", location: "Room A", status: "open", capacity: 20,
        allowedFaculties: ["IFA"], registeredCount: 0, groupId: "", groupName: "", groupMaxRegistrations: 0,
        createdByUid: "sub", createdByEmail: subEmail, createdByName: "Sub Admin", createdAt: new Date(),
        coManagerUids: ["co-manager"]
      }),
      setDoc(doc(db, "events", "UNRELATED_EVENT"), {
        title: "Unrelated event", location: "Room B", status: "open", capacity: 20,
        allowedFaculties: ["IFA"], registeredCount: 0, groupId: "", groupName: "", groupMaxRegistrations: 0,
        createdByUid: "other-sub", createdByEmail: otherSubEmail, createdByName: "Other", createdAt: new Date(),
        coManagerUids: []
      }),
      setDoc(doc(db, "attendanceSessions", "CO_ATT"), {
        eventId: "CO_EVENT", title: "Assigned attendance", date: "2026-09-15", status: "open",
        createdByUid: "sub", createdByEmail: subEmail, createdByName: "Sub Admin", createdAt: new Date(),
        checkinCount: 0, pendingCount: 0, coManagerUids: ["co-manager"]
      }),
      setDoc(doc(db, "attendanceSessions", "UNRELATED_ATT"), {
        eventId: "UNRELATED_EVENT", title: "Unrelated attendance", date: "2026-09-15", status: "open",
        createdByUid: "other-sub", createdByEmail: otherSubEmail, createdByName: "Other", createdAt: new Date(),
        checkinCount: 0, pendingCount: 0, coManagerUids: []
      }),
      setDoc(doc(db, "events", "ATTACH_OWN"), {
        title: "Own attachment event", createdByUid: "sub", createdByEmail: subEmail,
        registeredCount: 0, deletedAt: null
      }),
      setDoc(doc(db, "events", "ATTACH_OTHER"), {
        title: "Other attachment event", createdByUid: "other-sub", createdByEmail: otherSubEmail,
        registeredCount: 0, deletedAt: null
      }),
      setDoc(doc(db, "events", "ATTACH_DELETED"), {
        title: "Deleted attachment event", createdByUid: "sub", createdByEmail: subEmail,
        registeredCount: 0, deletedAt: new Date()
      })
    ]);
  });
}

function checkinData({ mssv = "52200001", scannerUid = "scanner", scanner = scannerEmail } = {}) {
  return {
    sessionId: "OWN", eventId: "", mssv, name: "Student",
    email: studentEmail, studentUid: "student", scannerUid,
    scannerEmail: scanner, scannerMssv: "SCANNER", scannerName: "Scanner",
    checkedAt: new Date(), requestId: crypto.randomUUID(), deletedAt: null
  };
}

async function createCanonical(db, mssv = "52200001", scannerUid = "scanner", scanner = scannerEmail) {
  const id = "OWN_" + mssv;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const matches = await getDocs(query(collection(db, "checkins"), where("sessionId", "==", "OWN"), where("mssv", "==", mssv)));
    const canonical = matches.docs.find((item) => item.id === id);
    if (canonical && !canonical.data().deletedAt) return;
    try {
      await runTransaction(db, async (transaction) => {
        const sessionRef = doc(db, "attendanceSessions", "OWN");
        const checkinRef = doc(db, "checkins", id);
        const sessionSnapshot = await transaction.get(sessionRef);
        transaction.set(checkinRef, checkinData({ mssv, scannerUid, scanner }));
        transaction.update(sessionRef, {
          checkinCount: Number(sessionSnapshot.data().checkinCount || 0) + 1,
          pendingCount: Number(sessionSnapshot.data().pendingCount || 0),
          counterMutationId: id,
          updatedAt: new Date()
        });
      });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

async function canonicalizePending(db, sourceId, mssv) {
  const targetId = "OWN_" + mssv;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const matches = await getDocs(query(collection(db, "checkins"), where("sessionId", "==", "OWN"), where("mssv", "==", mssv)));
    const target = matches.docs.find((item) => item.id === targetId);
    const targetActive = Boolean(target && !target.data().deletedAt);
    try {
      return await runTransaction(db, async (transaction) => {
        const sourceRef = doc(db, "checkins", sourceId);
        const targetRef = doc(db, "checkins", targetId);
        const sessionRef = doc(db, "attendanceSessions", "OWN");
        const [source, session] = await Promise.all([
          transaction.get(sourceRef), transaction.get(sessionRef)
        ]);
        if (!targetActive) transaction.set(targetRef, { ...source.data(), mssv, deletedAt: null, deletedByUid: "", deletedByEmail: "" });
        const sourceUpdate = { deletedAt: new Date(), deletedByUid: "scanner", deletedByEmail: scannerEmail };
        if (!targetActive) Object.assign(sourceUpdate, { photoPath: deleteField(), photoUrl: deleteField(), photoData: deleteField() });
        transaction.update(sourceRef, sourceUpdate);
        transaction.update(sessionRef, {
          checkinCount: Number(session.data().checkinCount || 0) + (targetActive ? 0 : 1),
          pendingCount: Math.max(0, Number(session.data().pendingCount || 0) - 1),
          counterMutationId: targetId,
          counterSourceId: sourceId,
          updatedAt: new Date()
        });
        return targetActive;
      });
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") }
  });
});

describe("scoped Event and Attendance co-manager permissions", () => {
  test("co-manager queries only assigned Event and Attendance", async () => {
    const db = dbFor("co-manager", coManagerEmail);
    const [eventRows, attendanceRows] = await Promise.all([
      assertSucceeds(getDocs(query(collection(db, "events"), where("coManagerUids", "array-contains", "co-manager")))),
      assertSucceeds(getDocs(query(collection(db, "attendanceSessions"), where("coManagerUids", "array-contains", "co-manager"))))
    ]);
    assert.deepEqual(eventRows.docs.map((item) => item.id), ["CO_EVENT"]);
    assert.deepEqual(attendanceRows.docs.map((item) => item.id), ["CO_ATT"]);
  });

  test("co-manager updates normal Event fields but not ownership or coManagerUids", async () => {
    const db = dbFor("co-manager", coManagerEmail);
    await assertSucceeds(updateDoc(doc(db, "events", "CO_EVENT"), { location: "Room C" }));
    await assertFails(updateDoc(doc(db, "events", "CO_EVENT"), { createdByUid: "co-manager" }));
    await assertFails(updateDoc(doc(db, "events", "CO_EVENT"), { createdByName: "Forged" }));
    await assertFails(updateDoc(doc(db, "events", "CO_EVENT"), { coManagerUids: ["co-manager", "other"] }));
    await assertFails(updateDoc(doc(db, "events", "CO_EVENT"), { deletedAt: new Date() }));
    await assertFails(deleteDoc(doc(db, "events", "CO_EVENT")));
  });

  test("co-manager cannot update unrelated Event; Event read remains public by product design", async () => {
    const db = dbFor("co-manager", coManagerEmail);
    await assertSucceeds(getDoc(doc(db, "events", "UNRELATED_EVENT")));
    await assertFails(updateDoc(doc(db, "events", "UNRELATED_EVENT"), { location: "Forbidden" }));
  });

  test("co-manager updates assigned Attendance but cannot change permission fields or delete", async () => {
    const db = dbFor("co-manager", coManagerEmail);
    await assertSucceeds(updateDoc(doc(db, "attendanceSessions", "CO_ATT"), { location: "Room C" }));
    await assertFails(updateDoc(doc(db, "attendanceSessions", "CO_ATT"), { createdByUid: "co-manager" }));
    await assertFails(updateDoc(doc(db, "attendanceSessions", "CO_ATT"), { coManagerUids: [] }));
    await assertFails(updateDoc(doc(db, "attendanceSessions", "CO_ATT"), { deletedAt: new Date() }));
    await assertFails(deleteDoc(doc(db, "attendanceSessions", "CO_ATT")));
  });

  test("co-manager cannot read or update unrelated Attendance", async () => {
    const db = dbFor("co-manager", coManagerEmail);
    await assertFails(getDoc(doc(db, "attendanceSessions", "UNRELATED_ATT")));
    await assertFails(updateDoc(doc(db, "attendanceSessions", "UNRELATED_ATT"), { location: "Forbidden" }));
  });

  test("creator and high Admin can update coManagerUids; creator cannot add itself", async () => {
    await assertSucceeds(updateDoc(doc(dbFor("sub", subEmail), "events", "CO_EVENT"), { coManagerUids: [] }));
    await assertSucceeds(updateDoc(doc(dbFor("admin", adminEmail), "events", "CO_EVENT"), { coManagerUids: ["co-manager"] }));
    await assertFails(updateDoc(doc(dbFor("sub", subEmail), "events", "CO_EVENT"), { coManagerUids: ["sub"] }));
    await assertSucceeds(updateDoc(doc(dbFor("sub", subEmail), "attendanceSessions", "CO_ATT"), { coManagerUids: [] }));
    await assertSucceeds(updateDoc(doc(dbFor("admin", adminEmail), "attendanceSessions", "CO_ATT"), { coManagerUids: ["co-manager"] }));
    await assertFails(updateDoc(doc(dbFor("sub", subEmail), "attendanceSessions", "CO_ATT"), { coManagerUids: ["sub"] }));
  });

  test("Attendance co-manager can write Check-in only for assigned Attendance", async () => {
    const db = dbFor("co-manager", coManagerEmail);
    await assertSucceeds(runTransaction(db, async (transaction) => {
      const sessionRef = doc(db, "attendanceSessions", "CO_ATT");
      const checkinRef = doc(db, "checkins", "CO_ATT_52200001");
      const session = await transaction.get(sessionRef);
      transaction.set(checkinRef, {
        sessionId: "CO_ATT", eventId: "CO_EVENT", mssv: "52200001", name: "Student",
        email: studentEmail, studentUid: "student", scannerUid: "co-manager", scannerEmail: coManagerEmail,
        scannerMssv: "CO-MANAGER", scannerName: "Co Manager", checkedAt: new Date(), requestId: crypto.randomUUID(), deletedAt: null
      });
      transaction.update(sessionRef, { checkinCount: Number(session.data().checkinCount || 0) + 1, pendingCount: 0, counterMutationId: "CO_ATT_52200001", updatedAt: new Date() });
    }));
    await assertFails(setDoc(doc(db, "checkins", "UNRELATED_ATT_52200002"), {
      sessionId: "UNRELATED_ATT", eventId: "UNRELATED_EVENT", mssv: "52200002", name: "Student 2",
      email: student2Email, studentUid: "student2", scannerUid: "co-manager", scannerEmail: coManagerEmail,
      scannerMssv: "CO-MANAGER", scannerName: "Co Manager", checkedAt: new Date(), requestId: crypto.randomUUID(), deletedAt: null
    }));
    const photo = new Uint8Array([255, 216, 255, 217]);
    const metadata = { contentType: "image/jpeg" };
    await assertSucceeds(uploadBytes(ref(storageFor("co-manager", coManagerEmail), "attendance/CO_ATT/co-manager.jpg"), photo, metadata));
    await assertFails(uploadBytes(ref(storageFor("co-manager", coManagerEmail), "attendance/UNRELATED_ATT/co-manager.jpg"), photo, metadata));
  });

  test("ordinary user receives no scoped management permission", async () => {
    const db = dbFor("student", studentEmail);
    await assertFails(updateDoc(doc(db, "events", "CO_EVENT"), { location: "Forbidden" }));
    await assertFails(getDoc(doc(db, "attendanceSessions", "CO_ATT")));
  });

  test("co-manager can query and remove an assigned Event registration atomically", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await updateDoc(doc(db, "events", "CO_EVENT"), { registeredCount: 1 });
      await setDoc(doc(db, "registrations", "student_CO_EVENT"), {
        uid: "student", email: studentEmail, eventId: "CO_EVENT", groupId: ""
      });
    });
    const db = dbFor("co-manager", coManagerEmail);
    const rows = await assertSucceeds(getDocs(query(collection(db, "registrations"), where("eventId", "==", "CO_EVENT"))));
    assert.equal(rows.size, 1);
    await assertSucceeds(runTransaction(db, async (transaction) => {
      transaction.update(doc(db, "events", "CO_EVENT"), { registeredCount: 0, registrationMutationId: "student_CO_EVENT", updatedAt: new Date() });
      transaction.delete(doc(db, "registrations", "student_CO_EVENT"));
    }));
  });

  test("co-manager can manage assigned Event attachments but not unrelated Event attachments", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const metadata = { contentType: "application/pdf" };
    await assertSucceeds(uploadBytes(ref(storageFor("co-manager", coManagerEmail), "event-attachments/CO_EVENT/comanagerfile0001.pdf"), pdf, metadata));
    await assertFails(uploadBytes(ref(storageFor("co-manager", coManagerEmail), "event-attachments/UNRELATED_EVENT/comanagerfile002.pdf"), pdf, metadata));
  });

  test("co-manager can manage Attendance child records only for assigned session", async () => {
    const db = dbFor("co-manager", coManagerEmail);
    await assertSucceeds(setDoc(doc(db, "scannerAssignments", "CO_ATT_helper@tdtu.edu.vn"), {
      sessionId: "CO_ATT", email: "helper@tdtu.edu.vn", role: "scanner", active: true
    }));
    await assertFails(setDoc(doc(db, "scannerAssignments", "UNRELATED_ATT_helper@tdtu.edu.vn"), {
      sessionId: "UNRELATED_ATT", email: "helper@tdtu.edu.vn", role: "scanner", active: true
    }));
  });

  test("legacy resources without coManagerUids keep creator/admin behavior", async () => {
    const sub = dbFor("sub", subEmail);
    await assertSucceeds(updateDoc(doc(sub, "attendanceSessions", "OWN"), { location: "Legacy room" }));
    await assertFails(getDoc(doc(dbFor("co-manager", coManagerEmail), "attendanceSessions", "OWN")));
  });
});
beforeEach(seedBase);
afterEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
});
after(async () => env.cleanup());

describe("role matrix and session ownership", () => {
  test("Owner and both explicit/legacy Admin retain high-admin Storage access", async () => {
    const body = new Uint8Array([31, 139, 8, 0]);
    for (const [uid, email] of [["owner", ownerEmail], ["admin", adminEmail], ["legacy", legacyAdminEmail]]) {
      await assertSucceeds(uploadBytes(ref(storageFor(uid, email), "datasets/faculty-students.json.gz"), body, { contentType: "application/gzip" }));
    }
  });

  test("Export cache permits Owner and explicit Admin but denies Sub-admin, Student and unauthenticated users", async () => {
    const body = new Uint8Array([80, 75, 3, 4]);
    const path = "exports/registrations/event-E.xlsx";
    const metadata = { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    await assertSucceeds(uploadBytes(ref(storageFor("owner", ownerEmail), path), body, metadata));
    await assertSucceeds(getBytes(ref(storageFor("owner", ownerEmail), path)));
    await assertSucceeds(getBytes(ref(storageFor("admin", adminEmail), path)));
    await assertSucceeds(uploadBytes(ref(storageFor("admin", adminEmail), path), body, metadata));
    for (const storage of [
      storageFor("sub", subEmail),
      storageFor("student", studentEmail),
      unauthenticatedStorage()
    ]) {
      await assertFails(getBytes(ref(storage, path)));
      await assertFails(uploadBytes(ref(storage, path), body, metadata));
    }
  });

  test("Sub-admin can atomically create own session and roster, but not write another session", async () => {
    const own = dbFor("sub", subEmail);
    const batch = writeBatch(own);
    batch.set(doc(own, "attendanceSessions", "NEW"), {
      status: "open", createdByUid: "sub", createdByEmail: subEmail,
      checkinCount: 0, pendingCount: 0
    });
    batch.set(doc(own, "attendanceRoster", "NEW_52200001"), {
      sessionId: "NEW", eventId: "", mssv: "52200001", name: "Student",
      email: studentEmail, uid: "student", createdAt: new Date()
    });
    await assertSucceeds(batch.commit());
    await assertFails(setDoc(doc(own, "attendanceRoster", "OTHER_52200001"), {
      sessionId: "OTHER", eventId: "", mssv: "52200001", name: "Student",
      email: studentEmail, uid: "student", createdAt: new Date()
    }));
  });

  test("Sub-admin can end and reopen own session but only high Admin can finalize", async () => {
    const own = dbFor("sub", subEmail);
    await assertSucceeds(updateDoc(doc(own, "attendanceSessions", "OWN"), {
      status: "ended", endedAt: new Date(), updatedAt: new Date()
    }));
    await assertSucceeds(updateDoc(doc(own, "attendanceSessions", "OWN"), {
      status: "open", endedAt: null, updatedAt: new Date()
    }));
    await assertFails(updateDoc(doc(own, "attendanceSessions", "OWN"), {
      status: "finalized", updatedAt: new Date()
    }));
    await assertSucceeds(updateDoc(doc(dbFor("admin", adminEmail), "attendanceSessions", "OWN"), {
      status: "finalized", updatedAt: new Date()
    }));
  });

  test("Storage limits Sub-admin to own session and permits assigned scanner", async () => {
    const image = new Uint8Array([255, 216, 255, 217]);
    await assertSucceeds(uploadBytes(ref(storageFor("sub", subEmail), "attendance/OWN/sub.jpg"), image, { contentType: "image/jpeg" }));
    await assertFails(uploadBytes(ref(storageFor("sub", subEmail), "attendance/OTHER/sub.jpg"), image, { contentType: "image/jpeg" }));
    await assertSucceeds(uploadBytes(ref(storageFor("scanner", scannerEmail), "attendance/OWN/scan.jpg"), image, { contentType: "image/jpeg" }));
    await assertFails(getBytes(ref(storageFor("outside", outsiderEmail), "attendance/OWN/scan.jpg")));
  });

  test("Leader can read session check-ins; student can read own; unauthorized user cannot", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "checkins", "OWN_52200001"), checkinData());
    });
    await assertSucceeds(getDocs(query(collection(dbFor("leader", leaderEmail), "checkins"), where("sessionId", "==", "OWN"))));
    await assertSucceeds(getDocs(query(collection(dbFor("student", studentEmail), "checkins"), where("email", "==", studentEmail))));
    await assertFails(getDoc(doc(dbFor("outside", outsiderEmail), "checkins", "OWN_52200001")));
  });
});

describe("event attachment Storage isolation", () => {
  const pdf = new Uint8Array([37, 80, 68, 70]);
  const pdfMetadata = { contentType: "application/pdf" };
  const uploadMatrixPath = "event-attachments/ATTACH_OWN/aaaaaaaaaaaaaaaa.pdf";
  const publicReadPath = "event-attachments/ATTACH_OWN/bbbbbbbbbbbbbbbb.pdf";
  const deletedEventPath = "event-attachments/ATTACH_DELETED/cccccccccccccccc.pdf";
  const immutablePath = "event-attachments/ATTACH_OWN/dddddddddddddddd.pdf";
  const deletePath = "event-attachments/ATTACH_OWN/eeeeeeeeeeeeeeee.pdf";

  test("Owner/Admin upload được; Sub-admin chỉ upload vào event của mình", async () => {
    await assertSucceeds(uploadBytes(ref(storageFor("sub", subEmail), uploadMatrixPath), pdf, pdfMetadata));
    await assertFails(uploadBytes(ref(storageFor("sub", subEmail), "event-attachments/ATTACH_OTHER/bcdefghijklmnopq.pdf"), pdf, pdfMetadata));
    await assertSucceeds(uploadBytes(ref(storageFor("admin", adminEmail), "event-attachments/ATTACH_OTHER/cdefghijklmnopqr.pdf"), pdf, pdfMetadata));
    await assertSucceeds(uploadBytes(ref(storageFor("owner", ownerEmail), "event-attachments/ATTACH_OTHER/defghijklmnopqrs.pdf"), pdf, pdfMetadata));
    await assertFails(uploadBytes(ref(storageFor("owner", ownerEmail), "event-attachments/MISSING/efghijklmnopqrst.pdf"), pdf, pdfMetadata));
  });

  test("Student và người chưa đăng nhập đọc được file của event đang hoạt động nhưng không được upload", async () => {
    await assertSucceeds(uploadBytes(ref(storageFor("sub", subEmail), publicReadPath), pdf, pdfMetadata));
    await assertSucceeds(getBytes(ref(storageFor("student", studentEmail), publicReadPath)));
    await assertSucceeds(getBytes(ref(unauthenticatedStorage(), publicReadPath)));
    await assertFails(uploadBytes(ref(storageFor("student", studentEmail), "event-attachments/ATTACH_OWN/fghijklmnopqrstu.pdf"), pdf, pdfMetadata));
    await assertFails(uploadBytes(ref(unauthenticatedStorage(), "event-attachments/ATTACH_OWN/ghijklmnopqrstuv.pdf"), pdf, pdfMetadata));
  });

  test("file của event đã xóa chỉ high Admin đọc được", async () => {
    await assertSucceeds(uploadBytes(ref(storageFor("admin", adminEmail), deletedEventPath), pdf, pdfMetadata));
    await assertFails(getBytes(ref(storageFor("student", studentEmail), deletedEventPath)));
    await assertFails(getBytes(ref(unauthenticatedStorage(), deletedEventPath)));
    await assertSucceeds(getBytes(ref(storageFor("admin", adminEmail), deletedEventPath)));
  });

  test("Rules kiểm tra extension, MIME, kích thước và cấm ghi đè", async () => {
    const storage = storageFor("sub", subEmail);
    await assertFails(uploadBytes(ref(storage, "event-attachments/ATTACH_OWN/ijklmnopqrstuvwx.exe"), pdf, pdfMetadata));
    await assertFails(uploadBytes(ref(storage, "event-attachments/ATTACH_OWN/jklmnopqrstuvwxy.pdf"), pdf, { contentType: "text/html" }));
    await assertFails(uploadBytes(ref(storage, "event-attachments/ATTACH_OWN/short.pdf"), pdf, pdfMetadata));
    await assertFails(uploadBytes(ref(storage, "event-attachments/ATTACH_OWN/klmnopqrstuvwxyz.pdf"), new Uint8Array(20 * 1024 * 1024 + 1), pdfMetadata));
    await assertSucceeds(uploadBytes(ref(storage, immutablePath), pdf, pdfMetadata));
    await assertFails(uploadBytes(ref(storage, immutablePath), new Uint8Array([37, 80, 68, 71]), pdfMetadata));
  });

  test("xóa file theo cùng quyền quản lý event", async () => {
    await assertSucceeds(uploadBytes(ref(storageFor("admin", adminEmail), deletePath), pdf, pdfMetadata));
    await assertFails(deleteObject(ref(storageFor("other-sub", otherSubEmail), deletePath)));
    await assertSucceeds(deleteObject(ref(storageFor("sub", subEmail), deletePath)));
  });
});

describe("canonical check-in and counters", () => {
  test("Phase 1 accepts an old-client canonical check-in without mutation markers", async () => {
    const scanner = dbFor("scanner", scannerEmail);
    const batch = writeBatch(scanner);
    batch.set(doc(scanner, "checkins", "OWN_52200001"), checkinData());
    batch.update(doc(scanner, "attendanceSessions", "OWN"), {
      checkinCount: 1, pendingCount: 0, updatedAt: new Date()
    });
    await assertSucceeds(batch.commit());
  });

  test("Phase 1 accepts old-client pending labelling in place", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "checkins", "OWN_photo_old"), checkinData({ mssv: "" }));
      await updateDoc(doc(context.firestore(), "attendanceSessions", "OWN"), { pendingCount: 1 });
    });
    const scanner = dbFor("scanner", scannerEmail);
    const batch = writeBatch(scanner);
    batch.update(doc(scanner, "checkins", "OWN_photo_old"), {
      mssv: "52200001", name: "Student", email: studentEmail, studentUid: "student"
    });
    batch.update(doc(scanner, "attendanceSessions", "OWN"), {
      checkinCount: 1, pendingCount: 0, updatedAt: new Date()
    });
    await assertSucceeds(batch.commit());
  });

  test("Rules reject lowercase, spaces and punctuation in canonical MSSV", async () => {
    for (const mssv of ["5220abcd", "5220 001", "5220-001"]) {
      const scanner = dbFor("scanner", scannerEmail);
      const batch = writeBatch(scanner);
      batch.set(doc(scanner, "checkins", "OWN_" + mssv), checkinData({ mssv }));
      batch.update(doc(scanner, "attendanceSessions", "OWN"), {
        checkinCount: 1, pendingCount: 0, counterMutationId: "OWN_" + mssv, updatedAt: new Date()
      });
      await assertFails(batch.commit());
    }
  });

  test("Two concurrent devices leave one canonical check-in and count one", async () => {
    const first = dbFor("scanner", scannerEmail);
    const second = dbFor("scanner", scannerEmail);
    await Promise.all([createCanonical(first), createCanonical(second)]);
    const snapshot = await getDoc(doc(first, "attendanceSessions", "OWN"));
    const rows = await getDocs(query(collection(first, "checkins"), where("sessionId", "==", "OWN"), where("mssv", "==", "52200001")));
    assert.equal(snapshot.data().checkinCount, 1);
    assert.equal(rows.docs.filter((item) => !item.data().deletedAt).length, 1);
  });

  test("Pending photo becomes canonical atomically and a competing label does not double count", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "checkins", "OWN_photo_a"), {
        ...checkinData({ mssv: "" }), photoPath: "attendance/OWN/OWN_photo_a.jpg"
      });
      await setDoc(doc(db, "checkins", "OWN_photo_b"), {
        ...checkinData({ mssv: "" }), photoPath: "attendance/OWN/OWN_photo_b.jpg"
      });
      await updateDoc(doc(db, "attendanceSessions", "OWN"), { pendingCount: 2 });
    });
    const scanner = dbFor("scanner", scannerEmail);
    await Promise.all([
      canonicalizePending(scanner, "OWN_photo_a", "52200001"),
      canonicalizePending(scanner, "OWN_photo_b", "52200001")
    ]);
    const session = await getDoc(doc(scanner, "attendanceSessions", "OWN"));
    const canonical = await getDoc(doc(scanner, "checkins", "OWN_52200001"));
    const pendingA = await getDoc(doc(scanner, "checkins", "OWN_photo_a"));
    const pendingB = await getDoc(doc(scanner, "checkins", "OWN_photo_b"));
    assert.equal(session.data().checkinCount, 1);
    assert.equal(session.data().pendingCount, 0);
    assert.equal(canonical.data().deletedAt, null);
    assert.ok(["attendance/OWN/OWN_photo_a.jpg", "attendance/OWN/OWN_photo_b.jpg"].includes(canonical.data().photoPath));
    const winnerIsA = canonical.data().photoPath.endsWith("OWN_photo_a.jpg");
    assert.equal(pendingA.data().photoPath, winnerIsA ? undefined : "attendance/OWN/OWN_photo_a.jpg");
    assert.equal(pendingB.data().photoPath, winnerIsA ? "attendance/OWN/OWN_photo_b.jpg" : undefined);
    assert.ok(pendingA.data().deletedAt);
    assert.ok(pendingB.data().deletedAt);
  });

  test("Soft-deleted canonical is restored once", async () => {
    const scanner = dbFor("scanner", scannerEmail);
    await createCanonical(scanner);
    const leader = dbFor("leader", leaderEmail);
    const remove = writeBatch(leader);
    remove.update(doc(leader, "checkins", "OWN_52200001"), { deletedAt: new Date(), deletedByUid: "leader", deletedByEmail: leaderEmail });
    remove.update(doc(leader, "attendanceSessions", "OWN"), { checkinCount: 0, pendingCount: 0, counterMutationId: "OWN_52200001", updatedAt: new Date() });
    await assertSucceeds(remove.commit());
    await createCanonical(scanner);
    const session = await getDoc(doc(scanner, "attendanceSessions", "OWN"));
    assert.equal(session.data().checkinCount, 1);
    assert.equal((await getDoc(doc(scanner, "checkins", "OWN_52200001"))).data().deletedAt, null);
  });

  test("Legacy pending document with missing pendingCount can be canonicalized", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "checkins", "OWN_photo_legacy"), checkinData({ mssv: "" }));
      await setDoc(doc(db, "attendanceSessions", "OWN"), {
        status: "open", createdByUid: "sub", createdByEmail: subEmail, checkinCount: 0
      });
    });
    await assertSucceeds(canonicalizePending(dbFor("scanner", scannerEmail), "OWN_photo_legacy", "52200002"));
    const session = await getDoc(doc(dbFor("scanner", scannerEmail), "attendanceSessions", "OWN"));
    assert.equal(session.data().checkinCount, 1);
    assert.equal(session.data().pendingCount, 0);
  });

  test("Legacy pending document with missing pendingCount can be soft-deleted without a negative counter", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "checkins", "OWN_photo_delete"), checkinData({ mssv: "" }));
      await setDoc(doc(db, "attendanceSessions", "OWN"), {
        status: "open", createdByUid: "sub", createdByEmail: subEmail, checkinCount: 0
      });
    });
    const db = dbFor("leader", leaderEmail);
    await assertSucceeds(runTransaction(db, async (transaction) => {
      transaction.update(doc(db, "checkins", "OWN_photo_delete"), {
        deletedAt: new Date(), deletedByUid: "leader", deletedByEmail: leaderEmail
      });
      transaction.update(doc(db, "attendanceSessions", "OWN"), {
        checkinCount: 0, pendingCount: 0, counterMutationId: "OWN_photo_delete", updatedAt: new Date()
      });
    }));
  });
});

describe("registration integrity and legacy data", () => {
  async function runRegistrationTransaction(db, operation) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await runTransaction(db, operation);
      } catch (error) {
        const permissionDenied = error?.code === "permission-denied" || error?.code === "firestore/permission-denied";
        if (!permissionDenied || attempt === 1) throw error;
      }
    }
  }

  async function seedEvent({ grouped = false, withLimit = false } = {}) {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      if (grouped) await setDoc(doc(db, "eventGroups", "G"), { name: "Group", maxRegistrations: 2, unlimited: false });
      await setDoc(doc(db, "events", "E"), {
        title: "Event", status: "open", registeredCount: 0, capacity: 10,
        allowCancellation: true, allowedFaculties: ["IFA"],
        groupId: grouped ? "G" : "", groupName: grouped ? "Group" : "",
        groupMaxRegistrations: grouped ? 2 : 1,
        createdByUid: "admin", createdByEmail: adminEmail, createdAt: new Date(),
        openAt: null, closeAt: null
      });
      if (withLimit) await setDoc(doc(db, "registrationLimits", "student_G"), {
        uid: "student", email: studentEmail, groupId: "G", groupName: "Group",
        maxRegistrations: 2, count: 0, eventIds: []
      });
    });
  }

  test("Student registration create/delete keeps event and group counts consistent", async () => {
    await seedEvent({ grouped: true, withLimit: true });
    const db = dbFor("student", studentEmail);
    const registrationRef = doc(db, "registrations", "student_E");
    const eventRef = doc(db, "events", "E");
    const limitRef = doc(db, "registrationLimits", "student_G");
    await assertSucceeds(runTransaction(db, async (transaction) => {
      transaction.update(eventRef, { registeredCount: 1, registrationMutationId: "student_E", updatedAt: new Date() });
      transaction.set(registrationRef, {
        uid: "student", email: studentEmail, identifier: "52200001", mssv: "52200001",
        participantType: "student", name: "Student", phone: "", faculty: "IFA", major: "",
        eventId: "E", eventTitle: "Event", eventDate: "", eventCreatorUid: "admin",
        groupId: "G", groupName: "Group", createdAt: new Date()
      });
      transaction.set(limitRef, {
        uid: "student", email: studentEmail, groupId: "G", groupName: "Group",
        maxRegistrations: 2, count: 1, eventIds: ["E"], updatedAt: new Date()
      });
    }));
    await assertSucceeds(runTransaction(db, async (transaction) => {
      transaction.update(eventRef, { registeredCount: 0, registrationMutationId: "student_E", updatedAt: new Date() });
      transaction.delete(registrationRef);
      transaction.update(limitRef, { count: 0, eventIds: [], updatedAt: new Date() });
    }));
  });

  test("Phase 1 accepts old-client registration create/delete without mutation markers", async () => {
    await seedEvent();
    const db = dbFor("student", studentEmail);
    const registrationRef = doc(db, "registrations", "student_E");
    const eventRef = doc(db, "events", "E");
    await assertSucceeds(runTransaction(db, async (transaction) => {
      transaction.update(eventRef, { registeredCount: 1, updatedAt: new Date() });
      transaction.set(registrationRef, {
        uid: "student", email: studentEmail, identifier: "52200001", mssv: "52200001",
        participantType: "student", name: "Student", phone: "", faculty: "IFA", major: "",
        eventId: "E", eventTitle: "Event", eventDate: "", eventCreatorUid: "admin",
        groupId: "", groupName: "", createdAt: new Date()
      });
    }));
    await assertSucceeds(runTransaction(db, async (transaction) => {
      transaction.update(eventRef, { registeredCount: 0, updatedAt: new Date() });
      transaction.delete(registrationRef);
    }));
  });

  test("Concurrent students register and cancel without losing event counter updates", async () => {
    await seedEvent();
    const register = async (uid, email, mssv) => {
      const db = dbFor(uid, email);
      const eventRef = doc(db, "events", "E");
      const registrationRef = doc(db, "registrations", `${uid}_E`);
      await runRegistrationTransaction(db, async (transaction) => {
        const event = await transaction.get(eventRef);
        const registration = await transaction.get(registrationRef);
        if (registration.exists()) return;
        transaction.update(eventRef, {
          registeredCount: increment(1),
          registrationMutationId: registrationRef.id, updatedAt: serverTimestamp()
        });
        transaction.set(registrationRef, {
          uid, email, identifier: mssv, mssv, participantType: "student", name: uid,
          phone: "", faculty: "IFA", major: "", eventId: "E", eventTitle: "Event",
          eventDate: "", eventCreatorUid: "admin", groupId: "", groupName: "", createdAt: new Date()
        });
      });
    };
    await Promise.all([
      register("student", studentEmail, "52200001"),
      register("student2", student2Email, "52200002")
    ]);
    assert.equal((await getDoc(doc(dbFor("student", studentEmail), "events", "E"))).data().registeredCount, 2);

    const cancel = async (uid, email) => {
      const db = dbFor(uid, email);
      const eventRef = doc(db, "events", "E");
      const registrationRef = doc(db, "registrations", `${uid}_E`);
      await runRegistrationTransaction(db, async (transaction) => {
        const event = await transaction.get(eventRef);
        const registration = await transaction.get(registrationRef);
        if (!registration.exists()) return;
        transaction.update(eventRef, {
          registeredCount: increment(-1),
          registrationMutationId: registrationRef.id, updatedAt: serverTimestamp()
        });
        transaction.delete(registrationRef);
      });
    };
    await Promise.all([cancel("student", studentEmail), cancel("student2", student2Email)]);
    assert.equal((await getDoc(doc(dbFor("student", studentEmail), "events", "E"))).data().registeredCount, 0);
  });

  test("Admin can delete legacy grouped registration when registrationLimits is missing", async () => {
    await seedEvent({ grouped: true });
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await updateDoc(doc(db, "events", "E"), { registeredCount: 1 });
      await setDoc(doc(db, "registrations", "student_E"), {
        uid: "student", email: studentEmail, eventId: "E", groupId: "G"
      });
    });
    const db = dbFor("admin", adminEmail);
    await assertSucceeds(runTransaction(db, async (transaction) => {
      transaction.update(doc(db, "events", "E"), { registeredCount: 0, registrationMutationId: "student_E", updatedAt: new Date() });
      transaction.delete(doc(db, "registrations", "student_E"));
    }));
    assert.equal((await getDoc(doc(db, "events", "E"))).data().registeredCount, 0);
  });

  test("Deleting a registration without its event counter update is denied", async () => {
    await seedEvent();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await updateDoc(doc(db, "events", "E"), { registeredCount: 1 });
      await setDoc(doc(db, "registrations", "student_E"), {
        uid: "student", email: studentEmail, eventId: "E", groupId: ""
      });
    });
    await assertFails(deleteDoc(doc(dbFor("admin", adminEmail), "registrations", "student_E")));
  });

  test("Admin can delete an orphan legacy registration whose event no longer exists", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "registrations", "student_MISSING"), {
        uid: "student", email: studentEmail, eventId: "MISSING", groupId: ""
      });
    });
    await assertSucceeds(deleteDoc(doc(dbFor("admin", adminEmail), "registrations", "student_MISSING")));
  });
});
