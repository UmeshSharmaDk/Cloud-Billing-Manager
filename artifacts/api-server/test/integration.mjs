/**
 * Integration tests for the security fixes in phases 1 and 2.
 *
 * Two businesses are registered against a live server and each probes the
 * other, which is the only way the cross-tenant findings stay fixed: F-05
 * survived code review, and would survive it again.
 *
 * Requires a real Postgres — the suite drives account state through `psql`
 * to simulate what an operator does (promote, deactivate, expire).
 *
 * The suite is not hermetic: it adds rows to whatever database it is pointed
 * at and does not clean them up, so point it at a scratch database. Where a
 * check depends on global state (how many administrators exist, say) it
 * establishes that precondition itself rather than assuming a clean slate.
 *
 *   createdb gst
 *   export DATABASE_URL=postgres://…/gst
 *   pnpm --filter @workspace/db run push
 *   PORT=8099 SESSION_SECRET=$(openssl rand -base64 48) \
 *     pnpm --filter @workspace/api-server run dev &
 *   API_URL=http://127.0.0.1:8099/api pnpm --filter @workspace/api-server run test:integration
 */
const B = process.env.API_URL ?? "http://127.0.0.1:8099/api";

let pass = 0, fail = 0;
const results = [];
function check(group, name, cond, detail = "") {
  results.push({ group, name, cond, detail });
  cond ? pass++ : fail++;
}

/**
 * A minimal cookie jar. The session is an HttpOnly cookie now, so the suite
 * has to behave like a browser: keep cookies, and echo the CSRF token on
 * state-changing requests.
 */
export function newJar() {
  return new Map();
}

function jarHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorb(jar, res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

async function call(method, path, { token, body, jar, csrf = true, origin } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (origin) headers.origin = origin;
  if (jar) {
    const cookie = jarHeader(jar);
    if (cookie) headers.cookie = cookie;
    if (csrf && !SAFE.has(method) && jar.get("gst_csrf")) {
      headers["x-csrf-token"] = jar.get("gst_csrf");
    }
  }
  const res = await fetch(`${B}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (jar) absorb(jar, res);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data, headers: res.headers };
}

const uniq = Date.now();
const PASSWORD = "correct-horse-battery-staple";

async function register(tag) {
  const email = `${tag}${uniq}@example.test`;
  const jar = newJar();
  // Prime the jar so the request carries a CSRF token, as a browser would.
  await call("GET", "/healthz", { jar });
  const r = await call("POST", "/auth/register", {
    jar,
    body: { name: `${tag} Owner`, email, password: PASSWORD,
            businessName: `${tag} Traders`, gstin: "27AAAAA0000A1Z5" },
  });
  if (r.status !== 201) throw new Error(`register ${tag} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { email, token: r.data.token, userId: r.data.user.id, jar };
}

// ---------------------------------------------------------------------------
const alice = await register("alice");
const bob = await register("bob");

// Each business creates a customer, a vendor and a product.
const aCust = (await call("POST", "/customers", { token: alice.token,
  body: { name: "Alice Secret Customer", gstin: "29AAAAA1111A1Z5", city: "Bengaluru" } })).data;
const aVend = (await call("POST", "/vendors", { token: alice.token,
  body: { name: "Alice Secret Vendor", gstin: "29BBBBB2222B1Z5" } })).data;
const aProd = (await call("POST", "/products", { token: alice.token,
  body: { name: "Alice Widget", unit: "Nos", sellingPrice: 100, gstRate: 18 } })).data;

const aInv = (await call("POST", "/invoices", { token: alice.token,
  body: { invoiceDate: "2026-08-01", customerId: aCust.id, placeOfSupply: "29",
          items: [{ productId: aProd.id, description: "Alice Widget", quantity: 2,
                    unitPrice: 100, gstRate: 18, unit: "Nos" }] } })).data.invoice;

check("setup", "alice created customer, vendor, product and invoice",
  Boolean(aCust?.id && aVend?.id && aProd?.id && aInv?.id));

// === F-05: cross-tenant reads ==============================================
// The headline exploit: reference Alice's customer id while creating your own
// invoice and read back her name and GSTIN from the 201 response.
{
  const r = await call("POST", "/invoices", { token: bob.token,
    body: { invoiceDate: "2026-08-02", customerId: aCust.id, placeOfSupply: "27",
            items: [{ description: "probe", quantity: 1, unitPrice: 1, gstRate: 18 }] } });
  const leaked = JSON.stringify(r.data ?? "").includes("Alice Secret Customer");
  check("F-05", "invoice create cannot resolve another tenant's customer",
    r.status === 400 && !leaked, `status ${r.status}`);
}
{
  const r = await call("POST", "/purchases", { token: bob.token,
    body: { vendorId: aVend.id, billDate: "2026-08-02",
            items: [{ description: "probe", quantity: 1, unitPrice: 1, gstRate: 18 }] } });
  const leaked = JSON.stringify(r.data ?? "").includes("Alice Secret Vendor");
  check("F-05", "purchase create cannot resolve another tenant's vendor",
    r.status === 400 && !leaked, `status ${r.status}`);
}
{
  const bInv = (await call("POST", "/invoices", { token: bob.token,
    body: { invoiceDate: "2026-08-03", customerName: "Bob Walk-in", placeOfSupply: "27",
            items: [{ description: "thing", quantity: 1, unitPrice: 50, gstRate: 18 }] } })).data.invoice;
  check("setup", "walk-in invoice (no customerId) still works", Boolean(bInv?.id));
  const r = await call("PATCH", `/invoices/${bInv.id}`, { token: bob.token,
    body: { customerId: aCust.id, items: [{ description: "thing", quantity: 1, unitPrice: 50, gstRate: 18 }] } });
  const leaked = JSON.stringify(r.data ?? "").includes("Alice Secret Customer");
  check("F-05", "invoice update cannot resolve another tenant's customer",
    r.status === 400 && !leaked, `status ${r.status}`);
}
{
  const r = await call("POST", "/eway-bills", { token: bob.token,
    body: { docNo: "EWB-1", docDate: "2026-08-02", invoiceId: aInv.id } });
  check("L-02", "e-way bill cannot reference another tenant's invoice",
    r.status === 400, `status ${r.status}`);
}

// Direct :id reads across the boundary must all 404.
for (const [path, id] of [["customers", aCust.id], ["vendors", aVend.id],
                          ["products", aProd.id], ["invoices", aInv.id]]) {
  const r = await call("GET", `/${path}/${id}`, { token: bob.token });
  check("F-05", `GET /${path}/:id is 404 across tenants`, r.status === 404, `status ${r.status}`);
  const d = await call("DELETE", `/${path}/${id}`, { token: bob.token });
  check("F-05", `DELETE /${path}/:id cannot touch another tenant`, d.status === 200 || d.status === 404);
}
// ...and Alice's data must still be there after Bob's delete attempts.
{
  const r = await call("GET", `/customers/${aCust.id}`, { token: alice.token });
  check("F-05", "alice's customer survived bob's delete attempts",
    r.status === 200 && r.data?.name === "Alice Secret Customer");
}

// === F-04: validation ======================================================
{
  const r = await call("POST", "/auth/login", { body: { email: 123, password: 456 } });
  check("F-04", "type-confused login is 400, not 500", r.status === 400, `status ${r.status}`);
}
{
  const r = await call("POST", "/invoices", { token: alice.token,
    body: { invoiceDate: "2026-08-01", customerName: "x",
            items: [{ description: "x", quantity: -5, unitPrice: 10, gstRate: 18 }] } });
  check("F-04", "negative quantity rejected", r.status === 400, `status ${r.status}`);
}
{
  const r = await call("POST", "/invoices", { token: alice.token,
    body: { invoiceDate: "2026-08-01", customerName: "x",
            items: [{ description: "x", quantity: 1, unitPrice: 10, gstRate: 900 }] } });
  check("F-04", "900% GST rate rejected", r.status === 400, `status ${r.status}`);
}
{
  const r = await call("POST", "/invoices", { token: alice.token,
    body: { invoiceDate: "not-a-date", customerName: "x",
            items: [{ description: "x", quantity: 1, unitPrice: 10, gstRate: 18 }] } });
  check("F-04", "malformed date rejected", r.status === 400, `status ${r.status}`);
}
{
  const r = await call("GET", "/customers/abc", { token: alice.token });
  check("F-04", "non-numeric :id is 400, not a driver error", r.status === 400, `status ${r.status}`);
}
{
  // Mass assignment: role is not on the customer schema and must be stripped.
  const r = await call("POST", "/customers", { token: alice.token,
    body: { name: "Strip Test", role: "admin", businessId: 99999, id: 4242 } });
  check("F-04", "unknown keys stripped, not written",
    r.status === 201 && r.data.id !== 4242 && r.data.businessId !== 99999,
    `id ${r.data?.id} businessId ${r.data?.businessId}`);
}
{
  const r = await call("PATCH", `/users/${bob.userId}`, { token: alice.token, body: { role: "superadmin" } });
  check("F-04", "invalid role value rejected", r.status === 400 || r.status === 403, `status ${r.status}`);
}

// === F-11: pagination caps =================================================
{
  const r = await call("GET", "/customers?limit=100000000", { token: alice.token });
  check("F-11", "limit=100000000 rejected", r.status === 400, `status ${r.status}`);
}
{
  const r = await call("GET", "/customers?limit=abc", { token: alice.token });
  check("F-11", "limit=abc rejected", r.status === 400, `status ${r.status}`);
}
{
  const r = await call("GET", "/customers?page=0", { token: alice.token });
  check("F-11", "page=0 rejected (was a negative offset)", r.status === 400, `status ${r.status}`);
}
{
  const r = await call("GET", "/customers?limit=100", { token: alice.token });
  check("F-11", "limit at the cap still works", r.status === 200, `status ${r.status}`);
}
{
  const r = await call("GET", "/reports/sales?fromDate=2000-01-01&toDate=2026-12-31", { token: alice.token });
  check("F-11", "over-long report span rejected", r.status === 400, `status ${r.status}`);
}
{
  const r = await call("GET", "/reports/sales", { token: alice.token });
  check("F-11", "report with no range defaults instead of reading all history", r.status === 200, `status ${r.status}`);
}

// === F-07: authorization read from the database, not the token =============
const adminEmail = `admin${uniq}@example.test`;
{
  // Promote Alice directly in the database, as an operator would.
  const { execSync } = await import("node:child_process");
  execSync(`psql "${process.env.DATABASE_URL}" -c "UPDATE users SET role='admin' WHERE id=${alice.userId}"`, { stdio: "ignore" });
  // Alice's token still says role=user, but the row now says admin.
  const r = await call("GET", "/admin/stats", { token: alice.token });
  check("F-07", "promotion takes effect on the existing token", r.status === 200, `status ${r.status}`);

  execSync(`psql "${process.env.DATABASE_URL}" -c "UPDATE users SET role='user' WHERE id=${alice.userId}"`, { stdio: "ignore" });
  const r2 = await call("GET", "/admin/stats", { token: alice.token });
  check("F-07", "demotion takes effect immediately (was 7 days)", r2.status === 403, `status ${r2.status}`);
}
{
  const { execSync } = await import("node:child_process");
  execSync(`psql "${process.env.DATABASE_URL}" -c "UPDATE users SET is_active=false WHERE id=${bob.userId}"`, { stdio: "ignore" });
  const r = await call("GET", "/customers", { token: bob.token });
  check("F-07", "deactivated account loses access immediately", r.status === 403, `status ${r.status}`);
  execSync(`psql "${process.env.DATABASE_URL}" -c "UPDATE users SET is_active=true WHERE id=${bob.userId}"`, { stdio: "ignore" });
}
{
  const { execSync } = await import("node:child_process");
  execSync(`psql "${process.env.DATABASE_URL}" -c "UPDATE users SET subscription_end='2020-01-01' WHERE id=${bob.userId}"`, { stdio: "ignore" });
  const r = await call("GET", "/customers", { token: bob.token });
  check("F-07", "expired subscription blocks API access", r.status === 403, `status ${r.status}`);
  execSync(`psql "${process.env.DATABASE_URL}" -c "UPDATE users SET subscription_end='2030-01-01' WHERE id=${bob.userId}"`, { stdio: "ignore" });
}
{
  const { execSync } = await import("node:child_process");
  execSync(`psql "${process.env.DATABASE_URL}" -c "DELETE FROM users WHERE email='${adminEmail}'"`, { stdio: "ignore" });
  const r = await call("GET", "/customers", { token: "not.a.token" });
  check("F-07", "garbage token rejected", r.status === 401);
}

// === F-06: lockout =========================================================
{
  const victim = `lockme${uniq}@example.test`;
  await call("POST", "/auth/register", { body: { name: "Victim", email: victim,
    password: "correct-horse-battery-staple", businessName: "Victim Ltd" } });

  let sawLock = false, attempts = 0;
  for (let i = 0; i < 16; i++) {
    const r = await call("POST", "/auth/login", { body: { email: victim, password: `wrong-${i}` } });
    attempts++;
    if (r.status === 429) { sawLock = true; break; }
  }
  check("F-06", `repeated failures trigger a lockout (after ${attempts})`, sawLock);

  // And the lockout holds even against the correct password.
  const r = await call("POST", "/auth/login", { body: { email: victim, password: "correct-horse-battery-staple" } });
  check("F-06", "lockout holds against the correct password", r.status === 429, `status ${r.status}`);

  const { execSync } = await import("node:child_process");
  const rows = execSync(`psql -t -A "${process.env.DATABASE_URL}" -c "SELECT count(*) FROM login_attempts WHERE key LIKE 'email:%'"`).toString().trim();
  check("F-06", "lockout state is in the database, not process memory", Number(rows) > 0, `${rows} rows`);

  // Those deliberate failures also tripped the per-IP counter, and every
  // request in this suite comes from the same loopback address — so without
  // this the suite locks itself out of every subsequent login. Clearing it is
  // the test cleaning up after itself, not a workaround for a bug.
  execSync(`psql "${process.env.DATABASE_URL}" -c "TRUNCATE login_attempts"`, { stdio: "ignore" });
}

// === regression: the happy paths still work ================================
{
  const r = await call("GET", "/invoices", { token: alice.token });
  check("regression", "invoice list works", r.status === 200 && Array.isArray(r.data.invoices));
  const s = await call("GET", "/dashboard/stats", { token: alice.token });
  check("regression", "dashboard stats work", s.status === 200);
  const g = await call("GET", "/reports/gstr1?month=8&year=2026", { token: alice.token });
  check("regression", "GSTR-1 works", g.status === 200);
  const b = await call("GET", "/business", { token: alice.token });
  check("regression", "business read works", b.status === 200);
  const bp = await call("PATCH", "/business", { token: alice.token, body: { city: "Mysuru" } });
  check("regression", "business update works", bp.status === 200 && bp.data.city === "Mysuru");
  const me = await call("GET", "/auth/me", { token: alice.token });
  check("regression", "auth/me works", me.status === 200 && me.data.id === alice.userId);
}
{
  // The GST maths must be untouched. Both branches, with the business's own
  // state code set so intra-state is actually reachable.
  await call("PATCH", "/business", { token: alice.token, body: { stateCode: "29" } });

  const intra = (await call("POST", "/invoices", { token: alice.token,
    body: { invoiceDate: "2026-08-05", customerName: "Local Buyer", placeOfSupply: "29",
            items: [{ description: "w", quantity: 2, unitPrice: 100, gstRate: 18 }] } })).data.invoice;
  check("regression", "intra-state splits CGST+SGST (200 -> 9% + 9%, total 236)",
    intra.subtotal === 200 && intra.cgst === 18 && intra.sgst === 18 && intra.igst === 0 && intra.grandTotal === 236,
    `cgst ${intra?.cgst} sgst ${intra?.sgst} igst ${intra?.igst} total ${intra?.grandTotal}`);

  const inter = (await call("POST", "/invoices", { token: alice.token,
    body: { invoiceDate: "2026-08-05", customerName: "Far Buyer", placeOfSupply: "27",
            items: [{ description: "w", quantity: 2, unitPrice: 100, gstRate: 18 }] } })).data.invoice;
  check("regression", "inter-state charges IGST (200 -> 18%, total 236)",
    inter.subtotal === 200 && inter.igst === 36 && inter.cgst === 0 && inter.grandTotal === 236,
    `cgst ${inter?.cgst} igst ${inter?.igst} total ${inter?.grandTotal}`);

  // Discounts and rounding.
  const disc = (await call("POST", "/invoices", { token: alice.token,
    body: { invoiceDate: "2026-08-05", customerName: "Discount Buyer", placeOfSupply: "29",
            items: [{ description: "w", quantity: 3, unitPrice: 33.33, gstRate: 5, discount: 10 }] } })).data.invoice;
  const taxable = Math.round(3 * 33.33 * 0.9 * 100) / 100;
  check("regression", "discount and round-off unchanged",
    disc.subtotal === taxable && disc.grandTotal === Math.round(taxable * 1.05),
    `subtotal ${disc?.subtotal} (want ${taxable}) total ${disc?.grandTotal}`);
}


// === F-09: cookie session, CSRF, security headers ==========================
{
  const jar = newJar();
  await call("GET", "/healthz", { jar });
  const r = await call("POST", "/auth/login", { jar, body: { email: alice.email, password: PASSWORD } });
  const setCookies = r.headers.getSetCookie?.() ?? [];
  const session = setCookies.find((c) => c.startsWith("gst_session="));
  check("F-09", "login issues an HttpOnly session cookie",
    Boolean(session?.includes("HttpOnly")), session ? "present" : "missing");
  check("F-09", "the CSRF companion cookie is NOT HttpOnly (the page must read it)",
    Boolean(jar.get("gst_csrf")) && !setCookies.some((c) => c.startsWith("gst_csrf=") && c.includes("HttpOnly")));

  const me = await call("GET", "/auth/me", { jar });
  check("F-09", "the cookie alone authenticates a read", me.status === 200, `status ${me.status}`);

  const noCsrf = await call("POST", "/customers", { jar, csrf: false, body: { name: "Forged" } });
  check("F-09", "a write without the CSRF header is rejected", noCsrf.status === 403, `status ${noCsrf.status}`);

  const withCsrf = await call("POST", "/customers", { jar, body: { name: "Legit" } });
  check("F-09", "a write with the CSRF header succeeds", withCsrf.status === 201, `status ${withCsrf.status}`);

  const out = await call("POST", "/auth/logout", { jar });
  check("F-09", "logout is not a stub — the session cookie is cleared", out.status === 200);
  jar.delete("gst_session");
  const after = await call("GET", "/auth/me", { jar });
  check("F-09", "the session does not survive logout", after.status === 401, `status ${after.status}`);

  const h = (await call("GET", "/healthz")).headers;
  check("F-09", "CSP, HSTS, nosniff and DENY framing are all set",
    h.get("content-security-policy")?.includes("default-src 'none'") === true &&
    Boolean(h.get("strict-transport-security")) &&
    h.get("x-content-type-options") === "nosniff" &&
    h.get("x-frame-options") === "DENY");
}

// === F-08: CORS is an allowlist, not a wildcard ============================
{
  const ok = await call("GET", "/healthz", { origin: "http://localhost:25512" });
  check("F-08", "an allowed origin is echoed back explicitly",
    ok.headers.get("access-control-allow-origin") === "http://localhost:25512");
  check("F-08", "credentials are permitted (required for cookie auth)",
    ok.headers.get("access-control-allow-credentials") === "true");

  const bad = await call("GET", "/healthz", { origin: "https://evil.example" });
  check("F-08", "an unknown origin gets no allow-origin header at all",
    bad.headers.get("access-control-allow-origin") === null,
    String(bad.headers.get("access-control-allow-origin")));
}

// === F-12: password policy =================================================
{
  const weak = [
    ["a one-character password", "x"],
    ["an 8-character password", "Abc123!@"],
    ["a top-of-the-list password", "password123"],
    ["a single repeated character", "aaaaaaaaaaaaaaaa"],
  ];
  for (const [label, pw] of weak) {
    const r = await call("POST", "/auth/register", {
      body: { name: "W", email: `weak${Math.random().toString(36).slice(2)}@example.test`,
              password: pw, businessName: "W Ltd" },
    });
    check("F-12", `${label} is rejected`, r.status === 400, `status ${r.status}`);
  }

  const jar = newJar();
  await call("GET", "/healthz", { jar });
  await call("POST", "/auth/login", { jar, body: { email: alice.email, password: PASSWORD } });

  const wrongCurrent = await call("POST", "/auth/change-password", {
    jar, body: { currentPassword: "not-the-right-one", newPassword: "a-brand-new-passphrase-99" },
  });
  check("F-12", "change-password rejects a wrong current password", wrongCurrent.status === 403, `status ${wrongCurrent.status}`);

  const weakNew = await call("POST", "/auth/change-password", {
    jar, body: { currentPassword: PASSWORD, newPassword: "short" },
  });
  check("F-12", "change-password enforces the policy on the new password", weakNew.status === 400, `status ${weakNew.status}`);

  const NEW_PASSWORD = "a-brand-new-passphrase-99";
  const changed = await call("POST", "/auth/change-password", {
    jar, body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  check("F-12", "a user can change their own password without an admin", changed.status === 200, `status ${changed.status}`);

  const oldPw = await call("POST", "/auth/login", { body: { email: alice.email, password: PASSWORD } });
  check("F-12", "the old password no longer works", oldPw.status === 401, `status ${oldPw.status}`);
  const newPw = await call("POST", "/auth/login", { body: { email: alice.email, password: NEW_PASSWORD } });
  check("F-12", "the new password works", newPw.status === 200, `status ${newPw.status}`);
  alice.token = newPw.data.token;
}

// === F-13: admin accountability ============================================
{
  const { execSync } = await import("node:child_process");
  const q = (sql) => execSync(`psql -t -A "${process.env.DATABASE_URL}" -c "${sql}"`).toString().trim();

  // Promote alice so she can exercise the admin routes, and make a second
  // admin so the last-admin guard is not tripped by the setup itself.
  execSync(`psql "${process.env.DATABASE_URL}" -c "UPDATE users SET role='admin' WHERE id=${alice.userId}"`, { stdio: "ignore" });
  const spare = await register("spare");
  execSync(`psql "${process.env.DATABASE_URL}" -c "UPDATE users SET role='admin' WHERE id=${spare.userId}"`, { stdio: "ignore" });

  const NEW_PASSWORD = "a-brand-new-passphrase-99";
  const jar = newJar();
  await call("GET", "/healthz", { jar });
  await call("POST", "/auth/login", { jar, body: { email: alice.email, password: NEW_PASSWORD } });

  const noStepUp = await call("POST", `/users/${bob.userId}/reset-password`, {
    jar, body: { newPassword: "another-good-passphrase-77" },
  });
  check("F-13", "resetting another user's password needs the admin's own password",
    noStepUp.status === 403 && noStepUp.data?.code === "step_up_required", `status ${noStepUp.status}`);

  const wrongStepUp = await call("POST", `/users/${bob.userId}/reset-password`, {
    jar, body: { newPassword: "another-good-passphrase-77", confirmPassword: "wrong" },
  });
  check("F-13", "a wrong confirmation is refused", wrongStepUp.status === 403, `status ${wrongStepUp.status}`);

  const before = Number(q("SELECT count(*) FROM audit_log"));
  const ok = await call("POST", `/users/${bob.userId}/reset-password`, {
    jar, body: { newPassword: "another-good-passphrase-77", confirmPassword: NEW_PASSWORD },
  });
  check("F-13", "with confirmation the reset succeeds", ok.status === 200, `status ${ok.status}`);
  check("F-13", "the reset is written to the audit log",
    Number(q("SELECT count(*) FROM audit_log")) > before);
  check("F-13", "the audit row names the actor and the action",
    q(`SELECT action FROM audit_log ORDER BY id DESC LIMIT 1`) === "user.password_reset" &&
    q(`SELECT actor_id FROM audit_log ORDER BY id DESC LIMIT 1`) === String(alice.userId));
  check("F-13", "no password or hash is stored in the audit details",
    !/password|hash/i.test(q("SELECT details::text FROM audit_log ORDER BY id DESC LIMIT 1")));

  const roleNoStepUp = await call("PATCH", `/users/${bob.userId}`, { jar, body: { role: "admin" } });
  check("F-13", "a role change needs confirmation too", roleNoStepUp.status === 403, `status ${roleNoStepUp.status}`);

  const rename = await call("PATCH", `/users/${bob.userId}`, { jar, body: { name: "Renamed" } });
  check("F-13", "an ordinary edit does not", rename.status === 200, `status ${rename.status}`);

  const selfDelete = await call("DELETE", `/users/${alice.userId}`, { jar });
  check("F-13", "an admin cannot delete their own account", selfDelete.status === 409, `status ${selfDelete.status}`);

  // The guard only bites when alice really is the last active admin, and this
  // suite shares a database with whatever ran before it. Establish the
  // precondition explicitly rather than assuming a clean slate, then restore.
  await call("PATCH", `/users/${spare.userId}`, { jar, body: { role: "user", confirmPassword: NEW_PASSWORD } });
  const others = q(
    `SELECT coalesce(string_agg(id::text, ','), '') FROM users ` +
    `WHERE role='admin' AND is_active AND deleted_at IS NULL AND id <> ${alice.userId}`,
  );
  if (others) {
    execSync(`psql "${process.env.DATABASE_URL}" -c "UPDATE users SET role='user' WHERE id IN (${others})"`, { stdio: "ignore" });
  }
  check("F-13", "precondition: alice is the only active administrator",
    q(`SELECT count(*) FROM users WHERE role='admin' AND is_active AND deleted_at IS NULL`) === "1");

  const lastAdmin = await call("PATCH", `/users/${alice.userId}`, {
    jar, body: { role: "user", confirmPassword: NEW_PASSWORD },
  });
  check("F-13", "the last administrator cannot be demoted", lastAdmin.status === 409, `status ${lastAdmin.status}`);

  const lastAdminOff = await call("PATCH", `/admin/users/${alice.userId}`, {
    jar, body: { isActive: false },
  });
  check("F-13", "...nor deactivated", lastAdminOff.status === 409, `status ${lastAdminOff.status}`);

  if (others) {
    execSync(`psql "${process.env.DATABASE_URL}" -c "UPDATE users SET role='admin' WHERE id IN (${others})"`, { stdio: "ignore" });
  }

  // Soft delete keeps the tenant's records rather than orphaning them.
  const victim = await register("victim");
  const vBiz = q(`SELECT business_id FROM users WHERE id=${victim.userId}`);
  const del = await call("DELETE", `/users/${victim.userId}`, { jar });
  check("F-13", "deleting a user succeeds", del.status === 200, `status ${del.status}`);
  check("F-13", "the delete is a soft delete, not a row removal",
    q(`SELECT count(*) FROM users WHERE id=${victim.userId} AND deleted_at IS NOT NULL`) === "1");
  check("F-13", "their business record is not orphaned",
    q(`SELECT count(*) FROM businesses WHERE id=${vBiz}`) === "1");
  const ghost = await call("GET", "/auth/me", { token: victim.token });
  check("F-13", "a deleted user's existing session stops working", ghost.status === 401, `status ${ghost.status}`);
  const gone = await call("GET", `/users/${victim.userId}`, { jar });
  check("F-13", "a deleted user no longer resolves by id", gone.status === 404, `status ${gone.status}`);
}


// === invoice numbering and transactions ====================================
{
  const { execSync } = await import("node:child_process");
  const q = (sql) => execSync(`psql -t -A "${process.env.DATABASE_URL}" -c "${sql}"`).toString().trim();

  const biz = await register("numbering");
  const mk = (date) => call("POST", "/invoices", {
    token: biz.token,
    body: { invoiceDate: date, customerName: "Walk-in", placeOfSupply: "29",
            items: [{ description: "x", quantity: 1, unitPrice: 100, gstRate: 18 }] },
  });

  const a = (await mk("2026-05-10")).data.invoice;
  const b = (await mk("2026-06-11")).data.invoice;
  check("numbering", "numbers use the Indian financial year, not the calendar year",
    a.invoiceNumber.includes("2026-27"), a.invoiceNumber);
  check("numbering", "the series increments", 
    a.invoiceNumber.endsWith("0001") && b.invoiceNumber.endsWith("0002"),
    `${a.invoiceNumber} then ${b.invoiceNumber}`);

  // January falls in the PREVIOUS financial year.
  const jan = (await mk("2027-01-20")).data.invoice;
  check("numbering", "January belongs to the financial year that began in April",
    jan.invoiceNumber.includes("2026-27"), jan.invoiceNumber);

  // April starts a new series.
  const apr = (await mk("2027-04-02")).data.invoice;
  check("numbering", "April opens a fresh series",
    apr.invoiceNumber.includes("2027-28") && apr.invoiceNumber.endsWith("0001"), apr.invoiceNumber);

  // Deleting must not free a number for reuse.
  await call("DELETE", `/invoices/${b.id}`, { token: biz.token });
  const afterDelete = (await mk("2026-07-01")).data.invoice;
  check("numbering", "a deleted invoice's number is never reissued",
    afterDelete.invoiceNumber.endsWith("0004"), `${b.invoiceNumber} deleted, next is ${afterDelete.invoiceNumber}`);

  // Concurrency: the old COUNT(*)+1 handed every concurrent caller the same number.
  const burst = await Promise.all(Array.from({ length: 12 }, () => mk("2026-08-15")));
  const numbers = burst.map((r) => r.data?.invoice?.invoiceNumber).filter(Boolean);
  check("numbering", "12 concurrent invoices get 12 distinct numbers",
    numbers.length === 12 && new Set(numbers).size === 12,
    `${numbers.length} created, ${new Set(numbers).size} distinct`);

  check("numbering", "the database also refuses duplicates outright",
    q(`SELECT count(*) FROM pg_indexes WHERE indexname='invoices_business_number_unique'`) === "1");

  // Transactions: creating a purchase first mutates the product catalog and
  // then writes the bill. Force the second step to fail and the first must be
  // undone — previously it was not, so a failed bill still moved stock and
  // prices. A temporary CHECK constraint makes the failure deterministic.
  const vendor = (await call("POST", "/vendors", { token: biz.token, body: { name: "T Vendor" } })).data;
  const bizId = q(`SELECT business_id FROM users WHERE id=${biz.userId}`);
  const countProducts = () => q(`SELECT count(*) FROM products WHERE business_id=${bizId}`);

  execSync(`psql "${process.env.DATABASE_URL}" -c "ALTER TABLE purchases ADD CONSTRAINT tmp_reject_failme CHECK (invoice_number NOT LIKE 'FAILME%')"`, { stdio: "ignore" });
  try {
    const before = countProducts();
    const bad = await call("POST", "/purchases", {
      token: biz.token,
      body: { vendorId: vendor.id, billDate: "2026-08-01", billNumber: "FAILME-1",
              items: [{ description: "Ghost Product", quantity: 1, unitPrice: 10, gstRate: 18 }] },
    });
    const after = countProducts();
    check("transactions", "a failed bill rolls back the catalog changes it made",
      bad.status >= 500 && after === before,
      `status ${bad.status}, products ${before} -> ${after}`);
    check("transactions", "the ghost product was not left behind",
      q(`SELECT count(*) FROM products WHERE business_id=${bizId} AND name='Ghost Product'`) === "0");
  } finally {
    execSync(`psql "${process.env.DATABASE_URL}" -c "ALTER TABLE purchases DROP CONSTRAINT tmp_reject_failme"`, { stdio: "ignore" });
  }

  // ...and the same bill succeeds once the constraint is gone, proving the
  // rollback above was the constraint firing and not a validation refusal.
  const good = await call("POST", "/purchases", {
    token: biz.token,
    body: { vendorId: vendor.id, billDate: "2026-08-01", billNumber: "FAILME-1",
            items: [{ description: "Ghost Product", quantity: 1, unitPrice: 10, gstRate: 18 }] },
  });
  check("transactions", "the same request succeeds once the failure is removed",
    good.status === 201 && q(`SELECT count(*) FROM products WHERE business_id=${bizId} AND name='Ghost Product'`) === "1",
    `status ${good.status}`);
}

// ---------------------------------------------------------------------------
let group = "";
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.cond ? "ok  " : "FAIL"}  ${r.name}${r.cond || !r.detail ? "" : `  [${r.detail}]`}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
