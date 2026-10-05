/**
 * Integration tests for the security fixes in phases 1 and 2.
 *
 * Two businesses are registered against a live server and each probes the
 * other, which is the only way the cross-tenant findings stay fixed: F-05
 * survived code review, and would survive it again.
 *
 * Requires a real Postgres — the suite drives account state through `psql`
 * to simulate what an operator does (promote, deactivate, expire). That work
 * needs operator rights, so when the server runs under a restricted role set
 * ADMIN_DATABASE_URL to an owning connection; it defaults to DATABASE_URL.
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
import { execSync } from "node:child_process";
import fs from "node:fs";

const B = process.env.API_URL ?? "http://127.0.0.1:8099/api";

/**
 * Fixture manipulation runs as an operator, never as the application.
 *
 * The server connects with a role that is deliberately unable to TRUNCATE, to
 * ALTER a table, or to bypass row-level security. That restriction is the
 * whole point of the RLS work, so the suite must not borrow the application's
 * credentials to promote a user or reset a counter — doing so would both fail
 * and quietly prove nothing about what the application role can reach.
 *
 * Point ADMIN_DATABASE_URL at an owning (or superuser) connection. It falls
 * back to DATABASE_URL, which is correct for the single-role setups where the
 * application is already the table owner.
 */
const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;

/** Run a statement as the operator, discarding its output. */
function sqlExec(sql) {
  execSync(`psql "${ADMIN_URL}" -c "${sql}"`, { stdio: "ignore" });
}

/** Run a query as the operator and return the single scalar it produced. */
function sqlValue(sql) {
  return execSync(`psql -t -A "${ADMIN_URL}" -c "${sql}"`).toString().trim();
}

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

