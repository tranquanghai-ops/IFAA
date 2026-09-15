import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const firestore = read("firestore.rules");
const storage = read("storage.rules");
const admin = read("admin/admin.mjs");
const adminEvents = read("admin/modules/events/event-service.mjs");
const adminAttachments = read("admin/modules/events/event-attachment-service.mjs");
const adminExports = read("admin/modules/exports/export-service.mjs");
const adminGroups = read("admin/modules/groups/group-service.mjs");
const adminRegistrations = read("admin/modules/registrations/registration-service.mjs");
const adminStudents = read("admin/modules/students/student-service.mjs");
const registrationForm = read("registration-form.mjs");
const student = read("student.mjs");
const checkin = read("check-in/check-in.mjs");
const pages = read(".github/workflows/pages.yml");
const firebaseDeploy = read(".github/workflows/firebase-hosting-merge.yml");

assert.match(firestore, /function managesSessionAfter\(sessionId\)/);
assert.match(firestore, /allow create: if managesSessionAfter\(request\.resource\.data\.sessionId\)/);
assert.match(firestore, /value\.matches\('\^\[A-Z0-9\]\{8,12\}\$'\)/);
assert.match(firestore, /function canonicalizationSessionLinked\(sessionId\)/);
assert.match(firestore, /function canonicalizationTargetLinked\(checkinId, sessionId\)/);
assert.match(firestore, /function canonicalizationSourceLinked\(checkinId, sessionId\)/);
assert.match(firestore, /counterSourceId/);
assert.match(firestore, /validRegistrationZeroCleanup/);
assert.match(storage, /data\.get\('role', 'admin'\) != 'subadmin'/);
assert.match(storage, /function exportCacheAdmin\(\)/);
assert.match(storage, /data\.get\('role', ''\) == 'admin'/);
assert.match(storage, /match \/exports\/\{exportType\}\/\{exportFile\}[\s\S]*allow read: if exportCacheAdmin\(\);[\s\S]*allow create, update: if exportCacheAdmin\(\)/);
assert.match(storage, /match \/event-attachments\/\{eventId\}\/\{attachmentFile\}[\s\S]*allow read: if highAdmin\(\) \|\| downloadableEvent\(eventId\);[\s\S]*allow create: if managesEvent\(eventId\)[\s\S]*allow update: if false;[\s\S]*allow delete: if managesEvent\(eventId\);/);
assert.match(storage, /request\.resource\.size <= 20 \* 1024 \* 1024/);
assert.match(storage, /allow create: if managesEvent\(eventId\)[\s\S]*resource == null/);
assert.doesNotMatch(storage, /storageAdminAccess/);
assert.match(admin, /canUseStorageCache: highAdminAccess/);
assert.match(admin, /createAdminEventService\(/);
assert.match(admin, /createEventAttachmentService\(/);
assert.match(admin, /prepareAttachmentSave\(eventRef\.id\)/);
assert.match(admin, /rollbackAttachmentSave\(attachmentSave\)/);
assert.match(adminAttachments, /uploadBytesResumable/);
assert.match(adminAttachments, /event-attachments\/\$\{targetEventId\}/);
assert.match(adminAttachments, /for \(const item of pending\) uploaded\.push\(await uploadOne\(targetEventId, item\)\)/);
assert.match(adminAttachments, /await deletePaths\(uploaded\.map\(\(item\) => item\.storagePath\)\)\.catch/);
assert.doesNotMatch(adminAttachments, /getDownloadURL/);
assert.doesNotMatch(student, /uploadBytes|uploadBytesResumable|deleteObject/);
assert.match(admin, /createAdminGroupService\(/);
assert.match(admin, /createAdminRegistrationService\(/);
assert.match(admin, /createAdminStudentService\(/);
assert.match(admin, /fetchRegistrations,/);
assert.match(adminExports, /async function downloadCachedWorkbook\(path, version\) \{\s*if \(!canUseStorageCache\(\)\) return false;/);
assert.match(adminExports, /if \(!canUseStorageCache\(\)\) \{\s*downloadWorkbookBytes\(artifact\.filename, artifact\.bytes\);\s*return false;/);
assert.match(adminRegistrations, /doc\(db, "registrations", registration\.id\)/);
assert.match(adminRegistrations, /doc\(db, "registrationLimits", `\$\{liveRegistration\.uid\}_\$\{liveRegistration\.groupId\}`\)/);
assert.match(adminRegistrations, /registeredCount: Math\.max\(0, Number\(eventSnapshot\.data\(\)\.registeredCount \|\| 0\) - 1\)/);
assert.match(adminRegistrations, /transaction\.delete\(registrationRef\)/);
assert.match(adminEvents, /query\(collection\(db, "events"\), where\("createdByUid", "==", user\.uid\)\)/);
assert.match(adminEvents, /const canManage = !getIsSubAdmin\(\) \|\| event\.createdByUid === user\.uid/);
assert.match(adminEvents, /updateDoc\(doc\(db, "events", selected\.id\), \{\s*deletedAt: serverTimestamp\(\), deletedByUid: user\.uid, deletedByEmail: user\.email/);
assert.match(adminEvents, /if \(!selected \|\| !getIsOwner\(\)\) throw Error\("Chỉ Chủ sở hữu được xóa vĩnh viễn\."\)/);
assert.match(adminGroups, /getFetchRegistrations\(\)\("groupId", id\)/);
assert.match(adminGroups, /updateDoc\(doc\(db, "eventGroups", id\), data\)/);
assert.match(adminGroups, /updateDoc\(doc\(db, "events", item\.id\), \{ groupName: name, groupMaxRegistrations: effectiveMax/);
assert.doesNotMatch(adminGroups, /from ["'][^"']*admin\.mjs["']/);
assert.match(adminStudents, /if \(!hasHighAdminAccess\(\)\) throw Error\("Chỉ Chủ sở hữu hoặc Admin cấp cao được cập nhật danh sách SV khoa\."\)/);
assert.match(adminStudents, /batch\.set\(doc\(db, "facultyStudents", item\.mssv\)/);
assert.match(adminStudents, /setDoc\(doc\(db, "facultyStudentMeta", "current"\)/);
assert.doesNotMatch(adminStudents, /from ["'][^"']*admin\.mjs["']/);
assert.match(adminStudents, /const publicRows = rows\.map\(\(\{ personalEmail, phone, \.\.\.item \}\) => item\)/);
assert.match(registrationForm, /role === "subadmin" && !!uid && event\.createdByUid === uid/);
assert.match(student, /transaction\.set\(registrationRef, \{ \.\.\.participant,[\s\S]*answers: currentSubmission\?\.answers \|\| \{\}, profileSnapshot: participant, registrationFormSnapshot: registrationFormSnapshot\(event\)/);
assert.match(admin, /const liveCheckin = checkinSnapshot\.data\(\)/);
assert.match(admin, /failed\.push\(\{ id: item\.id/);
assert.match(admin, /transaction\.set\(canonicalRef/);
assert.match(checkin, /transaction\.set\(canonicalRef/);
assert.match(checkin, /where\("mssv", "==", record\.mssv\)/);
assert.match(checkin, /const photoObjectId = record\.mssv \? `\$\{checkinRef\.id\}_\$\{record\.requestId\}` : checkinRef\.id/);
assert.match(pages, /workflow_run:/);
assert.match(pages, /workflow_run\.conclusion == 'success'/);
assert.ok(firebaseDeploy.indexOf("pnpm test:rules") < firebaseDeploy.indexOf("Authenticate Firebase service account"));

for (const [name, source] of [["firestore.rules", firestore], ["storage.rules", storage]]) {
  const stripped = source
    .replace(/\/\/.*$/gm, "")
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
  const stack = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };
  for (const char of stripped) {
    if ("([{".includes(char)) stack.push(char);
    else if (")]}".includes(char)) assert.equal(stack.pop(), pairs[char], `${name}: unbalanced ${char}`);
  }
  assert.equal(stack.length, 0, `${name}: unclosed delimiter`);
}

console.log("Static security assertions passed.");
