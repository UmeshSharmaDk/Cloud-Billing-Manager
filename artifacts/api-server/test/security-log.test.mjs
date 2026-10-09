import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { scrubLog } from "../../../scripts/security-log.mjs";

const unsafe = [
  "Error: postgres://fixture-user:fixture-password@localhost/gst",
  "https://example.test/verify?token=fixture-verification",
  "smtps://fixture-mail:fixture-credential@example.test",
  'authorization: Bearer eyJfixture.payload.signature',
  'authorization: Bearer fixture-opaque-session',
  'cookie: gst_session=fixture-cookie; gst_csrf=fixture-csrf',
  '{"req":{"headers":{"cookie":"gst_session=fixture-json-cookie; gst_csrf=fixture-json-csrf"}}}',
  'SESSION_SECRET=fixture-signing-value token="fixture-invite"',
  "Failed query:\nparams: fixture-email,fixture-hash",
].join("\n");
const safe = scrubLog(unsafe);
for (const value of [
  "fixture-user", "fixture-password", "fixture-verification", "fixture-mail",
  "fixture-credential", "eyJfixture", "fixture-signing-value", "fixture-invite",
  "fixture-email", "fixture-hash",
  "fixture-opaque-session", "fixture-cookie", "fixture-csrf", "fixture-json-cookie", "fixture-json-csrf",
]) assert.ok(!safe.includes(value), `diagnostics leaked ${value}`);
assert.equal(scrubLog("APP_DATABASE_URL must be set"), "APP_DATABASE_URL must be set");
assert.equal(scrubLog("PRODUCTION_SMTP_URL environment variable is required"),
  "PRODUCTION_SMTP_URL environment variable is required");
const missing = spawnSync(process.execPath, ["../../../scripts/security-log.mjs", "/tmp/nonexistent-security-log.test"], {
  cwd: new URL(".", import.meta.url), encoding: "utf8", env: {},
});
assert.equal(missing.status, 0, missing.stderr);
assert.match(missing.stdout, /failure occurred before server startup/);
console.log("Security diagnostics redact credentials and links and tolerate missing logs.");