async function call(method, path, { token, body, jar, csrf = true, origin, headers: extra } = {}) {
  const headers = { ...extra };
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

/**
 * Where the server writes mail instead of sending it.
 *
 * Registration is two steps now — submit, then open the link — because the
 * response to the submit must not say whether the address was already taken.
 * The suite reads the link from here, which is also the only way to test the
 * flow while running the server with NODE_ENV=production.
 */
const OUTBOX = process.env.MAIL_OUTBOX_PATH;

/** Every message sent so far, oldest first. */
function outbox() {
  if (!OUTBOX) {
    throw new Error(
      "MAIL_OUTBOX_PATH must be set, and must match the value the server was started with: " +
        "registration is completed by a link the server sends, and the suite reads it from there.",
    );
  }
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** The newest verification link sent to this address, or null. */
function verificationToken(email) {
  for (const message of [...outbox()].reverse()) {
    if (message.to !== email) continue;
    const match = /verify[?#]token=([A-Za-z0-9_-]+)/.exec(message.text ?? "");
    if (match) return match[1];
  }
  return null;
}

function adminInvitationToken(email) {
  for (const message of [...outbox()].reverse()) {
    if (message.to !== email) continue;
    const match = /accept-admin-invite\?token=([A-Za-z0-9_-]+)/.exec(message.text ?? "");
    if (match) return match[1];
  }
  return null;
}

async function register(tag) {
  const email = `${tag}${uniq}@example.test`;
  const jar = newJar();
  // Prime the jar so the request carries a CSRF token, as a browser would.
  await call("GET", "/healthz", { jar });
  const submitted = await call("POST", "/auth/register", {
    jar,
    body: { name: `${tag} Owner`, email,
            businessName: `${tag} Traders`, gstin: "27AAAAA0000A1Z5" },
  });
  if (submitted.status !== 202) {
    throw new Error(`register ${tag} failed: ${submitted.status} ${JSON.stringify(submitted.data)}`);
  }

  const token = verificationToken(email);
  if (!token) throw new Error(`no verification link was sent to ${email}`);

  // The password is chosen here, by whoever holds the link — not at submission.
  const r = await call("POST", "/auth/verify-registration", { jar, body: { token, password: PASSWORD } });
  if (r.status !== 201) throw new Error(`verify ${tag} failed: ${r.status} ${JSON.stringify(r.data)}`);
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
  sqlExec(`UPDATE users SET role='admin' WHERE id=${alice.userId}`);
  // Alice's token still says role=user, but the row now says admin.
  const r = await call("GET", "/admin/stats", { token: alice.token });
  check("F-07", "promotion takes effect on the existing token", r.status === 200, `status ${r.status}`);

  sqlExec(`UPDATE users SET role='user' WHERE id=${alice.userId}`);
  const r2 = await call("GET", "/admin/stats", { token: alice.token });
  check("F-07", "demotion takes effect immediately (was 7 days)", r2.status === 403, `status ${r2.status}`);
}
{
  sqlExec(`UPDATE users SET is_active=false WHERE id=${bob.userId}`);
  const r = await call("GET", "/customers", { token: bob.token });
  check("F-07", "deactivated account loses access immediately", r.status === 403, `status ${r.status}`);
  sqlExec(`UPDATE users SET is_active=true WHERE id=${bob.userId}`);
}
{
  sqlExec(`UPDATE users SET subscription_end='2020-01-01' WHERE id=${bob.userId}`);
  const r = await call("GET", "/customers", { token: bob.token });
  check("F-07", "expired subscription blocks API access", r.status === 403, `status ${r.status}`);
  sqlExec(`UPDATE users SET subscription_end='2030-01-01' WHERE id=${bob.userId}`);
}
{
  sqlExec(`DELETE FROM users WHERE email='${adminEmail}'`);
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

  const rows = sqlValue(`SELECT count(*) FROM login_attempts WHERE key LIKE 'login:%'`);
  check("F-06", "lockout state is in the database, not process memory", Number(rows) > 0, `${rows} rows`);

  // Those deliberate failures also tripped the per-IP counter, and every
  // request in this suite comes from the same loopback address — so without
  // this the suite locks itself out of every subsequent login. Clearing it is
  // the test cleaning up after itself, not a workaround for a bug.
  sqlExec(`TRUNCATE login_attempts`);
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


// === supply type: CGST+SGST vs IGST ========================================
//
// The wrong head of tax on an invoice whose total is right. Invisible on the
// document, and expensive at filing time: the customer claims credit they are
// not entitled to and the return has to be amended.
{
  const tax = await register("tax");

  // The regression. `businesses.state_code` is nullable and registration never
  // sets it, so the old comparison put every business in state "" — unequal to
  // every real state code, so every invoice naming a place of supply was taxed
  // as inter-state. Strip the GSTIN too, so there is nothing left to derive
  // the seller's state from.
  const [bizId] = [sqlValue(`SELECT id FROM businesses WHERE user_id = ${tax.userId}`)];
  sqlExec(`UPDATE businesses SET state_code = NULL, gstin = NULL WHERE id = ${bizId}`);

  const blind = await call("POST", "/invoices", { token: tax.token,
    body: { invoiceDate: "2026-08-06", customerName: "Local Buyer", placeOfSupply: "29",
            items: [{ description: "w", quantity: 2, unitPrice: 100, gstRate: 18 }] } });
  check("supply-type", "no seller state: refuses instead of silently charging IGST",
    blind.status === 400, `status ${blind.status} ${JSON.stringify(blind.data)}`);
  check("supply-type", "and the message says to set the business state code",
    /business state code/i.test(blind.data?.error ?? ""), blind.data?.error ?? "");

  // A GSTIN alone settles it: its first two characters are the state of
  // registration. This is the common case — most businesses never fill in the
  // separate state code field.
  sqlExec(`UPDATE businesses SET gstin = '29AAAAA0000A1Z5' WHERE id = ${bizId}`);

  const viaGstin = await call("POST", "/invoices", { token: tax.token,
    body: { invoiceDate: "2026-08-06", customerName: "Local Buyer", placeOfSupply: "29",
            items: [{ description: "w", quantity: 2, unitPrice: 100, gstRate: 18 }] } });
  const g = viaGstin.data?.invoice;
  check("supply-type", "GSTIN state 29 + place 29 is intra-state (CGST+SGST)",
    viaGstin.status === 201 && g?.cgst === 18 && g?.sgst === 18 && g?.igst === 0,
    `status ${viaGstin.status} cgst ${g?.cgst} sgst ${g?.sgst} igst ${g?.igst}`);

  const across = (await call("POST", "/invoices", { token: tax.token,
    body: { invoiceDate: "2026-08-06", customerName: "Far Buyer", placeOfSupply: "27",
            items: [{ description: "w", quantity: 2, unitPrice: 100, gstRate: 18 }] } })).data?.invoice;
  check("supply-type", "GSTIN state 29 + place 27 is inter-state (IGST)",
    across?.igst === 36 && across?.cgst === 0 && across?.sgst === 0,
    `cgst ${across?.cgst} igst ${across?.igst}`);

  // "7" and "07" are the same state. Compared as raw strings they were not.
  sqlExec(`UPDATE businesses SET state_code = '07' WHERE id = ${bizId}`);
  const padded = (await call("POST", "/invoices", { token: tax.token,
    body: { invoiceDate: "2026-08-06", customerName: "Delhi Buyer", placeOfSupply: "7",
            items: [{ description: "w", quantity: 2, unitPrice: 100, gstRate: 18 }] } })).data?.invoice;
  check("supply-type", "place '7' matches state '07' (intra-state)",
    padded?.cgst === 18 && padded?.igst === 0,
    `cgst ${padded?.cgst} igst ${padded?.igst}`);

  // A place of supply that is not a state code at all used to compare unequal
  // and read as inter-state.
  const junk = await call("POST", "/invoices", { token: tax.token,
    body: { invoiceDate: "2026-08-06", customerName: "Nowhere", placeOfSupply: "ZZ",
            items: [{ description: "w", quantity: 2, unitPrice: 100, gstRate: 18 }] } });
  check("supply-type", "an invalid place of supply is rejected, not read as inter-state",
    junk.status === 400, `status ${junk.status}`);

  // The server derives the tax head; a client cannot assert it. The invoice
  // below is intra-state by its place of supply, and says otherwise in the body.
  sqlExec(`UPDATE businesses SET state_code = '29' WHERE id = ${bizId}`);
  const target = (await call("POST", "/invoices", { token: tax.token,
    body: { invoiceDate: "2026-08-07", customerName: "Local Buyer", placeOfSupply: "29",
            items: [{ description: "w", quantity: 1, unitPrice: 100, gstRate: 18 }] } })).data?.invoice;

  const claimed = await call("PATCH", `/invoices/${target.id}`, { token: tax.token,
    body: { isInterstate: true,
            items: [{ description: "w", quantity: 1, unitPrice: 100, gstRate: 18 }] } });
  const c = claimed.data;
  check("supply-type", "a client-asserted isInterstate is ignored on update",
    c?.isInterstate === false && c?.cgst === 9 && c?.sgst === 9 && c?.igst === 0,
    `isInterstate ${c?.isInterstate} cgst ${c?.cgst} igst ${c?.igst}`);

  // Moving the place of supply across a state line has to re-split the tax on
  // lines nobody edited. Previously the totals were only recomputed when items
  // were resent, so the stored split kept charging the old tax.
  const moved = await call("PATCH", `/invoices/${target.id}`, { token: tax.token,
    body: { placeOfSupply: "27" } });
  const m = moved.data;
  check("supply-type", "changing the place of supply re-splits tax without resending items",
    m?.isInterstate === true && m?.igst === 18 && m?.cgst === 0 && m?.sgst === 0,
    `isInterstate ${m?.isInterstate} cgst ${m?.cgst} igst ${m?.igst}`);
}


// === inward supply: which head the input credit falls under ================
//
// The mirror of the invoice bug, on the buy side. `calcPurchaseTotals(items)`
// was called without `isInterstate`, so every bill was booked as CGST + SGST
// whatever state the supplier was in.
{
  const buy = await register("buy");
  const buyBiz = sqlValue(`SELECT id FROM businesses WHERE user_id = ${buy.userId}`);
  sqlExec(`UPDATE businesses SET state_code = '29' WHERE id = ${buyBiz}`);
  const T = { token: buy.token };

  const local = (await call("POST", "/vendors", { ...T,
    body: { name: "Local Supplier", gstin: "29LLLLL0000L1Z5" } })).data;
  const distant = (await call("POST", "/vendors", { ...T,
    body: { name: "Distant Supplier", gstin: "27DDDDD0000D1Z5" } })).data;
  const untraceable = (await call("POST", "/vendors", { ...T, body: { name: "No GSTIN Supplier" } })).data;

  const bill = (vendorId, gstRate = 18) => call("POST", "/purchases", { ...T,
    body: { vendorId, billDate: "2026-08-05",
            items: [{ description: "raw", quantity: 10, unitPrice: 100, gstRate }] } });

  const near = (a, b) => Math.abs(a - b) < 0.005;

  const same = (await bill(local.id)).data;
  check("inward-supply", "a supplier in our state books CGST+SGST credit",
    same.isInterstate === false && near(same.cgst, 90) && near(same.sgst, 90) && near(same.igst, 0),
    `cgst ${same.cgst} sgst ${same.sgst} igst ${same.igst}`);

  const across = (await bill(distant.id)).data;
  check("inward-supply", "a supplier in another state books IGST credit",
    across.isInterstate === true && near(across.igst, 180) && near(across.cgst, 0) && near(across.sgst, 0),
    `cgst ${across.cgst} sgst ${across.sgst} igst ${across.igst}`);

  // The totals are identical either way, which is exactly why this went
  // unnoticed: only the head differs.
  check("inward-supply", "both bills total the same — only the head differs",
    near(same.grandTotal, across.grandTotal) && near(same.totalGst, across.totalGst),
    `${same.grandTotal} vs ${across.grandTotal}`);

  const blind = await bill(untraceable.id);
  check("inward-supply", "a GST-bearing bill from an untraceable supplier is refused",
    blind.status === 400, `status ${blind.status}`);
  check("inward-supply", "and the message names the vendor's GSTIN as the fix",
    /vendor's GSTIN/i.test(blind.data?.error ?? ""), blind.data?.error ?? "");

  // An unregistered supplier charges no GST, so there is no credit to misfile
  // and nothing to refuse. Blocking this would stop a real bill being recorded.
  const exempt = await bill(untraceable.id, 0);
  check("inward-supply", "a bill with no GST from the same supplier is recorded",
    exempt.status === 201 && near(exempt.data?.totalGst, 0),
    `status ${exempt.status} gst ${exempt.data?.totalGst}`);

  // Re-pointing a bill at a supplier in another state has to re-split the
  // credit on lines nobody edited...
  const moved = await call("PATCH", `/purchases/${same.id}`, { ...T, body: { vendorId: distant.id } });
  check("inward-supply", "changing the supplier re-splits the credit without resending items",
    moved.data?.isInterstate === true && near(moved.data?.igst, 180) && near(moved.data?.cgst, 0),
    `isInterstate ${moved.data?.isInterstate} cgst ${moved.data?.cgst} igst ${moved.data?.igst}`);

  // ...without re-running the catalog resolution, which adds each line's
  // quantity to stock. These are goods already received once.
  const stockAfter = sqlValue(
    `SELECT stock_quantity FROM products WHERE business_id = ${buyBiz} AND name = 'raw'`);
  check("inward-supply", "re-splitting does not double-count stock",
    near(Number(stockAfter), 30), `stock ${stockAfter} (3 bills of 10)`);
}


// === review: step-up is rate-limited by the account lockout ================
//
// `recordFailures([userKey(id)])` was written by three call sites and read by
// none, so the password confirmation guarding role changes and password resets
// could be guessed at unlimited rate behind a stolen session — each attempt
// also costing a 19 MiB Argon2 hash.
{
  const su = await register("stepup");
  sqlExec(`UPDATE users SET role='admin' WHERE id=${su.userId}`);
  const T = { token: su.token };

  const victim = await register("stepupvictim");
  sqlExec(`UPDATE users SET created_by_admin_id=${su.userId} WHERE id=${victim.userId}`);

  // Below the threshold the wrong password is simply refused.
  const first = await call("POST", `/users/${victim.userId}/reset-password`,
    { ...T, body: { newPassword: "AnotherStrongPass9!", confirmPassword: "wrong-password-1" } });
  check("step-up", "a wrong confirmation is refused", first.status === 403, `status ${first.status}`);

  // Past it the account locks, exactly as the login path does.
  let locked = null;
  for (let i = 0; i < 14 && !locked; i++) {
    const r = await call("POST", `/users/${victim.userId}/reset-password`,
      { ...T, body: { newPassword: "AnotherStrongPass9!", confirmPassword: `wrong-${i}` } });
    if (r.status === 429) locked = r;
  }
  check("step-up", "repeated wrong confirmations lock the account", Boolean(locked),
    locked ? "" : "never locked after 15 attempts");
  check("step-up", "the lockout carries Retry-After",
    Boolean(locked?.headers.get("retry-after")), String(locked?.headers.get("retry-after")));

  // And the lock holds even against the correct password — otherwise it would
  // only be slowing down someone who already knows it.
  const correct = await call("POST", `/users/${victim.userId}/reset-password`,
    { ...T, body: { newPassword: "AnotherStrongPass9!", confirmPassword: PASSWORD } });
  check("step-up", "the lockout holds against the correct password", correct.status === 429,
    `status ${correct.status}`);

  sqlExec(`DELETE FROM login_attempts WHERE key = 'user:${su.userId}'`);
  sqlExec(`UPDATE users SET role='user' WHERE id=${su.userId}`);
}

// === review: change-password is rate-limited too ===========================
{
  const cp = await register("changepw");
  const T = { token: cp.token };

  let locked = null;
  for (let i = 0; i < 15 && !locked; i++) {
    const r = await call("POST", "/auth/change-password",
      { ...T, body: { currentPassword: `wrong-${i}`, newPassword: "BrandNewStrongPass9!" } });
    if (r.status === 429) locked = r;
  }
  check("step-up", "change-password locks after repeated wrong attempts", Boolean(locked));
  const correct = await call("POST", "/auth/change-password",
    { ...T, body: { currentPassword: PASSWORD, newPassword: "BrandNewStrongPass9!" } });
  check("step-up", "and holds against the correct current password", correct.status === 429,
    `status ${correct.status}`);
  sqlExec(`DELETE FROM login_attempts WHERE key = 'user:${cp.userId}'`);
}

// === review: admin accounts can only be created by invitation ==============
{
  const mk = await register("mkadmin");
  sqlExec(`UPDATE users SET role='admin' WHERE id=${mk.userId}`);
  const T = { token: mk.token };
  const stamp = Date.now();

  const noConfirm = await call("POST", "/users", { ...T,
    body: { name: "Sneaky", email: `sneaky${stamp}@example.test`,
            password: "AttackerChosen9!x", role: "admin" } });
  check("admin-create", "creating an admin without confirmation is refused",
    noConfirm.status === 403, `status ${noConfirm.status}`);

  const confirmed = await call("POST", "/users", { ...T,
    body: { name: "Legit", email: `legit${stamp}@example.test`,
            password: "OperatorChosen9!x", role: "admin", confirmPassword: PASSWORD } });
  check("admin-create", "step-up cannot bypass the invitation-only admin flow",
    confirmed.status === 403, `status ${confirmed.status}`);
  check("admin-create", "the rejected admin account was not written",
    sqlValue(`SELECT count(*) FROM users WHERE email='legit${stamp}@example.test'`) === "0");

  // A non-admin account is not a privilege grant and needs no confirmation.
  const plain = await call("POST", "/users", { ...T,
    body: { name: "Plain", email: `plain${stamp}@example.test`,
            password: "OrdinaryUser9!xy", role: "user" } });
  check("admin-create", "an ordinary account still needs no confirmation",
    plain.status === 201, `status ${plain.status}`);
  check("admin-create", "the new account is owned by its creating admin",
    sqlValue(`SELECT created_by_admin_id FROM users WHERE id=${plain.data.id}`) === String(mk.userId));

  const dup = await call("POST", "/users", { ...T,
    body: { name: "Dup", email: `plain${stamp}@example.test`,
            password: "OrdinaryUser9!xy", role: "user" } });
  check("admin-create", "a duplicate address is a 409, not a 500", dup.status === 409,
    `status ${dup.status}`);

  sqlExec(`UPDATE users SET role='user' WHERE id=${mk.userId}`);
}

// === review: signing out revokes the token, not just the cookie ============
{
  const so = await register("signout");
  const bearer = so.token;

  const before = await call("GET", "/customers?page=1&limit=10", { token: bearer });
  check("logout", "the token works before signing out", before.status === 200, `status ${before.status}`);

  const out = await call("POST", "/auth/logout", { token: bearer });
  check("logout", "logout succeeds", out.status === 200, `status ${out.status}`);

  // The whole point: a copy of the token taken before sign-out must not work
  // after it. It used to stay valid for the rest of its seven days.
  const after = await call("GET", "/customers?page=1&limit=10", { token: bearer });
  check("logout", "the same token is rejected after signing out", after.status === 401,
    `status ${after.status}`);

  // Other sessions are untouched — this is sign-out, not sign-out-everywhere.
  const other = await call("POST", "/auth/login", { body: { email: so.email, password: PASSWORD } });
  const otherToken = other.data?.token;
  const stillIn = await call("GET", "/customers?page=1&limit=10", { token: otherToken });
  check("logout", "a different session still works", stillIn.status === 200, `status ${stillIn.status}`);
}

// === review: a payment cannot reference another tenant's records ===========
{
  const own = await register("payown");
  const other = await register("payother");

  const otherInv = (await call("POST", "/invoices", { token: other.token,
    body: { invoiceDate: "2026-08-05", customerName: "Theirs", placeOfSupply: "27",
            items: [{ description: "x", quantity: 1, unitPrice: 10, gstRate: 18 }] } })).data.invoice;
  const otherCust = (await call("POST", "/customers", { token: other.token,
    body: { name: "Their Customer" } })).data;

  const base = { type: "received", amount: 1, date: "2026-01-01", mode: "cash" };

  const crossInvoice = await call("POST", "/payments", { token: own.token,
    body: { ...base, invoiceId: otherInv.id } });
  check("payment-refs", "a payment naming another tenant's invoice is refused",
    crossInvoice.status === 400, `status ${crossInvoice.status}`);

  const crossCustomer = await call("POST", "/payments", { token: own.token,
    body: { ...base, customerId: otherCust.id } });
  check("payment-refs", "and another tenant's customer", crossCustomer.status === 400,
    `status ${crossCustomer.status}`);

  const missing = await call("POST", "/payments", { token: own.token,
    body: { ...base, vendorId: 99999999 } });
  check("payment-refs", "and a vendor that does not exist", missing.status === 400,
    `status ${missing.status}`);

  // Its own records are still accepted.
  const mine = (await call("POST", "/customers", { token: own.token, body: { name: "Mine" } })).data;
  const ok = await call("POST", "/payments", { token: own.token, body: { ...base, customerId: mine.id } });
  check("payment-refs", "its own customer is accepted", ok.status === 201, `status ${ok.status}`);
}

// === review: a failed audit write must not undo the action =================
//
// The admin routers run the whole request in one transaction, so a failed
// INSERT does not merely throw — it aborts that transaction, and Postgres turns
// the eventual COMMIT into a ROLLBACK. Catching the error let the handler return
// 200 while the change it had just made was discarded.
{
  const au = await register("auditfail");
  sqlExec(`UPDATE users SET role='admin' WHERE id=${au.userId}`);
  const target = await register("audittarget");
  sqlExec(`UPDATE users SET created_by_admin_id=${au.userId} WHERE id=${target.userId}`);

  sqlExec(`ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS tmp_reject_audit`);
  sqlExec(`ALTER TABLE audit_log ADD CONSTRAINT tmp_reject_audit CHECK (actor_email NOT LIKE 'auditfail%') NOT VALID`);

  try {
    const r = await call("PATCH", `/users/${target.userId}`,
      { token: au.token, body: { name: "Renamed Under Audit Failure" } });
    check("audit", "the action still succeeds when its audit write fails",
      r.status === 200, `status ${r.status} ${JSON.stringify(r.data)}`);

    const stored = sqlValue(`SELECT name FROM users WHERE id=${target.userId}`);
    check("audit", "and the change is actually committed, not silently rolled back",
      stored === "Renamed Under Audit Failure", `stored "${stored}"`);
  } finally {
    sqlExec(`ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS tmp_reject_audit`);
    sqlExec(`UPDATE users SET role='user' WHERE id=${au.userId}`);
  }
}

// === review: one definition of low stock ===================================
{
  const ls = await register("lowstock");
  const T = { token: ls.token };
  const bizId = sqlValue(`SELECT id FROM businesses WHERE user_id = ${ls.userId}`);

  // The case that broke it: a product with no threshold, which is every product
  // created from a purchase bill. `0 <= NULL` is NULL, so the products list
  // silently omitted it while the dashboard counted it.
  await call("POST", "/products", { ...T, body: { name: "No Threshold", unit: "Nos", sellingPrice: 10 } });
  sqlExec(`UPDATE products SET stock_quantity = 0, low_stock_threshold = NULL
           WHERE business_id = ${bizId} AND name = 'No Threshold'`);
  await call("POST", "/products", { ...T,
    body: { name: "Plenty", unit: "Nos", sellingPrice: 10, stockQuantity: 500, lowStockThreshold: 5 } });

  const list = (await call("GET", "/products?lowStock=true&page=1&limit=50", T)).data;
  const listed = (list.products ?? list).map((p) => p.name);
  const stats = (await call("GET", "/dashboard/stats", T)).data;
  const lowList = (await call("GET", "/dashboard/low-stock", T)).data;
  const stock = (await call("GET", "/reports/stock", T)).data;

  check("low-stock", "a product with no threshold appears in the filtered list",
    listed.includes("No Threshold"), listed.join(", ") || "(none)");
  check("low-stock", "the three surfaces agree on the count",
    stats.lowStockCount === listed.length && lowList.length === listed.length &&
      stock.lowStockProducts === listed.length,
    `list ${listed.length} stats ${stats.lowStockCount} lowList ${lowList.length} report ${stock.lowStockProducts}`);
  check("low-stock", "a well-stocked product is in none of them",
    !listed.includes("Plenty"), listed.join(", "));
}

// === review: top-products is aggregated, and names its products ============
{
  const tp = await register("topprod");
  const T = { token: tp.token };
  const mk = (name, qty, price) => call("POST", "/invoices", { ...T,
    body: { invoiceDate: "2026-08-05", customerName: "C", placeOfSupply: "27",
            items: [{ description: name, quantity: qty, unitPrice: price, gstRate: 18 }] } });

  await mk("Big Seller", 10, 1000);
  await mk("Small Seller", 1, 10);

  const top = (await call("GET", "/dashboard/top-products", T)).data;
  check("top-products", "ranks by revenue",
    Array.isArray(top) && top[0]?.productName === "Big Seller",
    JSON.stringify(top?.slice(0, 2)));
  // The old code read `item.productName`, a field nothing writes, so every name
  // came back undefined and walk-in lines all collided on one key.
  check("top-products", "products are named, not undefined",
    top.every((p) => typeof p.productName === "string" && p.productName.length > 0),
    JSON.stringify(top.map((p) => p.productName)));
  check("top-products", "returns at most five", top.length <= 5, String(top.length));
}

// === review: stock movements reverse ======================================
{
  const st = await register("stockmove");
  const T = { token: st.token };
  const bizId = sqlValue(`SELECT id FROM businesses WHERE user_id = ${st.userId}`);
  const stockOf = (name) =>
    Number(sqlValue(`SELECT stock_quantity FROM products WHERE business_id=${bizId} AND name='${name}'`));

  const prod = (await call("POST", "/products", { ...T,
    body: { name: "Movable", unit: "Nos", sellingPrice: 100, gstRate: 18, stockQuantity: 100 } })).data;

  const inv = (await call("POST", "/invoices", { ...T,
    body: { invoiceDate: "2026-08-05", customerName: "C", placeOfSupply: "27",
            items: [{ productId: prod.id, description: "Movable", quantity: 10, unitPrice: 100, gstRate: 18 }] } })).data.invoice;
  check("stock", "selling 10 of 100 leaves 90", stockOf("Movable") === 90, String(stockOf("Movable")));

  await call("PATCH", `/invoices/${inv.id}`, { ...T,
    body: { items: [{ productId: prod.id, description: "Movable", quantity: 1, unitPrice: 100, gstRate: 18 }] } });
  check("stock", "editing the sale down to 1 leaves 99", stockOf("Movable") === 99, String(stockOf("Movable")));

  // Invoices are cancelled, not deleted: the number stays on record and the
  // goods come back.
  const del = await call("DELETE", `/invoices/${inv.id}`, T);
  check("stock", "an issued invoice cannot be deleted", del.status === 409, `status ${del.status}`);
  check("stock", "and the refused delete moved no stock", stockOf("Movable") === 99, String(stockOf("Movable")));

  await call("PATCH", `/invoices/${inv.id}/status`, { ...T, body: { status: "cancelled" } });
  check("stock", "cancelling the invoice restores the goods", stockOf("Movable") === 100, String(stockOf("Movable")));

  await call("PATCH", `/invoices/${inv.id}/status`, { ...T, body: { status: "cancelled" } });
  check("stock", "a second cancel does not return the goods twice", stockOf("Movable") === 100, String(stockOf("Movable")));

  const vend = (await call("POST", "/vendors", { ...T, body: { name: "SV", gstin: "27SVSVS0000V1Z5" } })).data;
  const bill = (await call("POST", "/purchases", { ...T,
    body: { vendorId: vend.id, billDate: "2026-08-05",
            items: [{ description: "Movable", quantity: 50, unitPrice: 10, gstRate: 18 }] } })).data;
  check("stock", "receiving 50 leaves 150", stockOf("Movable") === 150, String(stockOf("Movable")));

  await call("PATCH", `/purchases/${bill.id}`, { ...T,
    body: { items: [{ description: "Movable", quantity: 50, unitPrice: 10, gstRate: 18 }] } });
  check("stock", "re-saving the same bill does not double-count", stockOf("Movable") === 150,
    String(stockOf("Movable")));

  await call("DELETE", `/purchases/${bill.id}`, T);
  check("stock", "deleting the bill removes the goods again", stockOf("Movable") === 100,
    String(stockOf("Movable")));
}

// === check-up: stock follows the stored product and the document type =====
{
  const st = await register("stockfix");
  const T = { token: st.token };
  const bizId = sqlValue(`SELECT id FROM businesses WHERE user_id = ${st.userId}`);
  const stockById = (id) => Number(sqlValue(`SELECT stock_quantity FROM products WHERE id=${id}`));
  const line = (prod, qty, extra = {}) => ({ productId: prod?.id, description: prod?.name ?? "Ghost", quantity: qty, unitPrice: 100, gstRate: 18, ...extra });
  const mk = async (name, qty) => (await call("POST", "/products", { ...T,
    body: { name, unit: "Nos", sellingPrice: 100, gstRate: 18, stockQuantity: qty } })).data;
  const sale = (items, type) => call("POST", "/invoices", { ...T,
    body: { invoiceDate: "2026-08-05", customerName: "C", placeOfSupply: "27", ...(type ? { type } : {}), items } });

  // Renaming a product after a sale must not strand the reversal.
  const renamed = await mk("Before Rename", 100);
  const inv1 = (await sale([line(renamed, 10)])).data.invoice;
  await call("PATCH", `/products/${renamed.id}`, { ...T, body: { name: "After Rename", unit: "Nos", sellingPrice: 100, gstRate: 18 } });
  await call("PATCH", `/invoices/${inv1.id}/status`, { ...T, body: { status: "cancelled" } });
  check("stock-fix", "cancelling after the product was renamed still restores its stock",
    stockById(renamed.id) === 100, String(stockById(renamed.id)));

  // A name that matched nothing at sale time must not match a product created later.
  const inv2 = (await sale([{ description: "Late Product", quantity: 5, unitPrice: 100, gstRate: 18 }])).data.invoice;
  const late = await mk("Late Product", 20);
  await call("PATCH", `/invoices/${inv2.id}/status`, { ...T, body: { status: "cancelled" } });
  check("stock-fix", "cancelling does not credit a product created after the sale",
    stockById(late.id) === 20, String(stockById(late.id)));

  // A product id from another business is not stored on the line.
  const foreign = (await call("POST", "/products", { token: alice.token,
    body: { name: "Foreign", unit: "Nos", sellingPrice: 1, gstRate: 0, stockQuantity: 50 } })).data;
  const inv3 = (await sale([{ productId: foreign.id, description: "Not Mine", quantity: 1, unitPrice: 100, gstRate: 18 }])).data.invoice;
  check("stock-fix", "a foreign product id is replaced, not stored",
    (inv3.items?.[0]?.productId ?? null) === null, JSON.stringify(inv3.items?.[0]));
  check("stock-fix", "and the foreign product's stock is untouched", stockById(foreign.id) === 50, String(stockById(foreign.id)));

  // Proforma moves nothing; a credit note brings goods back.
  const goods = await mk("Directional", 100);
  const pro = (await sale([line(goods, 10)], "Proforma Invoice")).data.invoice;
  check("stock-fix", "a proforma invoice does not deduct stock", stockById(goods.id) === 100, String(stockById(goods.id)));
  const cn = (await sale([line(goods, 4)], "Credit Note")).data.invoice;
  check("stock-fix", "a credit note returns goods to stock", stockById(goods.id) === 104, String(stockById(goods.id)));
  await call("PATCH", `/invoices/${cn.id}/status`, { ...T, body: { status: "cancelled" } });
  check("stock-fix", "cancelling a credit note takes them out again", stockById(goods.id) === 100, String(stockById(goods.id)));
  await call("PATCH", `/invoices/${pro.id}/status`, { ...T, body: { status: "cancelled" } });
  check("stock-fix", "cancelling a proforma moves no stock", stockById(goods.id) === 100, String(stockById(goods.id)));

  // Changing the type moves stock to match.
  const flip = (await sale([line(goods, 10)])).data.invoice;
  check("stock-fix", "a tax invoice deducts", stockById(goods.id) === 90, String(stockById(goods.id)));
  await call("PATCH", `/invoices/${flip.id}`, { ...T, body: { type: "Proforma Invoice" } });
  check("stock-fix", "turning it into a proforma gives the goods back", stockById(goods.id) === 100, String(stockById(goods.id)));

  // No receipts against a quotation or a credit note.
  const pro2 = (await sale([line(goods, 1)], "Proforma Invoice")).data.invoice;
  const payPro = await call("POST", "/payments", { ...T, body: { type: "received", amount: 10, date: "2026-08-06", mode: "cash", invoiceId: pro2.id } });
  check("stock-fix", "a receipt against a proforma is refused", payPro.status === 409, `status ${payPro.status}`);
  const cn2 = (await sale([line(goods, 1)], "Credit Note")).data.invoice;
  const payCn = await call("POST", "/payments", { ...T, body: { type: "received", amount: 10, date: "2026-08-06", mode: "cash", invoiceId: cn2.id } });
  check("stock-fix", "a receipt against a credit note is refused", payCn.status === 409, `status ${payCn.status}`);

  // Whole paise only.
  const real = (await sale([line(goods, 1)])).data.invoice;
  const frac = await call("POST", "/payments", { ...T, body: { type: "received", amount: 0.001, date: "2026-08-06", mode: "cash", invoiceId: real.id } });
  check("stock-fix", "a payment finer than a paisa is refused", frac.status === 400, `status ${frac.status}`);
  const fracPaid = await call("PATCH", `/invoices/${real.id}/status`, { ...T, body: { status: "partial", paidAmount: 10.005 } });
  check("stock-fix", "a paid amount finer than a paisa is refused", fracPaid.status === 400, `status ${fracPaid.status}`);

  // Once money has been received the figures are frozen.
  await call("POST", "/payments", { ...T, body: { type: "received", amount: 10, date: "2026-08-06", mode: "cash", invoiceId: real.id } });
  const frozen = await call("PATCH", `/invoices/${real.id}`, { ...T, body: { items: [line(goods, 3)] } });
  check("stock-fix", "a part-paid invoice's lines cannot be edited", frozen.status === 409, `status ${frozen.status}`);

  // Two concurrent deletes of one purchase return the goods once.
  const vend = (await call("POST", "/vendors", { ...T, body: { name: "SF Vendor", gstin: "27SVSVS0000V1Z5" } })).data;
  const bill = (await call("POST", "/purchases", { ...T,
    body: { vendorId: vend.id, billDate: "2026-08-05", items: [{ productId: goods.id, description: goods.name, quantity: 30, unitPrice: 10, gstRate: 18 }] } })).data;
  const before = stockById(goods.id);
  await Promise.all([call("DELETE", `/purchases/${bill.id}`, T), call("DELETE", `/purchases/${bill.id}`, T)]);
  check("stock-fix", "concurrent deletes of a bill reverse its goods once",
    stockById(goods.id) === before - 30, `${before} -> ${stockById(goods.id)}`);

  // Concurrent edits leave totals that match the lines that won.
  const racer = await mk("Racer", 1000);
  const rinv = (await sale([line(racer, 1)])).data.invoice;
  await Promise.all([2, 3, 4, 5].map((q) => call("PATCH", `/invoices/${rinv.id}`, { ...T, body: { items: [line(racer, q)] } })));
  const final = (await call("GET", `/invoices/${rinv.id}`, T)).data;
  const qty = final.items[0].quantity;
  check("stock-fix", "after racing edits the total matches the surviving line",
    Math.abs(final.subtotal - qty * 100) < 0.005, `qty ${qty} subtotal ${final.subtotal}`);
  check("stock-fix", "and stock matches the surviving quantity", stockById(racer.id) === 1000 - qty,
    `qty ${qty} stock ${stockById(racer.id)}`);
}

// === check-up: one business cannot hold the whole pool ====================
{
  const burst = await register("burst");
  const T = { token: burst.token };
  const rs = await Promise.all(Array.from({ length: 80 }, () => call("GET", "/dashboard/stats", T)));
  const codes = new Set(rs.map((r) => r.status));
  check("in-flight", "a burst of 80 concurrent requests gets only 200s and 429s",
    [...codes].every((c) => c === 200 || c === 429), [...codes].join(","));
  check("in-flight", "some of the burst was served", rs.some((r) => r.status === 200));
  const after = await call("GET", "/dashboard/stats", T);
  check("in-flight", "the slots are released when the burst is over", after.status === 200, `status ${after.status}`);
  // Another tenant is unaffected while this one is saturated.
  const other = await register("burstother");
  const mixed = await Promise.all([
    ...Array.from({ length: 40 }, () => call("GET", "/dashboard/stats", T)),
    call("GET", "/dashboard/stats", { token: other.token }),
  ]);
  check("in-flight", "a different business is served during another's burst",
    mixed[mixed.length - 1].status === 200, `status ${mixed[mixed.length - 1].status}`);
  // Authentication comes before the policy-free scope on admin routes.
  const anon = await call("GET", "/admin/stats", {});
  check("in-flight", "an unauthenticated admin request is refused", anon.status === 401, `status ${anon.status}`);
  const nonAdmin = await call("GET", "/admin/stats", T);
  check("in-flight", "a non-admin admin request is refused", nonAdmin.status === 403, `status ${nonAdmin.status}`);
}

// === check-up: parallel password guesses are counted before they are checked ==
{
  const g = await register("parallelguess");
  const guess = (i) => call("POST", "/auth/change-password", {
    token: g.token, body: { currentPassword: `wrong-guess-number-${i}-zz`, newPassword: "an-entirely-new-passphrase-77" },
  });
  // Under the in-flight cap, so the refusals counted are the lockout's own.
  const first = await Promise.all(Array.from({ length: 14 }, (_, i) => guess(i)));
  const second = await Promise.all(Array.from({ length: 14 }, (_, i) => guess(i + 14)));
  const codes = [...first, ...second].map((r) => r.status);
  const evaluated = codes.filter((c) => c === 403).length;
  check("parallel-guess", "no more guesses are evaluated than the threshold allows",
    evaluated <= 10, `${evaluated} evaluated of ${codes.length}`);
  check("parallel-guess", "the rest are refused as locked out", codes.filter((c) => c === 429).length >= codes.length - 10,
    codes.join(","));
  check("parallel-guess", "even the correct password is refused while locked",
    (await call("POST", "/auth/change-password", { token: g.token, body: { currentPassword: PASSWORD, newPassword: "an-entirely-new-passphrase-77" } })).status === 429);
}

// === review: marking an invoice paid settles it and records the payment ====
{
  const pd = await register("paid");
  const T = { token: pd.token };

  const inv = (await call("POST", "/invoices", { ...T,
    body: { invoiceDate: "2026-08-05", customerName: "C", placeOfSupply: "27",
            items: [{ description: "x", quantity: 1, unitPrice: 1000, gstRate: 18 }] } })).data.invoice;

  const paid = (await call("PATCH", `/invoices/${inv.id}/status`, { ...T,
    body: { paymentStatus: "paid" } })).data;
  check("payments", "marking paid settles the balance",
    paid.status === "paid" && paid.paidAmount === paid.grandTotal && paid.balanceDue === 0,
    `paid ${paid.paidAmount} of ${paid.grandTotal}, due ${paid.balanceDue}`);

  const list = (await call("GET", "/payments?page=1&limit=10", T)).data;
  const row = list.payments?.[0];
  check("payments", "a receipt is recorded for it", list.payments?.length === 1, String(list.payments?.length));
  // The page reads these exact names; it used to read paymentType/paymentDate/
  // paymentMethod/reference, none of which the API has ever returned.
  check("payments", "and carries the fields the page reads",
    row?.type === "received" && typeof row?.date === "string" && typeof row?.mode === "string"
      && row?.invoiceId === inv.id && row?.amount === paid.grandTotal,
    JSON.stringify(row));
}

// === review: reports summarise the whole range, and cap the rows ===========
{
  const rp = await register("reports");
  const T = { token: rp.token };
  for (let i = 1; i <= 3; i++) {
    await call("POST", "/invoices", { ...T,
      body: { invoiceDate: `2026-08-0${i}`, customerName: "C", placeOfSupply: "27",
              items: [{ description: "x", quantity: 1, unitPrice: 100, gstRate: 18 }] } });
  }
  const sales = (await call("GET", "/reports/sales?fromDate=2026-08-01&toDate=2026-08-31", T)).data;
  check("reports", "the count covers the whole range", sales.invoiceCount === 3,
    String(sales.invoiceCount));
  check("reports", "totals are computed in SQL over the range",
    Math.abs(sales.totalSales - 354) < 0.005, String(sales.totalSales));
  check("reports", "a small result is not marked truncated", sales.truncated === false,
    String(sales.truncated));
}


// === review: only tax documents count toward the figures that are filed ====
//
// Every report added up every invoice and bill in the range whatever its state,
// so a cancelled invoice stayed in GSTR-1, a cancelled bill stayed in GSTR-3B as
// input credit, and a credit note ADDED to the liability it exists to reduce.
{
  const td = await register("taxdocs");
  const T = { token: td.token };
  await call("PATCH", "/business", { ...T, body: { stateCode: "29" } });
  const mk = (extra, unitPrice = 1000, date = "2026-08-10") => call("POST", "/invoices", {
    ...T, body: { invoiceDate: date, customerName: "C", placeOfSupply: "29",
      items: [{ description: "x", quantity: 1, unitPrice, gstRate: 18 }], ...extra },
  });

  const kept = (await mk({})).data.invoice;                          // 1000 + 180 = 1180
  const cancelled = (await mk({})).data.invoice;                     // cancelled below
  await mk({ type: "Proforma Invoice" });                            // not a supply
  await mk({ type: "Credit Note" }, 200);                            // 200 + 36 = 236, subtracts
  await call("PATCH", `/invoices/${cancelled.id}/status`, { ...T, body: { status: "cancelled" } });

  const bad = await mk({ type: "Whatever I like" });
  check("tax-docs", "an invoice type outside the known set is refused", bad.status === 400, `status ${bad.status}`);

  const g1 = (await call("GET", "/reports/gstr1?month=8&year=2026", T)).data;
  check("tax-docs", "GSTR-1 leaves out the cancelled invoice and the proforma",
    g1.totalInvoices === 2, `${g1.totalInvoices} invoices`);
  check("tax-docs", "and nets the credit note against the sale",
    g1.totalTaxable === 800 && g1.totalCgst === 72 && g1.totalSgst === 72 && g1.totalAmount === 944,
    `taxable ${g1.totalTaxable} cgst ${g1.totalCgst} sgst ${g1.totalSgst} total ${g1.totalAmount}`);

  const g3 = (await call("GET", "/reports/gstr3b?month=8&year=2026", T)).data;
  check("tax-docs", "GSTR-3B output tax is the same netted figure",
    g3.outwardTaxable === 800 && g3.outwardCgst === 72 && g3.outwardSgst === 72,
    `taxable ${g3.outwardTaxable} cgst ${g3.outwardCgst}`);

  const sales = (await call("GET", "/reports/sales?fromDate=2026-08-01&toDate=2026-08-31", T)).data;
  check("tax-docs", "the sales report agrees",
    sales.totalSales === 944 && sales.totalGst === 144 && sales.invoiceCount === 2,
    `sales ${sales.totalSales} gst ${sales.totalGst} count ${sales.invoiceCount}`);

  const stats = (await call("GET", "/dashboard/stats", T)).data;
  check("tax-docs", "and so does the dashboard",
    stats.totalSales === 944 && stats.totalGstPayable === 144, `sales ${stats.totalSales} payable ${stats.totalGstPayable}`);
  check("tax-docs", "what is outstanding is the sale alone — not a credit note, proforma or cancelled invoice",
    stats.totalOutstanding === 1180, String(stats.totalOutstanding));

  // Part-payment reduces what is outstanding; it used to be ignored entirely
  // because only status 'unpaid' was counted.
  await call("PATCH", `/invoices/${kept.id}/status`, { ...T, body: { paymentStatus: "partial", paidAmount: 400 } });
  const afterPart = (await call("GET", "/dashboard/stats", T)).data;
  check("tax-docs", "a part-payment reduces the outstanding balance",
    afterPart.totalOutstanding === 780, String(afterPart.totalOutstanding));

  // An HSN code is caller-supplied text; some spellings are members of
  // Object.prototype, and used as object keys they broke the whole report.
  await mk({ items: [
    { description: "p", quantity: 1, unitPrice: 100, gstRate: 18, hsnCode: "constructor" },
    { description: "q", quantity: 1, unitPrice: 100, gstRate: 18, hsnCode: "__proto__" },
  ] }, 100, "2026-07-10");
  const hsn = await call("GET", "/reports/hsn?month=7&year=2026", T);
  check("tax-docs", "an HSN code named after an object member does not break the report",
    hsn.status === 200 && hsn.data.items?.some((i) => i.hsnCode === "constructor"),
    `status ${hsn.status}`);

  // The buy side: a cancelled bill is not input credit, and its goods go back.
  const vendor = (await call("POST", "/vendors", { ...T, body: { name: "TD Vendor", gstin: "29TDTDT0000T1Z5" } })).data;
  const bill = (p) => call("POST", "/purchases", { ...T, body: { vendorId: vendor.id, billDate: "2026-08-12",
    items: [{ description: "Bought Thing", quantity: 10, unitPrice: 500, gstRate: 18 }], ...p } });
  const b1 = (await bill({})).data;
  const b2 = (await bill({})).data;                                   // 500 * 10 = 5000, gst 900
  const bizId = sqlValue(`SELECT id FROM businesses WHERE user_id = ${td.userId}`);
  const thingStock = () => Number(sqlValue(`SELECT stock_quantity FROM products WHERE business_id=${bizId} AND name='Bought Thing'`));
  check("tax-docs", "two bills of 10 leave 20 in stock", thingStock() === 20, String(thingStock()));

  await call("PATCH", `/purchases/${b2.id}`, { ...T, body: { paymentStatus: "cancelled" } });
  check("tax-docs", "cancelling a bill returns its goods", thingStock() === 10, String(thingStock()));
  const g3b = (await call("GET", "/reports/gstr3b?month=8&year=2026", T)).data;
  check("tax-docs", "and removes its input credit from GSTR-3B",
    g3b.inputCgst === 450 && g3b.inputSgst === 450, `cgst ${g3b.inputCgst} sgst ${g3b.inputSgst}`);

  const again = await call("PATCH", `/purchases/${b2.id}`, { ...T, body: { paymentStatus: "cancelled" } });
  check("tax-docs", "a cancelled bill is final", again.status === 409, `status ${again.status}`);
  check("tax-docs", "and a second cancel does not return the goods twice", thingStock() === 10, String(thingStock()));
  const revive = await call("PATCH", `/purchases/${b2.id}`, { ...T, body: { paymentStatus: "unpaid" } });
  check("tax-docs", "it cannot be revived", revive.status === 409, `status ${revive.status}`);
  void b1;
}

// === review: an invoice and its payments cannot disagree ===================
//
// `paidAmount` was accepted up to 1e12 whatever the invoice totalled; lowering
// it and cancelling left the receipts behind; two concurrent "mark paid" calls
// each wrote a receipt; and POST /payments never touched the invoice it named.
{
  const lg = await register("ledger");
  const T = { token: lg.token };
  await call("PATCH", "/business", { ...T, body: { stateCode: "29" } });
  const mk = (unitPrice = 1000) => call("POST", "/invoices", { ...T, body: {
    invoiceDate: "2026-08-10", customerName: "C", placeOfSupply: "29",
    items: [{ description: "x", quantity: 1, unitPrice, gstRate: 18 }] } });
  const status = (id, body) => call("PATCH", `/invoices/${id}/status`, { ...T, body });
  const ledger = (id) => Number(sqlValue(
    `SELECT coalesce(sum(CASE WHEN type IN ('received','in') THEN amount ELSE -amount END), 0)
       FROM payments WHERE invoice_id = ${id}`));

  const inv = (await mk()).data.invoice;                              // 1180
  const part = await status(inv.id, { paymentStatus: "partial", paidAmount: 400 });
  check("ledger", "a part-payment is 'partial' with the balance still due",
    part.data.status === "partial" && part.data.paidAmount === 400 && part.data.balanceDue === 780,
    JSON.stringify([part.data.status, part.data.paidAmount, part.data.balanceDue]));

  const over = await status(inv.id, { paidAmount: 5000 });
  check("ledger", "paying more than the invoice total is refused", over.status === 409, `status ${over.status}`);
  const mismatch = await status(inv.id, { paymentStatus: "paid", paidAmount: 500 });
  check("ledger", "a status that contradicts the amount is refused", mismatch.status === 400, `status ${mismatch.status}`);
  const noAmount = await status((await mk()).data.invoice.id, { paymentStatus: "partial" });
  check("ledger", "'partial' with no amount is refused rather than guessed", noAmount.status === 400, `status ${noAmount.status}`);

  const edit = await call("PATCH", `/invoices/${inv.id}`, { ...T, body: {
    items: [{ description: "x", quantity: 1, unitPrice: 1, gstRate: 18 }] } });
  check("ledger", "the figures of an invoice with payments cannot be edited", edit.status === 409, `status ${edit.status}`);
  const note = await call("PATCH", `/invoices/${inv.id}`, { ...T, body: { notes: "call on Monday" } });
  check("ledger", "but its notes can", note.status === 200, `status ${note.status}`);

  const pay = (body) => call("POST", "/payments", { ...T, body: {
    type: "received", date: "2026-08-11", mode: "upi", invoiceId: inv.id, ...body } });
  const rest = await pay({ amount: 780 });
  check("ledger", "a payment naming the invoice is applied to it", rest.status === 201, `status ${rest.status}`);
  const settled = (await call("GET", `/invoices/${inv.id}`, T)).data;
  check("ledger", "which settles it", settled.status === "paid" && settled.balanceDue === 0,
    `${settled.status} due ${settled.balanceDue}`);
  check("ledger", "and the receipts add up to what the invoice says was paid",
    ledger(inv.id) === settled.paidAmount, `${ledger(inv.id)} vs ${settled.paidAmount}`);

  check("ledger", "a payment past the total is refused", (await pay({ amount: 1 })).status === 409);
  check("ledger", "a negative amount is refused", (await pay({ amount: -5 })).status === 400);
  check("ledger", "and so is zero", (await pay({ amount: 0 })).status === 400);
  check("ledger", "money going out cannot be a receipt against an invoice",
    (await pay({ amount: 5, type: "paid" })).status === 400);
  check("ledger", "an unknown payment type is refused", (await pay({ amount: 5, type: "gift" })).status === 400);

  // Undoing a payment records a reversal; the receipt is not deleted.
  const reverted = await status(inv.id, { paymentStatus: "unpaid" });
  check("ledger", "marking a paid invoice unpaid clears what was paid",
    reverted.data.status === "unpaid" && reverted.data.paidAmount === 0, JSON.stringify(reverted.data.status));
  check("ledger", "by recording a reversal rather than deleting the receipts",
    Number(sqlValue(`SELECT count(*) FROM payments WHERE invoice_id=${inv.id} AND type='paid'`)) === 1 &&
    Number(sqlValue(`SELECT count(*) FROM payments WHERE invoice_id=${inv.id} AND type='received'`)) === 2);
  check("ledger", "so the ledger still nets to the invoice", ledger(inv.id) === 0, String(ledger(inv.id)));

  // Two people marking the same invoice paid at once: one receipt, not two.
  const twice = (await mk()).data.invoice;
  await Promise.all([status(twice.id, { paymentStatus: "paid" }), status(twice.id, { paymentStatus: "paid" })]);
  check("ledger", "concurrent 'mark paid' requests record one receipt",
    Number(sqlValue(`SELECT count(*) FROM payments WHERE invoice_id=${twice.id} AND type='received'`)) === 1 &&
    ledger(twice.id) === 1180, `${sqlValue(`SELECT count(*) FROM payments WHERE invoice_id=${twice.id}`)} rows, ledger ${ledger(twice.id)}`);

  // Cancelling reverses what was received, and is final.
  const c = (await mk()).data.invoice;
  await status(c.id, { paidAmount: 500 });
  const cancelled = await status(c.id, { status: "cancelled" });
  check("ledger", "cancelling a part-paid invoice clears it",
    cancelled.data.status === "cancelled" && cancelled.data.paidAmount === 0, JSON.stringify(cancelled.data.status));
  check("ledger", "and reverses the receipt in the ledger", ledger(c.id) === 0, String(ledger(c.id)));
  check("ledger", "a cancelled invoice cannot be edited",
    (await call("PATCH", `/invoices/${c.id}`, { ...T, body: { notes: "x" } })).status === 409);
  check("ledger", "or paid", (await status(c.id, { paymentStatus: "paid" })).status === 409);
  check("ledger", "or paid through the payments endpoint",
    (await call("POST", "/payments", { ...T, body: { type: "received", amount: 5, date: "2026-08-11",
      mode: "cash", invoiceId: c.id } })).status === 409);
  check("ledger", "or deleted", (await call("DELETE", `/invoices/${c.id}`, T)).status === 409);
  check("ledger", "and an unpaid one cannot be deleted either",
    (await call("DELETE", `/invoices/${(await mk()).data.invoice.id}`, T)).status === 409);
}

// === review: concurrent stock movements are not lost =======================
//
// Stock was read, adjusted in JavaScript and written back as an absolute value,
// so two invoices raised together both started from the same quantity and the
// last write won: goods were sold twice and stock fell once.
{
  const sr = await register("stockrace");
  const T = { token: sr.token };
  await call("PATCH", "/business", { ...T, body: { stateCode: "29" } });
  const bizId = sqlValue(`SELECT id FROM businesses WHERE user_id = ${sr.userId}`);
  const prod = (await call("POST", "/products", { ...T,
    body: { name: "Raced", unit: "Nos", sellingPrice: 10, gstRate: 18, stockQuantity: 1000 } })).data;

  const line = (quantity) => [{ productId: prod.id, description: "Raced", quantity, unitPrice: 10, gstRate: 18 }];
  const stockOf = () => Number(sqlValue(`SELECT stock_quantity FROM products WHERE business_id=${bizId} AND name='Raced'`));

  // Raising invoices is already serialised by the number allocation, which locks
  // one row until the request ends — so creation alone cannot show the race.
  // Editing does not allocate a number, so edits are what run truly in parallel.
  const created = [];
  for (let i = 0; i < 10; i++) {
    created.push((await call("POST", "/invoices", { ...T, body: {
      invoiceDate: "2026-08-10", customerName: "C", placeOfSupply: "29", items: line(1) } })).data.invoice);
  }
  check("stock-race", "ten sales of 1 leave 990", stockOf() === 990, `stock ${stockOf()}`);

  const edits = await Promise.all(created.map((inv) =>
    call("PATCH", `/invoices/${inv.id}`, { ...T, body: { items: line(6) } })));
  check("stock-race", "ten concurrent edits from 1 to 6 all succeed", edits.every((r) => r.status === 200),
    edits.map((r) => r.status).join(","));
  check("stock-race", "and stock falls by exactly the 50 they added", stockOf() === 940, `stock ${stockOf()}`);
}

// === review: e-way bills are bounded ========================================
{
  const ew = await register("ewaylimits");
  const T = { token: ew.token };
  const bill = (items) => call("POST", "/eway-bills", { ...T, body: { docNo: "D1", docDate: "2026-08-10", items } });

  const big = await bill(Array.from({ length: 300 }, (_, i) => ({ n: i, note: "x".repeat(1000) })));
  check("eway", "a bill carrying far more line data than any bill needs is refused",
    big.status === 400, `status ${big.status}`);
  const fine = await bill([{ description: "goods", qty: 1 }]);
  check("eway", "an ordinary bill is accepted", fine.status === 201, `status ${fine.status}`);

  const list = await call("GET", "/eway-bills", T);
  check("eway", "the list reports a total alongside the page",
    Array.isArray(list.data.bills) && list.data.total === 1, JSON.stringify(list.data).slice(0, 80));
  check("eway", "and the page size is capped",
    (await call("GET", "/eway-bills?limit=100000", T)).status === 400);
}

// === review: an authenticated caller cannot flood the API ==================
//
// Nothing throttled an authenticated tenant, so a registered account could
// script writes without limit. The ceiling is per business: one tenant is one
// tenant however many addresses it uses.
{
  const fl = await register("flooder");
  const other = await register("bystander");
  const write = () => call("PATCH", "/business", { token: fl.token, body: { stateCode: "29" } });

  const codes = [];
  // Batches stay under the per-business in-flight cap, so what is counted here
  // is the per-minute ceiling alone.
  for (let batch = 0; batch < 27; batch++) {
    codes.push(...(await Promise.all(Array.from({ length: 12 }, write))).map((r) => r.status));
  }
  const accepted = codes.filter((c) => c === 200).length;
  const throttled = codes.filter((c) => c === 429).length;
  check("flood", "writes past the ceiling are throttled", throttled > 0, `${accepted} accepted, ${throttled} throttled`);
  check("flood", "after roughly the documented 300 a minute", accepted >= 250 && accepted <= 310, `${accepted} accepted`);

  const throttledRead = await call("GET", "/customers", { token: fl.token });
  check("flood", "reads have their own, much larger budget", throttledRead.status === 200, `status ${throttledRead.status}`);
  const bystander = await call("PATCH", "/business", { token: other.token, body: { stateCode: "29" } });
  check("flood", "another business is unaffected", bystander.status === 200, `status ${bystander.status}`);
}


// === review: a response is never sent before its transaction commits ======
//
// A request's transaction used to commit only after the response had been
// written, so a client that acted on the response at once — read what it had
// just created, or emailed a link to it — could arrive before the row was
// durable. Measured at about one create-then-use in 150; here the commit is made
// slow at the database so it happens every time instead of by chance.
{
  const cf = await register("commitfirst");
  const T = { token: cf.token };
  await call("PATCH", "/business", { ...T, body: { stateCode: "29" } });
  const inv = () => call("POST", "/invoices", { ...T, body: {
    invoiceDate: "2026-08-10", customerName: "C", placeOfSupply: "29",
    items: [{ description: "x", quantity: 1, unitPrice: 10, gstRate: 18 }] } });

  // Deferred constraint triggers run at COMMIT, so this makes every commit on
  // `invoices` take 300 ms — long enough for the next request to overtake it.
  sqlExec(`CREATE OR REPLACE FUNCTION test_slow_commit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN PERFORM pg_sleep(0.3); RETURN NULL; END'`);
  sqlExec(`DROP TRIGGER IF EXISTS test_slow_commit ON invoices`);
  sqlExec(`CREATE CONSTRAINT TRIGGER test_slow_commit AFTER INSERT ON invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_slow_commit()`);
  try {
    const created = (await inv()).data.invoice;
    check("commit-first", "the row is already committed when the response arrives",
      sqlValue(`SELECT count(*) FROM invoices WHERE id = ${created.id}`) === "1");

    const reads = [];
    for (let i = 0; i < 4; i++) {
      const made = (await inv()).data.invoice;
      reads.push((await call("GET", `/invoices/${made.id}`, T)).status);
    }
    check("commit-first", "so an invoice can be read the instant its creation returns",
      reads.every((s) => s === 200), reads.join(","));

    // A burst, each read straight after its own create.
    const burst = await Promise.all(Array.from({ length: 8 }, async () => {
      const made = (await inv()).data.invoice;
      return (await call("GET", `/invoices/${made.id}`, T)).status;
    }));
    check("commit-first", "including when many are in flight at once", burst.every((s) => s === 200), burst.join(","));
  } finally {
    sqlExec(`DROP TRIGGER IF EXISTS test_slow_commit ON invoices`);
  }
}

// === review: a failed commit is reported as a failure =======================
//
// Because the response went out first, a transaction that failed at COMMIT — a
// deferred constraint, a serialisation failure — had already told the client it
// succeeded. The write was gone and the client was never told.
{
  const fc = await register("commitfail");
  const T = { token: fc.token };
  sqlExec(`CREATE OR REPLACE FUNCTION test_reject_commit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.name = ''COMMITFAIL'' THEN RAISE EXCEPTION ''rejected at commit''; END IF; RETURN NULL; END'`);
  sqlExec(`DROP TRIGGER IF EXISTS test_reject_commit ON customers`);
  sqlExec(`CREATE CONSTRAINT TRIGGER test_reject_commit AFTER INSERT ON customers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_reject_commit()`);
  try {
    const bad = await call("POST", "/customers", { ...T, body: { name: "COMMITFAIL" } });
    check("commit-fail", "a write that cannot commit is answered with an error, not success",
      bad.status === 500, `status ${bad.status}`);
    check("commit-fail", "the error carries a request id and nothing else",
      typeof bad.data?.requestId !== "undefined" && Object.keys(bad.data ?? {}).sort().join() === "error,requestId",
      JSON.stringify(bad.data));
    check("commit-fail", "and nothing was stored",
      sqlValue(`SELECT count(*) FROM customers WHERE name = 'COMMITFAIL'`) === "0");

    const good = await call("POST", "/customers", { ...T, body: { name: "Committable" } });
    check("commit-fail", "the connection is healthy afterwards", good.status === 201, `status ${good.status}`);
  } finally {
    sqlExec(`DROP TRIGGER IF EXISTS test_reject_commit ON customers`);
  }
}

// === review: clients that give up do not strand connections =================
//
// The response is now held until the commit, so a request whose client has gone
// must still finish and release its connection, or the pool drains.
{
  const ab = await register("abandoned");
  const T = { token: ab.token };
  await Promise.allSettled(Array.from({ length: 30 }, (_, i) => {
    const controller = new AbortController();
    const sent = fetch(`${B}/customers`, { method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${ab.token}` },
      body: JSON.stringify({ name: `Gone ${i}` }) });
    setTimeout(() => controller.abort(), 2);
    return sent;
  }));
  const after = await Promise.all(Array.from({ length: 16 }, () => call("GET", "/customers", T)));
  check("abandoned", "after 30 abandoned requests the pool still serves 16 at once",
    after.every((r) => r.status === 200), after.map((r) => r.status).join(","));

  // A request left holding its transaction shows up here as `idle in transaction`.
  let open = -1;
  for (let i = 0; i < 20 && open !== 0; i++) {
    open = Number(sqlValue(
      `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'`));
    if (open !== 0) await new Promise((r) => setTimeout(r, 100));
  }
  check("abandoned", "and none of them is left holding a transaction open", open === 0, `${open} open`);
}


// === review: hostile input is a 400, never a 500 ===========================
//
// Found by sending malformed input to every write route: a NUL character in any
// text field, a PATCH that validates down to nothing, ids written as `0x10` or
// `1e3`, ids beyond the integer column, dates that do not exist, and amounts that
// each fit a field but overflow the column when multiplied. All were 500s.
{
  const hi = await register("hostile");
  const T = { token: hi.token };
  await call("PATCH", "/business", { ...T, body: { stateCode: "29" } });
  const cust = (await call("POST", "/customers", { ...T, body: { name: "Real Customer" } })).data;
  const vend = (await call("POST", "/vendors", { ...T, body: { name: "Real Vendor" } })).data;
  const prod = (await call("POST", "/products", { ...T, body: { name: "Real Product", unit: "Nos", gstRate: 18 } })).data;
  const line = (extra = {}) => ({ description: "x", quantity: 1, unitPrice: 10, gstRate: 18, ...extra });
  const inv = (body) => call("POST", "/invoices", { ...T, body: { invoiceDate: "2026-08-10", customerName: "C", placeOfSupply: "29", items: [line()], ...body } });
  const is400 = (r) => r.status === 400;

  check("hostile", "a NUL character in a body field is refused", is400(await call("POST", "/customers", { ...T, body: { name: "a\u0000b" } })));
  check("hostile", "in a nested value too", is400(await inv({ items: [line({ description: "x\u0000" })] })));
  check("hostile", "in a query string", is400(await call("GET", "/customers?search=%00", T)));
  check("hostile", "and in a path parameter", is400(await call("GET", "/customers/%00", T)));

  for (const [label, path, body] of [["customers", `/customers/${cust.id}`, {}], ["vendors", `/vendors/${vend.id}`, {}],
                                       ["products", `/products/${prod.id}`, {}], ["a body of only unknown keys", `/customers/${cust.id}`, { nope: 1 }]]) {
    const r = await call("PATCH", path, { ...T, body });
    check("hostile", `an update that changes nothing is a 400 (${label})`, is400(r), `status ${r.status}`);
  }

  check("hostile", "an id written as hex is not an id", is400(await call("GET", `/customers/0x${cust.id.toString(16)}`, T)));
  check("hostile", "nor one written with an exponent", is400(await call("GET", "/customers/1e3", T)));
  check("hostile", "an id past the integer column in a query is a 400", is400(await call("GET", "/invoices?customerId=99999999999", T)));
  check("hostile", "in a body", is400(await call("POST", "/payments", { ...T, body: { type: "received", amount: 1, date: "2026-08-10", mode: "cash", customerId: 99999999999 } })));
  check("hostile", "in a line item", is400(await inv({ items: [line({ productId: 99999999999 })] })));

  for (const bad of ["2026-04-31", "2026-02-29", "2026-13-01", "2026-00-10", "1999-12-31", "2101-01-01"]) {
    check("hostile", `${bad} is not accepted as an invoice date`, is400(await inv({ invoiceDate: bad })), bad);
  }
  check("hostile", "a leap day that exists is accepted", (await inv({ invoiceDate: "2028-02-29" })).status === 201);

  check("hostile", "a single line that overflows the money column is a 400",
    is400(await inv({ items: [line({ quantity: 1e9, unitPrice: 1e12 })] })));
  check("hostile", "so is a document whose lines add up past it",
    is400(await inv({ items: Array.from({ length: 20 }, () => line({ quantity: 1, unitPrice: 9e10 })) })));

  // An empty due date means "no due date" — it was stored as "" and counted as overdue for ever.
  const noDue = await inv({ dueDate: "" });
  check("hostile", "an empty due date is stored as none", noDue.status === 201 && noDue.data.invoice.dueDate === null,
    JSON.stringify(noDue.data?.invoice?.dueDate));
  const overdue = (await call("GET", "/dashboard/stats", T)).data.overdueInvoiceCount;
  check("hostile", "and does not make the invoice overdue", overdue === 0, String(overdue));

  // An administrator marking an account expired has to mean something.
  sqlExec(`UPDATE users SET subscription_status='expired', subscription_end=NULL WHERE id=${hi.userId}`);
  const blocked = await call("GET", "/customers", T);
  check("hostile", "an account marked expired is refused, with no end date set", blocked.status === 403, `status ${blocked.status}`);
  const relog = await call("POST", "/auth/login", { body: { email: hi.email, password: PASSWORD } });
  check("hostile", "and cannot sign in again", relog.status === 403, `status ${relog.status}`);
  sqlExec(`UPDATE users SET subscription_status='trial' WHERE id=${hi.userId}`);
}

// === F-14: registration tells you nothing about an address =================
//
// The endpoint used to answer 400 "Email already registered" for a taken
// address and 201 with a session for a free one, so one request tested whether
// anyone had an account. It now answers identically either way and settles the
// difference by email.
{
  const stamp = Date.now();
  const submit = (email) => call("POST", "/auth/register", {
    body: { name: "Probe", email,
            businessName: "Probe Traders", gstin: "27AAAAA0000A1Z5" },
  });
  const verifyWith = (token) => call("POST", "/auth/verify-registration", { body: { token, password: PASSWORD } });

  // An address nobody has registered.
  const freeEmail = `f14free${stamp}@example.test`;
  const free = await submit(freeEmail);

  // The suite's own registered account, so this one certainly exists.
  const taken = await submit(alice.email);

  check("F-14", "a free address returns 202", free.status === 202, `status ${free.status}`);
  check("F-14", "a taken address returns the same status", taken.status === free.status,
    `free ${free.status} vs taken ${taken.status}`);
  check("F-14", "and byte-identical bodies",
    JSON.stringify(free.data) === JSON.stringify(taken.data),
    `${JSON.stringify(free.data)} vs ${JSON.stringify(taken.data)}`);
  check("F-14", "the body promises nothing either way",
    !/already|exists|taken|registered account/i.test(free.data?.message ?? ""),
    free.data?.message ?? "");

  // The difference goes to the mailbox instead, and only to it.
  const toFree = outbox().filter((m) => m.to === freeEmail);
  const toTaken = outbox().filter((m) => m.to === alice.email);
  check("F-14", "the free address is sent a link",
    toFree.some((m) => /verify[?#]token=/.test(m.text ?? "")));
  check("F-14", "the taken address is told someone tried, with no link",
    toTaken.some((m) => /already has one/.test(m.text ?? "") && !/verify[?#]token=/.test(m.text ?? "")));

  // Submitting does not create anything: otherwise anyone could reserve an
  // address they do not control simply by naming it.
  check("F-14", "submitting alone creates no account",
    sqlValue(`SELECT count(*) FROM users WHERE email = '${freeEmail}'`) === "0");
  check("F-14", "it creates a pending row instead",
    sqlValue(`SELECT count(*) FROM pending_registrations WHERE email = '${freeEmail}'`) === "1");
  check("F-14", "and no pending row for the address that already exists",
    sqlValue(`SELECT count(*) FROM pending_registrations WHERE email = '${alice.email}'`) === "0");

  // The link is what creates the account.
  const token = verificationToken(freeEmail);
  const verified = await verifyWith(token);
  check("F-14", "opening the link creates the account", verified.status === 201, `status ${verified.status}`);
  check("F-14", "and signs the person in", Boolean(verified.data?.token));
  check("F-14", "with the business it was submitted with",
    verified.data?.user?.businessId > 0, String(verified.data?.user?.businessId));

  const replay = await verifyWith(token);
  check("F-14", "the link works exactly once", replay.status === 400, `status ${replay.status}`);
  check("F-14", "spent pending rows are cleared",
    sqlValue(`SELECT count(*) FROM pending_registrations WHERE email = '${freeEmail}'`) === "0");

  const forged = await verifyWith("not-a-real-token-at-all-0000000000");
  check("F-14", "an unknown token is refused", forged.status === 400, `status ${forged.status}`);
  check("F-14", "and is refused in the same words as a spent one",
    forged.data?.error === replay.data?.error,
    `"${forged.data?.error}" vs "${replay.data?.error}"`);

  // Expiry is enforced on read, not only by the sweep.
  const staleEmail = `f14stale${stamp}@example.test`;
  await submit(staleEmail);
  const staleToken = verificationToken(staleEmail);
  sqlExec(`UPDATE pending_registrations SET expires_at = now() - interval '1 hour' WHERE email = '${staleEmail}'`);
  const expired = await verifyWith(staleToken);
  check("F-14", "an expired link is refused", expired.status === 400, `status ${expired.status}`);
  check("F-14", "and the account was never created",
    sqlValue(`SELECT count(*) FROM users WHERE email = '${staleEmail}'`) === "0");

  // Two people racing for one address: the first to prove the mailbox wins.
  const raceEmail = `f14race${stamp}@example.test`;
  await submit(raceEmail);
  const firstToken = verificationToken(raceEmail);
  await submit(raceEmail);
  const secondToken = verificationToken(raceEmail);
  check("F-14", "a second submission for the same address is accepted",
    firstToken !== secondToken && Boolean(secondToken));
  const winner = await verifyWith(secondToken);
  check("F-14", "the link that is opened creates the account", winner.status === 201, `status ${winner.status}`);
  const loser = await verifyWith(firstToken);
  check("F-14", "the other link is spent with it, not left live",
    loser.status === 400, `status ${loser.status}`);
  check("F-14", "exactly one account exists for the address",
    sqlValue(`SELECT count(*) FROM users WHERE email = '${raceEmail}'`) === "1");
}


// === review: the lockout cannot be turned against its owner ================
//
// The durable lock used to be keyed on the email alone. An email is chosen by
// the caller, so failing a login for anyone's address locked that person out —
// the platform administrator included — from every source, for as long as the
// attacker kept it up.
{
  const owner = await register("lockdos");
  const attacker = "203.0.113.9";
  const elsewhere = "198.51.100.77";
  const login = (password, ip) => call("POST", "/auth/login",
    { headers: { "x-forwarded-for": ip }, body: { email: owner.email, password } });

  let sawLock = false;
  for (let i = 0; i < 16 && !sawLock; i++) {
    sawLock = (await login(`wrong-${i}`, attacker)).status === 429;
  }
  check("lockout", "repeated failures lock the source they came from", sawLock);
  check("lockout", "and that lock holds against the correct password",
    (await login(PASSWORD, attacker)).status === 429);

  const real = await login(PASSWORD, elsewhere);
  check("lockout", "the owner, from another address, is not locked out",
    real.status === 200, `status ${real.status}`);
  check("lockout", "failed logins never charge the account-wide step-up counter",
    sqlValue(`SELECT count(*) FROM login_attempts WHERE key = 'user:${owner.userId}'`) === "0");
  check("lockout", "and no lock is keyed on the email alone",
    sqlValue(`SELECT count(*) FROM login_attempts WHERE key LIKE 'email:%'`) === "0");

  sqlExec(`DELETE FROM login_attempts WHERE key LIKE 'login:%'`);
}

// === review: registration is throttled and charges nothing login reads =====
//
// F-14 closed the response oracle and this route then reopened it: an existing
// address charged the login lockout and a free one did not, so a run of
// registrations followed by one login answered "is there an account?" with 429
// versus 401. Separately, only failures were counted against the per-address
// limit, and every registration is a 202, so the route was unthrottled — while
// holding a pooled connection for the whole request.
{
  const stamp = Date.now();
  const submit = (email, ip) => call("POST", "/auth/register", {
    headers: ip ? { "x-forwarded-for": ip } : undefined,
    body: { name: "Probe", email, businessName: "Probe Traders" },
  });
  const login = (email) => call("POST", "/auth/login", {
    headers: { "x-forwarded-for": "192.0.2.50" },
    body: { email, password: "not-the-password-at-all" },
  });

  // The same run of requests at an address with an account and one without.
  const taken = await register("budgettaken");
  const freeEmail = `budgetfree${stamp}@example.test`;
  const takenStatuses = [];
  const freeStatuses = [];
  for (let i = 0; i < 7; i++) {
    takenStatuses.push((await submit(taken.email)).status);
    freeStatuses.push((await submit(freeEmail)).status);
  }

  // `register()` above already spent one unit of the taken address's budget, so
  // the two addresses must be cut off after the same total.
  const accepted = (statuses) => statuses.filter((s) => s === 202).length;
  check("register", "a free address stops being accepted after the recipient budget",
    accepted(freeStatuses) === 5 && freeStatuses.slice(5).every((s) => s === 429),
    freeStatuses.join(","));
  check("register", "a taken address is cut off after exactly the same total",
    1 + accepted(takenStatuses) === 5 && takenStatuses.slice(4).every((s) => s === 429),
    takenStatuses.join(","));
  check("register", "so the mail one address can be sent is bounded",
    outbox().filter((m) => m.to === freeEmail).length === 5,
    String(outbox().filter((m) => m.to === freeEmail).length));

  check("register", "registering never charges a login lock for the address",
    sqlValue(`SELECT count(*) FROM login_attempts
              WHERE key = 'email:${taken.email}' OR key LIKE 'login:%|${taken.email}'`) === "0");
  const lt = await login(taken.email);
  const lf = await login(freeEmail);
  check("register", "a login for a taken address is refused exactly as for a free one",
    lt.status === lf.status && lt.status === 401, `taken ${lt.status} vs free ${lf.status}`);

  // A 202 must count against the per-address limit, or the limiter is decoration.
  const remaining = (r) => Number(/remaining=(\d+)/.exec(r.headers.get("ratelimit") ?? "")?.[1] ?? NaN);
  const first = await submit(`ipcount1${stamp}@example.test`, "203.0.113.200");
  const second = await submit(`ipcount2${stamp}@example.test`, "203.0.113.200");
  check("register", "a successful registration counts against the per-address limit",
    first.status === 202 && remaining(second) < remaining(first),
    `${remaining(first)} then ${remaining(second)}`);

  // The route must not hold a pooled connection while it waits for a second
  // one. Forty in flight against a pool of twenty used to deadlock: half came
  // back 500 after the ten-second connection timeout.
  const started = Date.now();
  const burst = await Promise.all(
    Array.from({ length: 40 }, (_, i) => submit(`burst${i}x${stamp}@example.test`)),
  );
  const tally = {};
  for (const r of burst) tally[r.status] = (tally[r.status] ?? 0) + 1;
  check("register", "a burst of 40 concurrent registrations all succeed",
    burst.every((r) => r.status === 202), JSON.stringify(tally));
  check("register", "and finishes well inside the connection timeout",
    Date.now() - started < 8000, `${Date.now() - started} ms`);

  sqlExec(`DELETE FROM login_attempts WHERE key LIKE 'login:%'`);
}


// === review: the password is chosen by whoever proves the mailbox ==========
//
// It used to be chosen by whoever submitted the form. Submit a victim's address
// with a password you know, and when they open the link they are signed in to an
// account whose password you also hold.
{
  const stamp = Date.now();
  const victim = `prehijack${stamp}@example.test`;
  const ATTACKER_PW = "attacker-picked-passphrase-1";
  const VICTIM_PW = "victim-chose-this-one-2026";
  const login = (password) => call("POST", "/auth/login", { body: { email: victim, password } });

  const submitted = await call("POST", "/auth/register", {
    body: { name: "Vic", email: victim, password: ATTACKER_PW, businessName: "V Ltd" },
  });
  check("prehijack", "a submission naming the victim's address is accepted", submitted.status === 202, `status ${submitted.status}`);
  check("prehijack", "and nothing the submitter chose as a password is kept",
    sqlValue(`SELECT count(*) FROM information_schema.columns
              WHERE table_name = 'pending_registrations' AND column_name = 'password_hash'`) === "0");

  const opened = await call("POST", "/auth/verify-registration", {
    body: { token: verificationToken(victim), password: VICTIM_PW },
  });
  check("prehijack", "the victim opens the link and chooses their own password", opened.status === 201, `status ${opened.status}`);
  check("prehijack", "the password the attacker submitted does not work",
    (await login(ATTACKER_PW)).status === 401);
  check("prehijack", "the one the victim chose does", (await login(VICTIM_PW)).status === 200);
}

// === review: a stranger's name cannot forge the body of our email ==========
{
  const stamp = Date.now();
  const target = `mailinject${stamp}@example.test`;
  await call("POST", "/auth/register", {
    body: { name: "Eve\r\n\r\nYour account is suspended - call +91 99999 99999\r\nBcc: someone@else.test",
            email: target, businessName: "E Ltd" },
  });
  const message = outbox().filter((m) => m.to === target).at(-1);
  const lines = (message?.text ?? "").split("\n");
  check("mail-injection", "the greeting is fixed text",
    lines[0] === "Hello," && lines[1] === "", lines.slice(0, 2).join(" | "));
  check("mail-injection", "nothing the stranger typed appears in the message",
    !/Eve|suspended|99999|Bcc/i.test(message?.text ?? ""));
  check("mail-injection", "no carriage return survives into the message", !/\r/.test(message?.text ?? ""));
  check("mail-injection", "and the message still carries the verification link",
    /verify[?#]token=/.test(message?.text ?? ""));
}

// === review: a page on another site cannot sign a visitor in ================
//
// CORS decides who may *read* a response, not whether the request is sent, and
// the CSRF token only protects a request that already carries a session. So a
// hostile page could submit a form to /auth/login and have the visitor's browser
// sign in to the attacker's account.
{
  const victim = await register("logincsrf");
  const creds = { email: victim.email, password: PASSWORD };
  const post = (headers, body) => fetch(`${B}/auth/login`, { method: "POST", headers, body });
  const json = { "content-type": "application/json" };
  const hasSession = (res) => (res.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("gst_session="));

  const foreign = await post({ ...json, origin: "https://evil.example" }, JSON.stringify(creds));
  check("login-csrf", "a login submitted from a foreign origin is refused", foreign.status === 403, `status ${foreign.status}`);
  check("login-csrf", "and issues no session", !hasSession(foreign));

  const opaque = await post({ ...json, origin: "null" }, JSON.stringify(creds));
  check("login-csrf", "so is one from an opaque origin", opaque.status === 403, `status ${opaque.status}`);

  const own = await post({ ...json, origin: "http://localhost:25512" }, JSON.stringify(creds));
  check("login-csrf", "the app's own origin still signs in", own.status === 200 && hasSession(own), `status ${own.status}`);
  const native = await post(json, JSON.stringify(creds));
  check("login-csrf", "as does a client that sends no origin at all", native.status === 200, `status ${native.status}`);

  const form = await post({ "content-type": "application/x-www-form-urlencoded" }, new URLSearchParams(creds));
  check("login-csrf", "a plain HTML form post is not accepted as a login", form.status === 400 && !hasSession(form),
    `status ${form.status}`);

  const evilRegister = await fetch(`${B}/auth/register`, { method: "POST",
    headers: { ...json, origin: "https://evil.example" },
    body: JSON.stringify({ name: "X", email: `csrf${Date.now()}@example.test`, businessName: "X" }) });
  check("login-csrf", "registration from a foreign origin is refused too", evilRegister.status === 403,
    `status ${evilRegister.status}`);
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
  // The password is chosen when the emailed link is opened, so that is where
  // the policy is enforced — and a refusal must not spend the link.
  const weakEmail = `weak${Math.random().toString(36).slice(2)}@example.test`;
  await call("POST", "/auth/register", { body: { name: "W", email: weakEmail, businessName: "W Ltd" } });
  const weakToken = verificationToken(weakEmail);
  for (const [label, pw] of weak) {
    const r = await call("POST", "/auth/verify-registration", { body: { token: weakToken, password: pw } });
    check("F-12", `${label} is rejected`, r.status === 400, `status ${r.status}`);
  }
  const noPassword = await call("POST", "/auth/verify-registration", { body: { token: weakToken } });
  check("F-12", "a link opened with no password is refused", noPassword.status === 400, `status ${noPassword.status}`);
  const stillGood = await call("POST", "/auth/verify-registration", { body: { token: weakToken, password: PASSWORD } });
  check("F-12", "and refusals do not spend the link: a good password still works on it",
    stillGood.status === 201, `status ${stillGood.status}`);

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
  const q = sqlValue;

  // Promote alice for tenant-admin routes. The spare account acts as the
  // separately bootstrapped platform superadmin in this isolated test DB.
  sqlExec(`UPDATE users SET role='admin' WHERE id=${alice.userId}`);
  sqlExec(`UPDATE users SET created_by_admin_id=${alice.userId} WHERE id=${bob.userId}`);
  const spare = await register("spare");
  sqlExec(`UPDATE users SET role='superadmin' WHERE id=${spare.userId}`);

  const NEW_PASSWORD = "a-brand-new-passphrase-99";
  const jar = newJar();
  await call("GET", "/healthz", { jar });
  await call("POST", "/auth/login", { jar, body: { email: alice.email, password: NEW_PASSWORD } });
  const superJar = newJar();
  await call("GET", "/healthz", { jar: superJar });
  await call("POST", "/auth/login", { jar: superJar, body: { email: spare.email, password: PASSWORD } });

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
  check("F-13", "a tenant admin cannot promote a user even with a session", roleNoStepUp.status === 403, `status ${roleNoStepUp.status}`);

  const rename = await call("PATCH", `/users/${bob.userId}`, { jar, body: { name: "Renamed" } });
  check("F-13", "an ordinary edit does not", rename.status === 200, `status ${rename.status}`);

  // Regression: the admin edit form posts the whole record, unchanged role
  // included. Gating on the field's presence made every save fail — including
  // a subscription-only edit, which is not a privilege change.
  const unchangedRole = await call("PATCH", `/users/${bob.userId}`, {
    jar, body: { role: "user", subscriptionStatus: "yearly" },
  });
  check("F-13", "sending an UNCHANGED role does not demand a password",
    unchangedRole.status === 200, `status ${unchangedRole.status}`);
  check("F-13", "...and the edit alongside it still applied",
    unchangedRole.data?.subscriptionStatus === "yearly", String(unchangedRole.data?.subscriptionStatus));

  const realChange = await call("PATCH", `/users/${bob.userId}`, {
    jar, body: { role: "admin", confirmPassword: NEW_PASSWORD },
  });
  check("F-13", "password confirmation cannot turn a tenant admin into a platform admin",
    realChange.status === 403, `status ${realChange.status}`);

  const superadminGenericCreate = await call("POST", "/users", {
    jar: superJar,
    body: { name: "Bypass", email: `bypass-${uniq}@example.test`, password: PASSWORD, role: "admin", confirmPassword: PASSWORD },
  });
  check("F-13", "the superadmin generic user endpoint also requires an invitation",
    superadminGenericCreate.status === 403, `status ${superadminGenericCreate.status}`);

  const selfDelete = await call("DELETE", `/users/${alice.userId}`, { jar });
  check("F-13", "an admin cannot delete their own account", selfDelete.status === 409, `status ${selfDelete.status}`);

  // The guard only bites when alice really is the last active admin, and this
  // suite shares a database with whatever ran before it. Establish the
  // precondition explicitly rather than assuming a clean slate, then restore.
  const others = q(
    `SELECT coalesce(string_agg(id::text, ','), '') FROM users ` +
    `WHERE role='admin' AND is_active AND deleted_at IS NULL AND id <> ${alice.userId}`,
  );
  if (others) {
    sqlExec(`UPDATE users SET role='user' WHERE id IN (${others})`);
  }
  check("F-13", "precondition: alice is the only active administrator",
    q(`SELECT count(*) FROM users WHERE role='admin' AND is_active AND deleted_at IS NULL`) === "1");

  const lastAdmin = await call("PATCH", `/users/${alice.userId}`, {
    jar: superJar, body: { role: "user", confirmPassword: PASSWORD },
  });
  check("F-13", "the last administrator cannot be demoted", lastAdmin.status === 409, `status ${lastAdmin.status}`);

  const lastAdminOff = await call("PATCH", `/users/${alice.userId}/toggle-status`, {
    jar: superJar, body: { isActive: false },
  });
  check("F-13", "...nor deactivated", lastAdminOff.status === 409, `status ${lastAdminOff.status}`);

  if (others) {
    sqlExec(`UPDATE users SET role='admin' WHERE id IN (${others})`);
  }
  sqlExec(`UPDATE users SET role='admin' WHERE id=${spare.userId}`);

  // Soft delete keeps the tenant's records rather than orphaning them.
  const victim = await register("victim");
  sqlExec(`UPDATE users SET created_by_admin_id=${alice.userId} WHERE id=${victim.userId}`);
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
  const q = sqlValue;

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

  // Cancelling must not free a number for reuse, and deleting is refused so the
  // series never has a hole in it.
  const del = await call("DELETE", `/invoices/${b.id}`, { token: biz.token });
  check("numbering", "an issued invoice cannot be deleted", del.status === 409, `status ${del.status}`);
  await call("PATCH", `/invoices/${b.id}/status`, { token: biz.token, body: { status: "cancelled" } });
  const afterCancel = (await mk("2026-07-01")).data.invoice;
  check("numbering", "a cancelled invoice's number is never reissued",
    afterCancel.invoiceNumber.endsWith("0004"), `${b.invoiceNumber} cancelled, next is ${afterCancel.invoiceNumber}`);

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
  // A GSTIN, because the bill below carries GST and the input credit has to be
  // attributable to a state. 29 matches this business, so the bill is local.
  const vendor = (await call("POST", "/vendors", { token: biz.token,
    body: { name: "T Vendor", gstin: "29TTTTT0000T1Z5" } })).data;
  const bizId = q(`SELECT business_id FROM users WHERE id=${biz.userId}`);
  const countProducts = () => q(`SELECT count(*) FROM products WHERE business_id=${bizId}`);

  // NOT VALID: enforce on new writes only. A previous run of this suite leaves
  // a FAILME row behind, and without it the constraint refuses to be created.
  sqlExec(`ALTER TABLE purchases DROP CONSTRAINT IF EXISTS tmp_reject_failme`);
  sqlExec(`ALTER TABLE purchases ADD CONSTRAINT tmp_reject_failme CHECK (invoice_number NOT LIKE 'FAILME%') NOT VALID`);
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
    sqlExec(`ALTER TABLE purchases DROP CONSTRAINT tmp_reject_failme`);
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


// === money: line items must reconcile against the totals ===================
{
  const biz = await register("money");
  await call("PATCH", "/business", { token: biz.token, body: { stateCode: "29" } });

  const mk = (items, place = "29") => call("POST", "/invoices", {
    token: biz.token,
    body: { invoiceDate: "2026-08-01", customerName: "X", placeOfSupply: place, items },
  });
  const near = (a, b) => Math.abs(a - b) < 0.005;
  const sumOf = (items, k) => Math.round(items.reduce((t, i) => t + Number(i[k]), 0) * 100) / 100;

  // The exact shape that used to drift a paisa.
  {
    const inv = (await mk(Array.from({ length: 3 }, () => (
      { description: "a", quantity: 1, unitPrice: 33.333, gstRate: 18 })))).data.invoice;
    check("money", "3 x 33.333: line taxable values sum to the subtotal",
      near(sumOf(inv.items, "taxableAmount"), inv.subtotal),
      `lines ${sumOf(inv.items, "taxableAmount")} vs subtotal ${inv.subtotal}`);
    check("money", "...CGST reconciles", near(sumOf(inv.items, "cgst"), inv.cgst));
    check("money", "...SGST reconciles", near(sumOf(inv.items, "sgst"), inv.sgst));
  }

  // A spread of awkward values, intra- and inter-state.
  {
    const items = [
      { description: "a", quantity: 3, unitPrice: 19.99, gstRate: 5 },
      { description: "b", quantity: 1.5, unitPrice: 1234.567, gstRate: 12, discount: 7.5 },
      { description: "c", quantity: 7, unitPrice: 0.01, gstRate: 28 },
      { description: "d", quantity: 2.125, unitPrice: 99.995, gstRate: 18 },
      { description: "e", quantity: 11, unitPrice: 3.33, gstRate: 0 },
    ];
    for (const [label, place] of [["intra-state", "29"], ["inter-state", "27"]]) {
      const inv = (await mk(items, place)).data.invoice;
      check("money", `${label}: lines sum to the subtotal`,
        near(sumOf(inv.items, "taxableAmount"), inv.subtotal),
        `${sumOf(inv.items, "taxableAmount")} vs ${inv.subtotal}`);
      check("money", `${label}: CGST+SGST+IGST equals the total GST`,
        near(inv.cgst + inv.sgst + inv.igst, inv.totalGst));
      check("money", `${label}: grand total less round-off is subtotal + GST`,
        near(inv.grandTotal - inv.roundOff, inv.subtotal + inv.totalGst),
        `${inv.grandTotal} - ${inv.roundOff} vs ${inv.subtotal + inv.totalGst}`);
      check("money", `${label}: each line's parts sum to its own total`,
        inv.items.every((i) => near(i.taxableAmount + i.cgst + i.sgst + i.igst, i.totalAmount)));
    }
  }

  // GSTR-1: the filed totals must match the invoices they are built from.
  {
    const r = await call("GET", "/reports/gstr1?month=8&year=2026", { token: biz.token });
    const g = r.data;
    check("money", "GSTR-1 taxable value equals the sum of its invoices",
      near(sumOf(g.invoices, "subtotal"), g.totalTaxableValue),
      `${sumOf(g.invoices, "subtotal")} vs ${g.totalTaxableValue}`);
    check("money", "GSTR-1 CGST/SGST/IGST each reconcile",
      near(sumOf(g.invoices, "cgst"), g.totalCgst) &&
      near(sumOf(g.invoices, "sgst"), g.totalSgst) &&
      near(sumOf(g.invoices, "igst"), g.totalIgst));
    check("money", "GSTR-1 rate-wise taxable values sum to the total",
      near(g.byRate.reduce((t, b) => t + b.taxable, 0), g.totalTaxableValue),
      `byRate ${Math.round(g.byRate.reduce((t, b) => t + b.taxable, 0) * 100) / 100} vs ${g.totalTaxableValue}`);
    check("money", "GSTR-1 rate-wise GST sums to the total tax",
      near(g.byRate.reduce((t, b) => t + b.gst, 0), g.totalTax));
  }
}


// === aggregations: known data in, known numbers out ========================
// These endpoints are being moved from "read every row and add it up in
// JavaScript" to SQL aggregates. The figures are business-visible, so the
// checks assert against independently computed expectations rather than a
// snapshot of whatever the old code happened to return.
{
  const biz = await register("agg");
  await call("PATCH", "/business", { token: biz.token, body: { stateCode: "29" } });
  const T = { token: biz.token };

  const mkInvoice = (date, unitPrice, qty, place = "29") => call("POST", "/invoices", {
    ...T, body: { invoiceDate: date, customerName: "C", placeOfSupply: place,
      items: [{ description: "w", quantity: qty, unitPrice, gstRate: 18 }] },
  });

  // Three invoices, all intra-state at 18%.
  const i1 = (await mkInvoice("2026-08-05", 1000, 1)).data.invoice;   // 1000 + 180 = 1180
  const i2 = (await mkInvoice("2026-08-06", 2000, 2)).data.invoice;   // 4000 + 720 = 4720
  const i3 = (await mkInvoice("2026-08-07", 500, 3)).data.invoice;    // 1500 + 270 = 1770
  await call("PATCH", `/invoices/${i2.id}/status`, { ...T, body: { status: "paid" } });

  // This business is in 29; the vendor is in 27, so the bill is inter-state and
  // its input credit is IGST. Every purchase used to be booked as CGST+SGST
  // regardless of the supplier's state, which put the credit under the wrong
  // head — and because the summary floors each head at zero, the misfiled
  // credit was discarded rather than carried.
  const vendor = (await call("POST", "/vendors", { ...T, body: { name: "V", gstin: "27VVVVV0000V1Z5" } })).data;
  const p1 = (await call("POST", "/purchases", { ...T, body: { vendorId: vendor.id, billDate: "2026-08-05",
    items: [{ description: "raw", quantity: 10, unitPrice: 100, gstRate: 18 } ] } })).data; // 1000 + 180
  check("aggregates", "an inter-state bill books its input credit as IGST",
    p1.isInterstate === true && p1.igst === 180 && p1.cgst === 0 && p1.sgst === 0,
    `isInterstate ${p1.isInterstate} cgst ${p1.cgst} sgst ${p1.sgst} igst ${p1.igst}`);

  await call("POST", "/customers", { ...T, body: { name: "Cust A" } });
  await call("POST", "/customers", { ...T, body: { name: "Cust B" } });
  await call("POST", "/products", { ...T, body: { name: "Low", unit: "Nos", stockQuantity: 1, lowStockThreshold: 5, sellingPrice: 10 } });
  await call("POST", "/products", { ...T, body: { name: "Fine", unit: "Nos", stockQuantity: 99, lowStockThreshold: 5, sellingPrice: 10 } });

  const expSales = i1.grandTotal + i2.grandTotal + i3.grandTotal;
  const expGstOut = i1.totalGst + i2.totalGst + i3.totalGst;
  const expOutstanding = i1.grandTotal + i3.grandTotal; // i2 was marked paid
  const near = (a, b) => Math.abs(a - b) < 0.005;

  const st = (await call("GET", "/dashboard/stats", T)).data;
  check("aggregates", "dashboard totalSales matches the invoices raised",
    near(st.totalSales, expSales), `${st.totalSales} vs ${expSales}`);
  check("aggregates", "dashboard totalPurchases matches the bills recorded",
    near(st.totalPurchases, p1.grandTotal), `${st.totalPurchases} vs ${p1.grandTotal}`);
  check("aggregates", "dashboard totalGstPayable is output tax less input tax",
    near(st.totalGstPayable, expGstOut - p1.totalGst), `${st.totalGstPayable} vs ${expGstOut - p1.totalGst}`);
  check("aggregates", "dashboard totalOutstanding excludes the paid invoice",
    near(st.totalOutstanding, expOutstanding), `${st.totalOutstanding} vs ${expOutstanding}`);
  check("aggregates", "dashboard counts are right",
    st.invoiceCount === 3 && st.customerCount === 2 && st.vendorCount === 1 && st.productCount >= 2,
    `inv ${st.invoiceCount} cust ${st.customerCount} vend ${st.vendorCount} prod ${st.productCount}`);
  check("aggregates", "dashboard lowStockCount counts only products under threshold",
    st.lowStockCount === 1, String(st.lowStockCount));

  // gst-summary is scoped to the CURRENT month, so the August invoices above
  // must not appear in it. Raise one dated today and check both halves.
  {
    const before = (await call("GET", "/dashboard/gst-summary", T)).data;
    const now = new Date();
    const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    const thisMonth = (await mkInvoice(today, 1000, 1)).data.invoice;

    const after = (await call("GET", "/dashboard/gst-summary", T)).data;
    const outBefore = before.outputCgst + before.outputSgst + before.outputIgst;
    const outAfter = after.outputCgst + after.outputSgst + after.outputIgst;
    check("aggregates", "gst-summary counts only the current month",
      near(outAfter - outBefore, thisMonth.totalGst),
      `delta ${outAfter - outBefore} vs ${thisMonth.totalGst}`);
    check("aggregates", "gst-summary net payable is output less input",
      near(after.netPayable, outAfter - (after.inputCgst + after.inputSgst + after.inputIgst)),
      `${after.netPayable}`);
  }

  const low = (await call("GET", "/dashboard/low-stock", T)).data;
  check("aggregates", "low-stock returns exactly the product under threshold",
    Array.isArray(low) && low.length === 1 && low[0].name === "Low", `${low?.length} rows`);

  const top = (await call("GET", "/dashboard/top-products", T)).data;
  check("aggregates", "top-products ranks by revenue",
    Array.isArray(top) && top.length > 0 && top[0].totalRevenue >= (top[1]?.totalRevenue ?? 0),
    JSON.stringify(top?.slice(0, 2)));

  const rev = (await call("GET", "/dashboard/monthly-revenue", T)).data;
  check("aggregates", "monthly-revenue returns six months",
    Array.isArray(rev) && rev.length === 6, `${rev?.length} months`);
  check("aggregates", "monthly-revenue months are labelled and numeric",
    rev.every((m) => typeof m.month === "string" && Number.isFinite(m.sales)
      && Number.isFinite(m.purchases) && Number.isFinite(m.gst)));

  // Admin stats: seeded above, so only structural invariants are safe to assert.
  sqlExec(`UPDATE users SET role='admin' WHERE id=${biz.userId}`);
  sqlExec(`UPDATE users SET created_by_admin_id=${biz.userId} ` +
    `WHERE role='user' AND deleted_at IS NULL AND created_by_admin_id IS NULL`);
  const ad = (await call("GET", "/admin/stats", T)).data;
  const dbUsers = Number(sqlValue(`SELECT count(*) FROM users ` +
    `WHERE role='user' AND deleted_at IS NULL AND created_by_admin_id=${biz.userId}`));
  check("aggregates", "admin totalUsers counts only their non-deleted users",
    ad.totalUsers === dbUsers, `${ad.totalUsers} vs ${dbUsers}`);
  check("aggregates", "admin active + inactive accounts for every counted user",
    ad.activeUsers + ad.inactiveUsers === ad.totalUsers,
    `${ad.activeUsers} + ${ad.inactiveUsers} vs ${ad.totalUsers}`);
  check("aggregates", "admin recentUsers is capped at 10 and newest first",
    ad.recentUsers.length <= 10 &&
    ad.recentUsers.every((u, i, a) => i === 0 || new Date(a[i - 1].createdAt) >= new Date(u.createdAt)));
  sqlExec(`UPDATE users SET created_by_admin_id=NULL WHERE created_by_admin_id=${biz.userId}`);
  sqlExec(`UPDATE users SET role='user' WHERE id=${biz.userId}`);
}


// === session revocation: bearer tokens can now be killed ===================
{
  const PW = "correct-horse-battery-staple";
  const victim = await register("revoke");

  // A bearer token works to begin with.
  check("revocation", "a freshly issued bearer token works",
    (await call("GET", "/auth/me", { token: victim.token })).status === 200);

  // Signing out everywhere revokes it, even though it has no cookie to clear.
  const jar = newJar();
  await call("GET", "/healthz", { jar });
  await call("POST", "/auth/login", { jar, body: { email: victim.email, password: PW } });
  const all = await call("POST", "/auth/logout-all", { jar });
  check("revocation", "logout-all succeeds", all.status === 200, `status ${all.status}`);
  check("revocation", "the bearer token issued earlier is now rejected",
    (await call("GET", "/auth/me", { token: victim.token })).status === 401);

  // Changing a password revokes sessions held elsewhere...
  const fresh = await call("POST", "/auth/login", { body: { email: victim.email, password: PW } });
  const oldToken = fresh.data.token;
  const jar2 = newJar();
  await call("GET", "/healthz", { jar: jar2 });
  await call("POST", "/auth/login", { jar: jar2, body: { email: victim.email, password: PW } });
  const NEW_PW = "a-completely-different-passphrase-12";
  const changed = await call("POST", "/auth/change-password", {
    jar: jar2, body: { currentPassword: PW, newPassword: NEW_PW },
  });
  check("revocation", "password change succeeds", changed.status === 200, `status ${changed.status}`);
  check("revocation", "a session held elsewhere is revoked by the password change",
    (await call("GET", "/auth/me", { token: oldToken })).status === 401);
  // ...but not the device that made the change.
  check("revocation", "the device that changed the password stays signed in",
    (await call("GET", "/auth/me", { jar: jar2 })).status === 200);

  // An admin reset revokes the target's sessions.
  const target = await register("resettarget");
  const admin = await register("resetadmin");
  sqlExec(`UPDATE users SET role='admin' WHERE id=${admin.userId}`);
  sqlExec(`UPDATE users SET created_by_admin_id=${admin.userId} WHERE id=${target.userId}`);
  const ajar = newJar();
  await call("GET", "/healthz", { jar: ajar });
  await call("POST", "/auth/login", { jar: ajar, body: { email: admin.email, password: PW } });
  const reset = await call("POST", `/users/${target.userId}/reset-password`, {
    jar: ajar, body: { newPassword: "yet-another-good-passphrase-44", confirmPassword: PW },
  });
  check("revocation", "admin reset succeeds", reset.status === 200, `status ${reset.status}`);
  check("revocation", "the target's existing session is revoked by the reset",
    (await call("GET", "/auth/me", { token: target.token })).status === 401);
}

// === superadmin: invitation-only admin setup and capacity review ===========
{
  const operator = await register("platformoperator");
  sqlExec(`UPDATE users SET role='superadmin' WHERE id=${operator.userId}`);
  const adminEmail = `invited-${uniq}@example.test`;
  const createdInvite = await call("POST", "/superadmin/admin-invitations", {
    token: operator.token,
    body: { name: "Invited Admin", email: adminEmail, confirmPassword: PASSWORD },
  });
  check("superadmin", "an authorized superadmin can issue an invitation",
    createdInvite.status === 201, `status ${createdInvite.status}`);
  check("superadmin", "the invitation uses the default allowance of 15",
    createdInvite.data?.userLimit === 15, String(createdInvite.data?.userLimit));
  check("superadmin", "the invitation response contains no raw credential",
    !("token" in (createdInvite.data ?? {})) && !("password" in (createdInvite.data ?? {})));

  const adminToken = adminInvitationToken(adminEmail);
  check("superadmin", "the setup link is delivered to the invited mailbox", Boolean(adminToken));
  const activeInvitations = await call("GET", "/superadmin/admin-invitations", { token: operator.token });
  check("superadmin", "the superadmin can see pending invitations without their tokens",
    activeInvitations.status === 200 &&
      activeInvitations.data?.invitations?.some((item) => item.email === adminEmail) &&
      !JSON.stringify(activeInvitations.data).includes(adminToken ?? "not-a-token"));

  const ADMIN_PASSWORD = "admin-chosen-passphrase-72";
  const inviteJar = newJar();
  await call("GET", "/healthz", { jar: inviteJar });
  const accepted = await call("POST", "/auth/accept-admin-invite", {
    jar: inviteJar,
    body: { token: adminToken, password: ADMIN_PASSWORD },
  });
  check("superadmin", "an invited admin chooses a password and is signed in",
    accepted.status === 201 && accepted.data?.user?.role === "admin",
    `status ${accepted.status}`);
  const acceptedMe = await call("GET", "/auth/me", { jar: inviteJar });
  check("superadmin", "the accepted session resolves to the new admin account",
    acceptedMe.status === 200 && acceptedMe.data?.email === adminEmail);
  const reused = await call("POST", "/auth/accept-admin-invite", {
    body: { token: adminToken, password: ADMIN_PASSWORD },
  });
  check("superadmin", "an invitation token can only be redeemed once",
    reused.status === 400, `status ${reused.status}`);

  const deniedAdminList = await call("GET", "/superadmin/admins", { token: accepted.data?.token });
  check("superadmin", "a tenant admin cannot read the platform admin directory",
    deniedAdminList.status === 403, `status ${deniedAdminList.status}`);

  const tenantAdminId = accepted.data?.user?.id;
  const setOneSeat = await call("PATCH", `/superadmin/admins/${tenantAdminId}/limit`, {
    token: operator.token,
    body: { userLimit: 1, confirmPassword: PASSWORD },
  });
  check("superadmin", "a superadmin can set an explicit allowance",
    setOneSeat.status === 200 && setOneSeat.data?.userLimit === 1,
    `status ${setOneSeat.status}`);
  check("ownership", "tenant admins cannot alter the platform allowance",
    (await call("PATCH", `/superadmin/admins/${tenantAdminId}/limit`, {
      token: accepted.data?.token, body: { userLimit: 100, confirmPassword: ADMIN_PASSWORD },
    })).status === 403);

  const prematureRequest = await call("POST", "/superadmin/capacity-requests", {
    token: accepted.data?.token,
    body: { additionalUsers: 2 },
  });
  check("capacity", "an admin cannot request more capacity before reaching the limit",
    prematureRequest.status === 409, `status ${prematureRequest.status}`);

  const childPassword = "tenant-child-passphrase-83";
  const firstChild = await call("POST", "/users", {
    token: accepted.data?.token,
    body: { name: "First Tenant User", email: `tenant-child-${uniq}@example.test`, password: childPassword, role: "user" },
  });
  check("capacity", "the tenant admin can create a user within its allowance",
    firstChild.status === 201, `status ${firstChild.status}`);
  check("capacity", "created user ownership is stored from the authenticated admin",
    sqlValue(`SELECT created_by_admin_id FROM users WHERE id=${firstChild.data?.id}`) === String(tenantAdminId));

  // Two simultaneous creates contend for the same locked admin row. Exactly
  // one consumes the remaining seat; the other gets the request-capacity path.
  const concurrent = await Promise.all([1, 2].map((n) => call("POST", "/users", {
    token: accepted.data?.token,
    body: {
      name: `Concurrent User ${n}`,
      email: `concurrent-${n}-${uniq}@example.test`,
      password: `tenant-race-password-${n}-84`,
      role: "user",
    },
  })));
  const statuses = concurrent.map((response) => response.status).sort((a, b) => a - b);
  check("capacity", "concurrent user creation cannot exceed the allowance",
    statuses[0] === 201 && statuses[1] === 402, statuses.join(", "));
  const quotaResponse = concurrent.find((response) => response.status === 402);
  check("capacity", "quota errors include the fixed INR 1,000 per-user quote",
    quotaResponse?.data?.amountInr === 1000 &&
      quotaResponse?.data?.currency === "INR" &&
      quotaResponse?.data?.userLimit === 1);
  check("capacity", "exactly one concurrent account owns the final seat",
    sqlValue(`SELECT count(*) FROM users WHERE created_by_admin_id=${tenantAdminId} AND role='user' AND deleted_at IS NULL`) === "2");

  const capacity = await call("POST", "/superadmin/capacity-requests", {
    token: accepted.data?.token,
    body: { additionalUsers: 2, amountInr: 1, paid: true },
  });
  check("capacity", "the quoted request amount is calculated on the server",
    capacity.status === 201 && capacity.data?.amountInr === 2000,
    `status ${capacity.status}; amount ${capacity.data?.amountInr}`);
  check("capacity", "a request does not change allowance or claim payment",
    capacity.data?.status === "pending" &&
      sqlValue(`SELECT user_limit FROM users WHERE id=${tenantAdminId}`) === "1" &&
      !("paid" in (capacity.data ?? {})));
  const ownRequests = await call("GET", "/superadmin/capacity-requests", {
    token: accepted.data?.token,
  });
  check("capacity", "tenant admins see only their own capacity requests",
    ownRequests.status === 200 && ownRequests.data?.requests?.length === 1 &&
      ownRequests.data.requests[0].adminId === tenantAdminId,
    `status ${ownRequests.status}; requests ${ownRequests.data?.requests?.length}`);
  const adminReviewAttempt = await call("PATCH", `/superadmin/capacity-requests/${capacity.data?.id}/review`, {
    token: accepted.data?.token,
    body: { decision: "approve", userLimit: 3, confirmPassword: ADMIN_PASSWORD },
  });
  check("capacity", "tenant admins cannot review capacity requests",
    adminReviewAttempt.status === 403, `status ${adminReviewAttempt.status}`);
  const duplicateRequest = await call("POST", "/superadmin/capacity-requests", {
    token: accepted.data?.token, body: { additionalUsers: 1 },
  });
  check("capacity", "an admin cannot create a second pending request",
    duplicateRequest.status === 409, `status ${duplicateRequest.status}`);

  const review = await call("PATCH", `/superadmin/capacity-requests/${capacity.data?.id}/review`, {
    token: operator.token,
    body: { decision: "approve", userLimit: 2, confirmPassword: PASSWORD },
  });
  check("capacity", "approval cannot grant less than the requested additional seats",
    review.status === 409 &&
      sqlValue(`SELECT user_limit FROM users WHERE id=${tenantAdminId}`) === "1",
    `status ${review.status}`);
  const approvedReview = await call("PATCH", `/superadmin/capacity-requests/${capacity.data?.id}/review`, {
    token: operator.token,
    body: { decision: "approve", userLimit: 3, confirmPassword: PASSWORD },
  });
  check("capacity", "approval applies only the explicit new user limit",
    approvedReview.status === 200 && approvedReview.data?.status === "approved" &&
      approvedReview.data?.grantedUserLimit === 3 &&
      sqlValue(`SELECT user_limit FROM users WHERE id=${tenantAdminId}`) === "3",
    `status ${approvedReview.status}; limit ${approvedReview.data?.grantedUserLimit}`);
  const afterApproval = await call("POST", "/users", {
    token: accepted.data?.token,
    body: { name: "After Approval", email: `after-approval-${uniq}@example.test`, password: childPassword, role: "user" },
  });
  check("capacity", "the approved allowance permits creation within the new limit",
    afterApproval.status === 201, `status ${afterApproval.status}`);

  const otherAdmin = await register("othercapacity");
  sqlExec(`UPDATE users SET role='admin', user_limit=1 WHERE id=${otherAdmin.userId}`);
  const otherChild = await call("POST", "/users", {
    token: otherAdmin.token,
    body: { name: "Other Tenant User", email: `other-child-${uniq}@example.test`, password: childPassword, role: "user" },
  });
  check("ownership", "the second admin can create its own child account",
    otherChild.status === 201, `status ${otherChild.status}`);
  const otherRequest = await call("POST", "/superadmin/capacity-requests", {
    token: otherAdmin.token, body: { additionalUsers: 1 },
  });
  check("capacity", "a different admin can submit its own request at its limit",
    otherRequest.status === 201 && otherRequest.data?.adminId === otherAdmin.userId);
  const isolatedList = await call("GET", "/users", { token: accepted.data?.token });
  const ownIds = [firstChild.data?.id, ...concurrent.filter((item) => item.status === 201).map((item) => item.data?.id), afterApproval.data?.id];
  check("ownership", "user lists contain only the caller's own tenant",
    isolatedList.status === 200 && isolatedList.data?.users.length === 3 &&
      ownIds.every((id) => isolatedList.data.users.some((user) => user.id === id)) &&
      !isolatedList.data.users.some((user) => user.id === otherChild.data?.id),
    `status ${isolatedList.status}; users ${isolatedList.data?.users?.length}`);
  const adminList = await call("GET", "/admin/users", { token: accepted.data?.token });
  check("ownership", "the admin dashboard list is tenant-scoped too",
    adminList.status === 200 && adminList.data?.users.length === 3 &&
      !adminList.data.users.some((user) => user.id === otherChild.data?.id));
  const foreignRead = await call("GET", `/users/${otherChild.data?.id}`, { token: accepted.data?.token });
  check("ownership", "a tenant admin cannot read another admin's user",
    foreignRead.status === 404, `status ${foreignRead.status}`);
  const foreignDetail = await call("GET", `/admin/users/${otherChild.data?.id}`, { token: accepted.data?.token });
  check("ownership", "a tenant admin cannot read another tenant's detail view",
    foreignDetail.status === 404, `status ${foreignDetail.status}`);
  const foreignEdit = await call("PATCH", `/users/${otherChild.data?.id}`, {
    token: accepted.data?.token, body: { name: "Should not change" },
  });
  check("ownership", "a tenant admin cannot edit another tenant's user",
    foreignEdit.status === 404, `status ${foreignEdit.status}`);
  const foreignStatus = await call("PATCH", `/users/${otherChild.data?.id}/toggle-status`, {
    token: accepted.data?.token, body: { isActive: false },
  });
  check("ownership", "a tenant admin cannot deactivate another tenant's user",
    foreignStatus.status === 404, `status ${foreignStatus.status}`);
  const foreignDelete = await call("DELETE", `/users/${otherChild.data?.id}`, {
    token: accepted.data?.token,
  });
  check("ownership", "a tenant admin cannot delete another tenant's user",
    foreignDelete.status === 404, `status ${foreignDelete.status}`);
  const foreignReset = await call("POST", `/users/${otherChild.data?.id}/reset-password`, {
    token: accepted.data?.token,
    body: { newPassword: "reset-child-passphrase-88", confirmPassword: ADMIN_PASSWORD },
  });
  check("ownership", "a tenant admin cannot reset another tenant's password",
    foreignReset.status === 404, `status ${foreignReset.status}`);
  const childLogin = await call("POST", "/auth/login", {
    body: { email: `tenant-child-${uniq}@example.test`, password: childPassword },
  });
  const userCannotReadRequests = await call("GET", "/superadmin/capacity-requests", { token: childLogin.data?.token });
  check("capacity", "ordinary users cannot read capacity requests",
    userCannotReadRequests.status === 403, `status ${userCannotReadRequests.status}`);

  const decline = await call("PATCH", `/superadmin/capacity-requests/${otherRequest.data?.id}/review`, {
    token: operator.token,
    body: { decision: "decline", confirmPassword: PASSWORD },
  });
  check("capacity", "declining a request leaves the admin limit unchanged",
    decline.status === 200 && decline.data?.status === "declined" &&
      sqlValue(`SELECT user_limit FROM users WHERE id=${otherAdmin.userId}`) === "1",
    `status ${decline.status}`);

  const inviteRaceEmail = `invite-race-${uniq}@example.test`;
  const inviteRace = await call("POST", "/superadmin/admin-invitations", {
    token: operator.token,
    body: { name: "Single Use Race", email: inviteRaceEmail, userLimit: 2, confirmPassword: PASSWORD },
  });
  const raceToken = adminInvitationToken(inviteRaceEmail);
  const raceAcceptances = await Promise.all([1, 2].map(async () => {
    const jar = newJar();
    await call("GET", "/healthz", { jar });
    return call("POST", "/auth/accept-admin-invite", {
      jar,
      body: { token: raceToken, password: ADMIN_PASSWORD },
    });
  }));
  const acceptanceStatuses = raceAcceptances.map((response) => response.status).sort((a, b) => a - b);
  check("superadmin", "concurrent redemption creates exactly one admin account",
    inviteRace.status === 201 && acceptanceStatuses[0] === 201 && acceptanceStatuses[1] === 400,
    `invite ${inviteRace.status}; accepts ${acceptanceStatuses.join(", ")}`);
}

// ---------------------------------------------------------------------------
let group = "";
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.cond ? "ok  " : "FAIL"}  ${r.name}${r.cond || !r.detail ? "" : `  [${r.detail}]`}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
