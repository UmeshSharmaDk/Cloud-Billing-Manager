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

  const rows = sqlValue(`SELECT count(*) FROM login_attempts WHERE key LIKE 'email:%'`);
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
  const q = sqlValue;

  // Promote alice so she can exercise the admin routes, and make a second
  // admin so the last-admin guard is not tripped by the setup itself.
  sqlExec(`UPDATE users SET role='admin' WHERE id=${alice.userId}`);
  const spare = await register("spare");
  sqlExec(`UPDATE users SET role='admin' WHERE id=${spare.userId}`);

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
  check("F-13", "an actual role change with confirmation succeeds", realChange.status === 200, `status ${realChange.status}`);
  await call("PATCH", `/users/${bob.userId}`, { jar, body: { role: "user", confirmPassword: NEW_PASSWORD } });

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
    sqlExec(`UPDATE users SET role='user' WHERE id IN (${others})`);
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
    sqlExec(`UPDATE users SET role='admin' WHERE id IN (${others})`);
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
  const ad = (await call("GET", "/admin/stats", T)).data;
  const dbUsers = Number(sqlValue(`SELECT count(*) FROM users WHERE role <> 'admin' AND deleted_at IS NULL`));
  check("aggregates", "admin totalUsers counts non-admin, non-deleted users",
    ad.totalUsers === dbUsers, `${ad.totalUsers} vs ${dbUsers}`);
  check("aggregates", "admin active + inactive accounts for every counted user",
    ad.activeUsers + ad.inactiveUsers === ad.totalUsers,
    `${ad.activeUsers} + ${ad.inactiveUsers} vs ${ad.totalUsers}`);
  check("aggregates", "admin recentUsers is capped at 10 and newest first",
    ad.recentUsers.length <= 10 &&
    ad.recentUsers.every((u, i, a) => i === 0 || new Date(a[i - 1].createdAt) >= new Date(u.createdAt)));
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

// ---------------------------------------------------------------------------
let group = "";
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.cond ? "ok  " : "FAIL"}  ${r.name}${r.cond || !r.detail ? "" : `  [${r.detail}]`}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
