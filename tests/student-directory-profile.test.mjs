import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const studentSource = readFileSync("student.mjs", "utf8");
const pageSource = readFileSync("index.html", "utf8");
const styleSource = readFileSync("styles.css", "utf8");

test("danh sách sinh viên được ưu tiên và khóa khoa, ngành, họ tên đã có", () => {
  assert.match(studentSource, /function directoryProfileFields\(\)/);
  assert.match(studentSource, /faculty: String\(facultyStudent\.faculty \|\| DEFAULT_FACULTY\)/);
  assert.match(studentSource, /const sourceFaculty = directory\.faculty \|\| profile\?\.faculty/);
  assert.match(studentSource, /const savedMajor = directory\.major \|\| normalizeFacultyMajor\(profile\?\.major\)/);
  assert.match(studentSource, /control\.disabled = locked/);
  assert.match(studentSource, /#profileName"\)\.readOnly = !!directory\.name/);
});

test("payload lưu không thể ghi đè dữ liệu chính thức từ danh sách sinh viên", () => {
  assert.match(studentSource, /const faculty = directory\.faculty \|\| selectedFacultyValue\(\)/);
  assert.match(studentSource, /const major = directory\.major \|\|/);
  assert.match(studentSource, /name: directory\.name \|\| \$\("#profileName"\)\.value\.trim\(\)/);
});

test("ngành dạng ngắn trong danh sách được ánh xạ sang lựa chọn biểu mẫu", () => {
  assert.match(studentSource, /function normalizeFacultyMajor\(value\)/);
  assert.match(studentSource, /replace\(\/\^ngành\\s\+\//);
});

test("header hiển thị tên phía trên và email nhỏ phía dưới", () => {
  assert.match(pageSource, /id="accountIdentity"[\s\S]*id="accountName"[\s\S]*id="accountEmail"/);
  assert.match(studentSource, /function renderAccountIdentity\(\)/);
  assert.match(styleSource, /\.account-identity\{display:grid/);
  assert.match(styleSource, /\.account-name\{font-size:15px/);
  assert.match(styleSource, /\.account-email\{font-size:12px/);
});

test("trường hồ sơ đã khóa có giao diện rõ ràng và select không còn mũi tên", () => {
  assert.match(styleSource, /#profileForm input:read-only,#profileForm select:disabled/);
  assert.match(styleSource, /#profileFaculty:disabled,#profileMajor:disabled/);
  assert.match(styleSource, /appearance:none/);
  assert.match(styleSource, /background-image:none/);
  assert.match(studentSource, /safe\(name\.replace\(\/\^Ngành\\s\+\//);
});
