import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction,
  setDoc, updateDoc, where, writeBatch
} from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

const projectId = "ifaa-rules-test";
const ownerEmail = "tranquanghai@tdtu.edu.vn";
const adminEmail = "admin@tdtu.edu.vn";
const legacyAdminEmail = "legacy@tdtu.edu.vn";
const subEmail = "sub@tdtu.edu.vn";
const otherSubEmail = "other-sub@tdtu.edu.vn";
const scannerEmail = "scanner@student.tdtu.edu.vn";
const leaderEmail = "leader@student.tdtu.edu.vn";
const studentEmail = "student@student.tdtu.edu.vn";
const outsiderEmail = "outside@example.com";
let env;

const auth = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true });
const dbFor = (uid, email) => auth(uid, email).firestore();
const storageFor = (uid, email) => auth(uid, email).storage();

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
  await runTransaction(db, async (transaction) => {
    const sessionRef = doc(db, "attendanceSessions", "OWN");
    const checkinRef = doc(db, "checkins", id);
    const [sessionSnapshot, checkinSnapshot] = await Promise.all([
      transaction.get(sessionRef), transaction.get(checkinRef)
    ]);
    if (checkinSnapshot.exists() && !checkinSnapshot.data().deletedAt) return;
    transaction.set(checkinRef, checkinData({ mssv, scannerUid, scanner }));
    transaction.update(sessionRef, {
      checkinCount: Number(sessionSnapshot.data().checkinCount || 0) + 1,
      pendingCount: Number(sessionSnapshot.data().pendingCount || 0),
      counterMutationId: id,
      updatedAt: new Date()
    });
  });
}

async function canonicalizePending(db, sourceId, mssv) {
  const targetId = "OWN_" + mssv;
  return runTransaction(db, async (transaction) => {
    const sourceRef = doc(db, "checkins", sourceId);
    const targetRef = doc(db, "checkins", targetId);
    const sessionRef = doc(db, "attendanceSessions", "OWN");
    const [source, target, session] = await Promise.all([
      transaction.get(sourceRef), transaction.get(targetRef), transaction.get(sessionRef)
    ]);
    const targetActive = target.exists() && !target.data().deletedAt;
    if (!targetActive) transaction.set(targetRef, { ...source.data(), mssv, deletedAt: null, deletedByUid: "", deletedByEmail: "" });
    transaction.update(sourceRef, { deletedAt: new Date(), deletedByUid: "scanner", deletedByEmail: scannerEmail });
    transaction.update(sessionRef, {
      checkinCount: Number(session.data().checkinCount || 0) + (targetActive ? 0 : 1),
      pendingCount: Math.max(0, Number(session.data().pendingCount || 0) - 1),
      counterMutationId: targetId,
      counterSourceId: sourceId,
      updatedAt: new Date()
    });
    return targetActive;
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") }
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

describe("canonical check-in and counters", () => {
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
      await setDoc(doc(db, "checkins", "OWN_photo_a"), checkinData({ mssv: "" }));
      await setDoc(doc(db, "checkins", "OWN_photo_b"), checkinData({ mssv: "" }));
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
});
