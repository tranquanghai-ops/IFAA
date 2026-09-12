import { ref, getBytes, uploadBytes } from "https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js";

const CACHE_DB = "ifaa-faculty-dataset";
const CACHE_STORE = "datasets";
const CACHE_KEY = "current";
export const FACULTY_DATASET_PATH = "datasets/faculty-students.json.gz";

function openCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(CACHE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function cacheGet() {
  if (!("indexedDB" in window)) return null;
  try {
    const database = await openCache();
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(CACHE_STORE, "readonly");
      const request = transaction.objectStore(CACHE_STORE).get(CACHE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    });
  } catch {
    return null;
  }
}

async function cachePut(value) {
  if (!("indexedDB" in window)) return;
  try {
    const database = await openCache();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(CACHE_STORE, "readwrite");
      transaction.objectStore(CACHE_STORE).put(value, CACHE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {
    // IndexedDB có thể bị chặn trong chế độ riêng tư; dữ liệu vẫn dùng được trong bộ nhớ.
  }
}

async function gzip(text) {
  if (!("CompressionStream" in window)) throw Error("Trình duyệt chưa hỗ trợ tạo dữ liệu nén.");
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  if (!("DecompressionStream" in window)) throw Error("Trình duyệt chưa hỗ trợ giải nén danh sách sinh viên.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function normalizeRows(value) {
  const rows = Array.isArray(value) ? value : value?.students;
  if (!Array.isArray(rows)) throw Error("Dữ liệu danh sách sinh viên không hợp lệ.");
  return rows.filter((item) => item && item.mssv).map((item) => ({
    mssv: String(item.mssv).trim().toUpperCase(),
    name: String(item.name || "").trim(),
    email: String(item.email || "").trim().toLowerCase(),
    gender: String(item.gender || "").trim(),
    major: String(item.major || "").trim(),
    studentClass: String(item.studentClass || "").trim(),
    admissionYear: item.admissionYear || "",
    course: item.course || ""
  }));
}

export async function loadFacultyDataset(storage, metadata = {}, { force = false } = {}) {
  const version = Number(metadata.datasetVersion || 0);
  const path = metadata.datasetPath || FACULTY_DATASET_PATH;
  if (!version || !path) return [];
  if (!force) {
    const cached = await cacheGet();
    if (Number(cached?.version) === version && Array.isArray(cached.rows)) return cached.rows;
  }
  const bytes = await getBytes(ref(storage, path), 12 * 1024 * 1024);
  const rows = normalizeRows(JSON.parse(await gunzip(bytes)));
  await cachePut({ version, rows, cachedAt: Date.now() });
  return rows;
}

export async function publishFacultyDataset(storage, records, version = Date.now()) {
  const rows = normalizeRows(records);
  const payload = JSON.stringify({ schemaVersion: 1, version, students: rows });
  const compressed = await gzip(payload);
  const path = `datasets/faculty-students-${version}.json.gz`;
  await uploadBytes(ref(storage, path), compressed, {
    contentType: "application/gzip",
    cacheControl: "private, max-age=0, no-cache",
    customMetadata: { version: String(version), records: String(rows.length) }
  });
  await cachePut({ version, rows, cachedAt: Date.now() });
  return { version, path, count: rows.length, bytes: compressed.byteLength };
}
