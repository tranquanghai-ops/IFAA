import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const admin = readFileSync("admin/admin.mjs", "utf8");
const html = readFileSync("admin/index.html", "utf8");
const events = readFileSync("admin/modules/events/event-service.mjs", "utf8");
const groups = readFileSync("admin/modules/groups/group-service.mjs", "utf8");

test("mỗi bảng Trash có select all và bulk button độc lập", () => {
  for (const kind of ["events", "attendance", "groups"]) assert.match(html, new RegExp(`data-trash-select-all="${kind}"`));
  assert.match(html, /id="purgeEventsSelected"[^>]*disabled/);
  assert.match(html, /id="purgeAttendanceSelected"[^>]*disabled/);
  assert.match(html, /id="purgeGroupsSelected"[^>]*disabled/);
});

test("selection chỉ áp dụng item đang trong từng bảng và cập nhật indeterminate", () => {
  assert.match(admin, /function trashItems\(kind\)/);
  assert.match(admin, /trashSelection\[kind\] = all\.checked \? new Set\(trashItems\(kind\)\.map/);
  assert.match(admin, /all\.indeterminate = selected > 0 && selected < ids\.size/);
});

test("bulk delete tái sử dụng hard-delete hiện có, xử lý partial failure và chống double-click", () => {
  assert.match(admin, /if \(!canBulkPurge\(kind\) \|\| trashBulkBusy\[kind\]\) return;/);
  assert.match(admin, /if \(kind === "events"\) await permanentlyDeleteEvent\(item\)/);
  assert.match(admin, /else if \(kind === "attendance"\) await permanentlyDeleteAttendance\(item\)/);
  assert.match(admin, /else await permanentlyDeleteGroup\(item\)/);
  assert.match(admin, /Đã xóa \$\{succeeded\}\/\$\{selected\.length\} mục/);
});

test("single purge hiện có vẫn giữ nguyên và checkbox được render cho ba loại", () => {
  assert.match(events, /data-purge-event=/);
  assert.match(groups, /data-purge-group=/);
  assert.match(admin, /data-purge-attendance=/);
  assert.match(events, /data-trash-select="events"/);
  assert.match(groups, /data-trash-select="groups"/);
  assert.match(admin, /data-trash-select="attendance"/);
});
