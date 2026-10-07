import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const configUrl = new URL("../src/lib/config.ts", import.meta.url).href;
function loadConfig(overrides: Record<string, string>) {
  return spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `const { config } = await import(${JSON.stringify(configUrl)});
     console.log(JSON.stringify({ kind: config.mail.kind, url: config.mail.url }));`,
  ], {
    encoding: "utf8",
    env: {
      NODE_ENV: "production",
      SESSION_SECRET: "isolated-config-test-signing-key-32-plus",
      ALLOWED_ORIGINS: "https://example.test",
      MAIL_FROM: "no-reply@example.test",
      ...overrides,
    },
  });
}

const production = loadConfig({
  PRODUCTION_SMTP_URL: "smtps://production.example.test:465",
  SMTP_URL: "smtp://shared.example.test:587",
});
assert.equal(production.status, 0, production.stderr);
assert.deepEqual(JSON.parse(production.stdout), {
  kind: "smtp", url: "smtps://production.example.test:465",
});

const shared = loadConfig({ SMTP_URL: "smtp://shared.example.test:587" });
assert.notEqual(shared.status, 0);
assert.match(shared.stderr, /PRODUCTION_SMTP_URL environment variable is required/);

const developmentSmtp = loadConfig({
  NODE_ENV: "development",
  SMTP_URL: "smtp://shared.example.test:587",
});
assert.equal(developmentSmtp.status, 0, developmentSmtp.stderr);
assert.equal(JSON.parse(developmentSmtp.stdout).kind, "smtp");

const development = loadConfig({
  NODE_ENV: "development",
  PRODUCTION_SMTP_URL: "smtps://production.example.test:465",
});
assert.equal(development.status, 0, development.stderr);
assert.equal(JSON.parse(development.stdout).kind, "log");

const missing = loadConfig({});
assert.notEqual(missing.status, 0);
assert.match(missing.stderr, /PRODUCTION_SMTP_URL environment variable is required/);
console.log("Mail config: production-only credentials, development SMTP opt-in, development isolation, and required transport passed.");
