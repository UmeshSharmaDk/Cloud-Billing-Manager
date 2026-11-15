import crypto from "node:crypto";
import { Router, type IRouter } from "express";
import { requireAuth } from "./auth";
import { logger } from "../lib/logger";

/**
 * Keeps installed copies of the Android app current, as the CRM app does:
 * - /updates/manifest speaks the Expo Updates protocol
 *   (https://docs.expo.dev/technical-specs/expo-updates-1/) to expo-updates,
 *   which checks on every launch, so JavaScript changes reach phones without
 *   a reinstall;
 * - /app/android/latest tells a signed-in app about the newest APK, which it
 *   offers to download and install.
 *
 * Both are published by CI to the repository's public `android-app` GitHub
 * release (see .github/workflows/android-app-update.yml), not deployed with the
 * site: Hostinger builds from Git, and an APK does not belong in the repository.
 */
const RELEASE = process.env.APP_RELEASE_URL ?? "https://github.com/UmeshSharmaDk/Cloud-Billing-Manager/releases/download/android-app";
const RUNTIME_RE = /^[A-Za-z0-9._-]{1,32}$/;
const TTL_MS = 2 * 60 * 1000;

const cache = new Map<string, { at: number; value: any }>();

/** A JSON file from the release, cached briefly; null when it is not published. */
async function releaseJson(name: string): Promise<any | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const res = await fetch(`${RELEASE}/${name}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok && res.status !== 404) throw new Error(`Release file ${name}: HTTP ${res.status}`);
  const value = res.ok ? await res.json() : null;
  cache.set(name, { at: Date.now(), value });
  return value;
}

function multipart(parts: Array<{ name: string; json: unknown }>) {
  const boundary = `expo-${crypto.randomBytes(12).toString("hex")}`;
  const body = parts.map((p) => [
    `--${boundary}`, "Content-Type: application/json; charset=utf-8", `Content-Disposition: form-data; name="${p.name}"`, "", JSON.stringify(p.json),
  ].join("\r\n")).join("\r\n") + `\r\n--${boundary}--\r\n`;
  return { boundary, body: Buffer.from(body) };
}

const router: IRouter = Router();

/** Public by necessity: expo-updates checks before anyone signs in. It serves only app code. */
router.get("/updates/manifest", async (req, res) => {
  const protocol = Number(req.get("expo-protocol-version") ?? 0);
  const platform = req.get("expo-platform") ?? String(req.query.platform ?? "");
  const runtime = req.get("expo-runtime-version") ?? String(req.query["runtime-version"] ?? "");
  if (platform !== "android") return res.status(400).json({ error: "expo-platform must be android" });
  if (!RUNTIME_RE.test(runtime)) return res.status(400).json({ error: "expo-runtime-version is missing or invalid" });

  let manifest: any = null;
  try {
    manifest = await releaseJson(`ota-${runtime}.json`);
  } catch (err) {
    logger.warn({ err }, "Could not read the app update manifest");
  }
  res.setHeader("expo-protocol-version", protocol >= 1 ? "1" : "0");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("Cache-Control", "private, max-age=0");
  const upToDate = manifest && req.get("expo-current-update-id") === manifest.id;
  if (!manifest || upToDate) {
    if (protocol < 1) return res.status(404).json({ error: "No update is available for this runtime." });
    const { boundary, body } = multipart([{ name: "directive", json: { type: "noUpdateAvailable" } }]);
    return res.type(`multipart/mixed; boundary=${boundary}`).send(body);
  }
  const { boundary, body } = multipart([{ name: "manifest", json: manifest }, { name: "extensions", json: { assetRequestHeaders: {} } }]);
  // A Buffer, so Express does not append a charset to the multipart type.
  return res.type(`multipart/mixed; boundary=${boundary}`).send(body);
});

router.get("/app/android/latest", requireAuth, async (_req, res) => {
  try {
    const latest = await releaseJson("latest.json");
    if (!latest) return res.status(404).json({ error: "No Android release has been published." });
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({ ...latest, downloadUrl: `${RELEASE}/${latest.apkFile}` });
  } catch (err) {
    logger.warn({ err }, "Could not read the Android release");
    return res.status(502).json({ error: "Could not check for app updates." });
  }
});

export default router;
