import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const next = process.argv[index + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    index += 1;
  } else {
    args.set(key, true);
  }
}

const sourceProject = args.get("--source") || "ifahr-faf5d";
const targetProject = args.get("--target") || "ifa-activities";
const dryRun = args.has("--dry-run");

if (sourceProject === targetProject) {
  throw new Error("Project nguồn và project đích không được trùng nhau.");
}

const credential = applicationDefault();
const sourceApp = initializeApp({ credential, projectId: sourceProject }, "source");
const targetApp = initializeApp({ credential, projectId: targetProject }, "target");
const sourceDb = getFirestore(sourceApp);
const targetDb = getFirestore(targetApp);

sourceDb.settings({ ignoreUndefinedProperties: true });
targetDb.settings({ ignoreUndefinedProperties: true });

let copiedDocuments = 0;
let discoveredCollections = 0;

async function copyCollection(sourceCollection) {
  discoveredCollections += 1;
  const snapshot = await sourceCollection.get();
  console.log(`- ${sourceCollection.path}: ${snapshot.size} tài liệu`);

  if (!dryRun) {
    for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
      const batch = targetDb.batch();
      for (const sourceDocument of snapshot.docs.slice(offset, offset + 400)) {
        batch.set(targetDb.doc(sourceDocument.ref.path), sourceDocument.data());
      }
      await batch.commit();
    }
  }

  copiedDocuments += snapshot.size;

  for (const sourceDocument of snapshot.docs) {
    const childCollections = await sourceDocument.ref.listCollections();
    for (const childCollection of childCollections) {
      await copyCollection(childCollection);
    }
  }
}

try {
  console.log(`Nguồn: ${sourceProject}`);
  console.log(`Đích: ${targetProject}`);
  console.log(dryRun ? "Chế độ: kiểm tra, chưa ghi dữ liệu" : "Chế độ: sao chép/cập nhật dữ liệu");

  const rootCollections = await sourceDb.listCollections();
  if (rootCollections.length === 0) {
    throw new Error("Không tìm thấy collection nào trong Firestore nguồn.");
  }

  for (const collection of rootCollections) {
    await copyCollection(collection);
  }

  console.log(`Hoàn tất: ${copiedDocuments} tài liệu trong ${discoveredCollections} collection.`);
  if (dryRun) console.log("Không có dữ liệu nào được ghi vì đang dùng --dry-run.");
} finally {
  await Promise.all([deleteApp(sourceApp), deleteApp(targetApp)]);
}
