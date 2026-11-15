// Turns an `expo export --platform android` folder into an over-the-air update
// that phones fetch from the repository's `android-app` GitHub release:
// the release holds every asset under a flat, content-hashed name, plus
// ota-<runtimeVersion>.json, the Expo Updates manifest the server hands to
// expo-updates (see artifacts/api-server/src/routes/app-updates.ts).
//
//   node scripts/publish-app-update.mjs <export-dir> <out-dir> <asset-base-url> <backend-host>
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [exportDir, outDir, baseUrl, backendHost] = process.argv.slice(2);
if (!exportDir || !outDir || !/^https:\/\//.test(baseUrl ?? "") || !backendHost) {
  throw new Error("Usage: publish-app-update.mjs <export-dir> <out-dir> <https asset base url> <backend-host>");
}
const appDir = path.resolve("exports/GST-Pro-Android");
const appJson = JSON.parse(await fs.readFile(path.join(appDir, "app.json"), "utf8"));
const runtimeVersion = appJson.expo.runtimeVersion;
if (!/^[A-Za-z0-9._-]{1,32}$/.test(runtimeVersion ?? "")) throw new Error("app.json needs a plain expo.runtimeVersion.");

const metadataRaw = await fs.readFile(path.join(exportDir, "metadata.json"));
const files = JSON.parse(metadataRaw.toString("utf8")).fileMetadata.android;
await fs.mkdir(outDir, { recursive: true });

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ttf: "font/ttf", otf: "font/otf", json: "application/json" };

async function asset(relative, ext, launch) {
  const bytes = await fs.readFile(path.join(exportDir, relative));
  const key = crypto.createHash("md5").update(bytes).digest("hex");
  const name = launch ? `bundle-${key}.hbc` : `asset-${key}.${ext}`;
  await fs.writeFile(path.join(outDir, name), bytes);
  return {
    hash: b64url(crypto.createHash("sha256").update(bytes).digest()),
    key,
    fileExtension: launch ? ".bundle" : `.${ext}`,
    contentType: launch ? "application/javascript" : TYPES[ext] ?? "application/octet-stream",
    url: `${baseUrl}/${name}`,
    bytes,
  };
}

const launchAsset = await asset(files.bundle, null, true);
if (!launchAsset.bytes.includes(Buffer.from(backendHost))) {
  throw new Error(`The bundle does not contain ${backendHost}; refusing to publish it.`);
}
const assets = await Promise.all(files.assets.map((a) => asset(a.path, a.ext, false)));
const hex = crypto.createHash("sha256").update(metadataRaw).update("android").digest("hex");
const expoClient = JSON.parse(execFileSync(path.join(appDir, "node_modules/.bin/expo"), ["config", "--type", "public", "--json"], { cwd: appDir, encoding: "utf8" }));
const strip = ({ bytes, ...rest }) => rest;
const manifest = {
  id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
  createdAt: new Date().toISOString(),
  runtimeVersion,
  launchAsset: strip(launchAsset),
  assets: assets.map(strip),
  metadata: {},
  extra: { expoClient },
};
await fs.writeFile(path.join(outDir, `ota-${runtimeVersion}.json`), JSON.stringify(manifest));
console.log(`Over-the-air update ${manifest.id} for runtime ${runtimeVersion}: ${assets.length + 1} files in ${outDir}.`);
