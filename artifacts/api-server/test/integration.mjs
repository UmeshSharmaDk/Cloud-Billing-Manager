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

async function call(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${B}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

const uniq = Date.now();
async function register(tag) {
  const email = `${tag}${uniq}@example.test`;
  const r = await call("POST", "/auth/register", {
    body: { name: `${tag} Owner`, email, password: "correct-horse-battery-staple",
            businessName: `${tag} Traders`, gstin: "27AAAAA0000A1Z5" },
  });
  if (r.status !== 201) throw new Error(`register ${tag} failed: ${r.status} ${JSON.stringify(r.data)}`);
  return { email, token: r.data.token, userId: r.data.user.id };
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

// ---------------------------------------------------------------------------
let group = "";
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${r.cond ? "ok  " : "FAIL"}  ${r.name}${r.cond || !r.detail ? "" : `  [${r.detail}]`}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
