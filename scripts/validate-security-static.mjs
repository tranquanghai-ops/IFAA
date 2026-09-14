import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const firestore = read("firestore.rules");
const storage = read("storage.rules");
const admin = read("admin/admin.mjs");
const checkin = read("check-in/check-in.mjs");
const pages = read(".github/workflows/pages.yml");

assert.match(firestore, /function managesSessionAfter\(sessionId\)/);
assert.match(firestore, /allow create: if managesSessionAfter\(request\.resource\.data\.sessionId\)/);
assert.match(firestore, /value\.matches\('\^\[A-Z0-9\]\{8,12\}\$'\)/);
assert.match(firestore, /function canonicalizationLinked\(sessionId\)/);
assert.match(firestore, /counterSourceId/);
assert.match(firestore, /validRegistrationZeroCleanup/);
assert.match(storage, /data\.get\('role', 'admin'\) != 'subadmin'/);
assert.doesNotMatch(storage, /storageAdminAccess/);
assert.match(admin, /const liveCheckin = checkinSnapshot\.data\(\)/);
assert.match(admin, /failed\.push\(\{ id: item\.id/);
assert.match(admin, /transaction\.set\(canonicalRef/);
assert.match(checkin, /transaction\.set\(canonicalRef/);
assert.match(checkin, /where\("mssv", "==", record\.mssv\)/);
assert.match(pages, /workflow_run:/);
assert.match(pages, /workflow_run\.conclusion == 'success'/);

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
