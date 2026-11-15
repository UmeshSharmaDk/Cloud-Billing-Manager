// Prepares exports/GST-Pro-Android for a release build: bakes in the backend
// hostname, sets the version code, and regenerates the native project with
// `expo prebuild`. Mirrors the CRM's refresh script; this app has no separate
// workspace source, so nothing is copied in.
//
//   node scripts/refresh-android-build.mjs <backend-host>
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const target = path.join(process.cwd(), "exports/GST-Pro-Android");
const backendHost = process.argv[2];
if (!backendHost || !/^[a-z0-9.-]+$/i.test(backendHost)) {
  throw new Error("Pass the backend hostname without https://, /api, or a trailing slash.");
}
await fs.writeFile(path.join(target, ".env"),
  `# Public backend hostname only. Never put backend secrets here.\nEXPO_PUBLIC_DOMAIN=${backendHost}\n`);
// Gradle does not track EXPO_PUBLIC_ values as bundle inputs; drop any cached bundle.
await fs.rm(path.join(target, "android/app/build/generated/assets/createBundleReleaseJsAndAssets"),
  { recursive: true, force: true });

const configPath = path.join(target, "app.json");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
// Every published APK needs a higher versionCode than the last, or Android
// refuses to install it as an update. CI derives one from the run number.
const override = process.env.ANDROID_VERSION_CODE;
if (override !== undefined) {
  const code = Number(override);
  if (!Number.isInteger(code) || code < 1 || code > 2100000000) {
    throw new Error("ANDROID_VERSION_CODE must be a positive whole number.");
  }
  config.expo.android.versionCode = code;
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

// build.gradle is hand-maintained (release signing); keep it across prebuild.
const gradlePath = path.join(target, "android/app/build.gradle");
const gradle = await fs.readFile(gradlePath, "utf8");
const generated = spawnSync(path.join(target, "node_modules/.bin/expo"),
  ["prebuild", "--platform", "android", "--no-install"], {
    cwd: target, stdio: "inherit",
    env: { ...process.env, CI: "1", EXPO_NO_GIT_STATUS: "1", EXPO_NO_TELEMETRY: "1" },
  });
if (generated.status !== 0) throw new Error(`Android refresh failed (${generated.status}).`);
await fs.writeFile(gradlePath, gradle
  .replace(/versionCode \d+/, `versionCode ${config.expo.android.versionCode ?? 1}`)
  .replace(/versionName "[^"]+"/, `versionName "${config.expo.version}"`));
// Never let the publicly shared template debug key take part.
await fs.rm(path.join(target, "android/app/debug.keystore"), { force: true });
console.info(`Refreshed Android project for ${config.expo.version}, version code ${config.expo.android.versionCode}.`);
