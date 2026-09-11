import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const project = process.argv[2] || "ifa-activities";
const content = await readFile("firestore.rules", "utf8");
const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const createResponse = await fetch(`https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`, {
  method: "POST",
  headers,
  body: JSON.stringify({ source: { files: [{ name: "firestore.rules", content }] } })
});
if (!createResponse.ok) throw new Error(`Create ruleset failed: ${createResponse.status} ${await createResponse.text()}`);
const ruleset = await createResponse.json();

const releaseName = `projects/${project}/releases/cloud.firestore`;
const releaseResponse = await fetch(`https://firebaserules.googleapis.com/v1/${releaseName}?updateMask=ruleset_name`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ name: releaseName, rulesetName: ruleset.name })
});
if (!releaseResponse.ok) throw new Error(`Release ruleset failed: ${releaseResponse.status} ${await releaseResponse.text()}`);
console.log("Firestore Rules deployed:", ruleset.name);
