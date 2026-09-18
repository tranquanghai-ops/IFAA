import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("check-in/check-in.mjs", "utf8");
const html = readFileSync("check-in/index.html", "utf8");

test("ảnh camera dùng canvas Blob với fallback Safari và giữ preview", () => {
  assert.match(source, /canvas\.toBlob\(/);
  assert.match(source, /if \(!canvas\.toBlob\)/);
  assert.match(source, /if \(!blob\) \{/);
  assert.match(source, /reader\.readAsDataURL\(blob\)/);
  assert.match(source, /const photo = await encodePhoto\(canvas\)[\s\S]*pendingPhoto = photo/);
  assert.match(source, /#photoPreview"\)\.src = pendingPhoto/);
  assert.doesNotMatch(source, /fetch\(dataUrl\)/);
  assert.match(source, /const blob = dataUrlToBlob\(dataUrl\)/);
});

test("hàng đợi ảnh còn hoạt động khi iOS từ chối localStorage", () => {
  assert.match(source, /let memoryOutboxes = new Map\(\)/);
  assert.match(source, /if \(memory\.length\) return memory/);
  assert.match(source, /catch \{ return memory; \}/);
  assert.match(source, /memoryOutboxes\.set\(key, items\)/);
  assert.match(source, /photoData: pendingPhoto/);
  assert.match(source, /uploadCheckinPhoto\(photoObjectId, record\.photoData\)/);
});

test("đóng dialog vô hiệu hóa capture async cũ và không làm ảnh xuất hiện lại", () => {
  assert.match(source, /const request = \+\+photoCaptureRequest/);
  assert.match(source, /if \(request !== photoCaptureRequest\) return/);
  assert.match(source, /#closePhotoDialog"\)\.onclick = \(\) => \{ photoCaptureRequest \+= 1; pendingPhoto = ""/);
});

test("AudioContext được unlock từ thao tác bật camera và nút thử âm", () => {
  assert.match(source, /window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.match(source, /if \(audio\.state === "suspended"\) await audio\.resume\(\)/);
  assert.match(source, /await unlockScanAudio\(\);[\s\S]*releaseCamera\(\)/);
  assert.match(source, /#testSuccess"\)\.onclick = async \(\) => \{ await unlockScanAudio\(\); feedback\(true\); \}/);
  assert.match(source, /navigator\.vibrate/);
});

test("cache bust check-in trỏ tới bản media mới", () => {
  assert.match(html, /check-in\.mjs\?v=23/);
});
