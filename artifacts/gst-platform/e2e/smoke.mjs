/**
 * Browser smoke test: the built app, served by the API server, signs a user in
 * and issues an invoice end to end.
 *
 *   BASE_URL=http://localhost:25512 MAIL_OUTBOX_PATH=/tmp/e2e-outbox.jsonl node artifacts/gst-platform/e2e/smoke.mjs
 *
 * PLAYWRIGHT_FROM names a folder where `playwright` is installed, when it is
 * not a dependency of this repository (CI installs it on its own).
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM ? `${process.env.PLAYWRIGHT_FROM}/x.js` : import.meta.url)("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:25512";
const OUTBOX = process.env.MAIL_OUTBOX_PATH;
const PASSWORD = "correct-horse-battery-staple";
const uniq = Date.now();

async function api(method, path, body, cookie = "") {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { "content-type": "application/json", origin: BASE, cookie },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null), cookies: res.headers.getSetCookie() };
}

// A business owner, registered the way a visitor would be (public sign-up is on in CI only).
const email = `smoke${uniq}@example.test`;
const primed = await api("GET", "/healthz");
const jar = primed.cookies.map((c) => c.split(";")[0]).join("; ");
const csrf = /gst_csrf=([^;]+)/.exec(jar)?.[1] ?? "";
const post = (path, body, token) => fetch(`${BASE}/api${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE, cookie: jar, "x-csrf-token": decodeURIComponent(csrf), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

const reg = await post("/auth/register", { name: "Smoke Owner", email, businessName: "Smoke Traders", gstin: "27AAAAA0000A1Z5" });
if (reg.status !== 202) throw new Error(`register: ${reg.status}`);
await new Promise((r) => setTimeout(r, 300));
const mail = fs.readFileSync(OUTBOX, "utf8").trim().split("\n").map((l) => JSON.parse(l)).reverse().find((m) => m.to === email);
const token = /verify[?#]token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "")?.[1];
const verified = await post("/auth/verify-registration", { token, password: PASSWORD });
if (verified.status !== 201) throw new Error(`verify: ${verified.status}`);
await post("/customers", { name: "Smoke Customer", stateCode: "27" }, verified.data.token);
await post("/products", { name: "Smoke Widget", unit: "Nos", sellingPrice: 250, gstRate: 18 }, verified.data.token);

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const step = async (name, fn) => {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { await page.screenshot({ path: "/tmp/e2e-failure.png", fullPage: true }); console.log(`  FAIL  ${name}: ${e.message}`); await browser.close(); process.exit(1); }
};

await step("the demo page loads for a visitor", async () => {
  await page.goto(`${BASE}/demo`);
  await page.getByRole("button", { name: /book|request|demo/i }).first().waitFor();
});
await step("the owner signs in and sees the dashboard", async () => {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
  await page.getByRole("link", { name: /New invoice/i }).first().waitFor();
});
await step("an invoice is created from a product", async () => {
  await page.goto(`${BASE}/invoices/new`);
  await page.getByPlaceholder("Search or type a customer name...").fill("Smoke");
  await page.getByRole("button", { name: /Smoke Customer/ }).click();
  await page.getByText("Select product (optional)...").click();
  await page.getByRole("option", { name: "Smoke Widget" }).click();
  await page.getByRole("button", { name: "Create Invoice" }).click();
  await page.waitForURL(/\/invoices$/);
  await page.getByText("Smoke Customer").first().waitFor();
});
await step("no script errors on the way", async () => {
  if (errors.length) throw new Error(errors.join("; "));
});
await browser.close();
console.log("\nbrowser smoke test passed");
