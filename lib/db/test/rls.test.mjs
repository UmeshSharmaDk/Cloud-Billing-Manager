/**
 * Row-level security, asserted against a live Postgres.
 *
 * The integration suite proves the application still works with policies
 * installed. It cannot prove the policies *stop* anything — every request it
 * makes is one the application is entitled to make, so the suite would pass
 * just as happily against a database with RLS switched off. This file is the
 * other half: it drives the database directly and asserts on what a connection
 * is refused.
 *
 * Two connections are needed, and the difference between them is the point:
 *
 *   DATABASE_URL        the application's role, NOSUPERUSER NOBYPASSRLS
 *   ADMIN_DATABASE_URL  the owner, used to seed fixtures and read ground truth
 *
 * If both point at the same superuser every assertion here would pass
 * vacuously, so the first thing the file does is refuse to run in that
 * configuration.
 *
 *   node lib/db/test/rls.test.mjs
 */

import pg from "pg";

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;

if (!APP_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(2);
}

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
}

const app = new pg.Client({ connectionString: APP_URL });
const admin = new pg.Client({ connectionString: ADMIN_URL });

const rows = async (client, sql, params = []) => (await client.query(sql, params)).rows;
const num = (v) => Number(v ?? 0);

await app.connect();
await admin.connect();

try {
  // === the configuration itself ==========================================
  //
  // A superuser, or any role holding BYPASSRLS, ignores policies entirely.
  // Every check below would then pass while protecting nothing, so this is
  // a hard stop rather than a check.
  const [role] = await rows(app, `
    SELECT current_user AS name, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user`);

  console.log(`\nconnected as ${role.name} (superuser=${role.rolsuper}, bypassrls=${role.rolbypassrls})\n`);

  if (role.rolsuper || role.rolbypassrls) {
    console.error(
      `REFUSING TO RUN: "${role.name}" bypasses row-level security, so these\n` +
      `assertions would pass without proving anything. Point DATABASE_URL at a\n` +
      `role created NOSUPERUSER NOBYPASSRLS (see lib/db/README-rls.md).`,
    );
    process.exit(2);
  }

  console.log("policy coverage");
  const gaps = await rows(admin, `
    SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname IN ('customers','vendors','products','invoices',
                         'purchases','payments','eway_bills','businesses')
       AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`);
  check("every tenant table has RLS enabled and forced",
    gaps.length === 0, gaps.map((r) => r.relname).join(", "));

  // === fixtures ==========================================================
  //
  // Seeded as the owner so the test never depends on the integration suite
  // having run first. Two tenants, because isolation needs something to be
  // isolated from.
  const stamp = Date.now();

  // A business belongs to a user, so each tenant needs an owner. The password
  // hash is a placeholder: nothing here authenticates, and these rows are
  // deleted at the end of the run.
  const seedTenant = async (label) => {
    const [user] = await rows(admin,
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, 'x') RETURNING id`,
      [`RLS ${label} ${stamp}`, `rls-${label}-${stamp}@example.test`]);
    const [business] = await rows(admin,
      `INSERT INTO businesses (user_id, name) VALUES ($1, $2) RETURNING id`,
      [user.id, `RLS ${label} ${stamp}`]);
    return { userId: user.id, id: business.id };
  };

  const tenantA = await seedTenant("A");
  const tenantB = await seedTenant("B");

  await admin.query(
    `INSERT INTO customers (business_id, name) VALUES ($1,$2), ($1,$3), ($4,$5)`,
    [tenantA.id, "A one", "A two", tenantB.id, "B one"]);

  console.log("\nfail-closed by default");
  // The most important property. A code path that escapes the request scope
  // must see nothing, not everything — the failure mode of a filter that is
  // forgotten should be an empty page, not another tenant's ledger.
  for (const table of ["customers", "invoices", "purchases", "payments"]) {
    const [r] = await rows(app, `SELECT count(*)::int AS n FROM ${table}`);
    check(`${table}: unscoped connection sees nothing`, num(r.n) === 0, `saw ${r.n}`);
  }

  console.log("\nscoped reads see one tenant and no other");
  await app.query("BEGIN");
  await app.query(`SELECT set_config('app.business_id', $1, true)`, [String(tenantA.id)]);

  const [scoped] = await rows(app, `
    SELECT count(*)::int AS n, count(DISTINCT business_id)::int AS tenants
      FROM customers`);
  check("sees exactly its own rows", num(scoped.n) === 2, `saw ${scoped.n}`);
  check("sees exactly one tenant", num(scoped.tenants) === 1, `saw ${scoped.tenants}`);

  const [named] = await rows(app,
    `SELECT count(*)::int AS n FROM customers WHERE business_id = $1`, [tenantB.id]);
  check("naming another tenant's id explicitly returns nothing", num(named.n) === 0, `saw ${named.n}`);

  // F-05 was four query sites that resolved a record by id with no tenant
  // filter. Under RLS that lookup returns nothing regardless of the filter.
  const [byId] = await rows(admin,
    `SELECT id FROM customers WHERE business_id = $1 LIMIT 1`, [tenantB.id]);
  const [leak] = await rows(app, `SELECT count(*)::int AS n FROM customers WHERE id = $1`, [byId.id]);
  check("an unfiltered lookup by primary key returns nothing (F-05)", num(leak.n) === 0, `saw ${leak.n}`);

  console.log("\nwrites cannot cross a tenant boundary");
  let rejected = false;
  try {
    await app.query(`INSERT INTO customers (business_id, name) VALUES ($1, 'smuggled')`, [tenantB.id]);
  } catch (err) {
    rejected = /row-level security/i.test(err.message);
  }
  check("insert into another tenant is refused by WITH CHECK", rejected);
  await app.query("ROLLBACK");

  // An UPDATE that moves a row to another tenant has to be refused too,
  // otherwise a record could be walked across the boundary one step at a time.
  await app.query("BEGIN");
  await app.query(`SELECT set_config('app.business_id', $1, true)`, [String(tenantA.id)]);
  let moveRejected = false;
  try {
    const res = await app.query(
      `UPDATE customers SET business_id = $1 WHERE business_id = $2`, [tenantB.id, tenantA.id]);
    moveRejected = res.rowCount === 0;
  } catch (err) {
    moveRejected = /row-level security/i.test(err.message);
  }
  check("moving a row to another tenant is refused", moveRejected);
  await app.query("ROLLBACK");

  console.log("\nthe scope does not outlive its transaction");
  // SET LOCAL is what makes this safe on a pooled connection: without it one
  // request's tenant would still be set when the pool hands the connection to
  // the next request, which is a cross-tenant leak that no test of a single
  // request would ever show.
  await app.query("BEGIN");
  await app.query(`SELECT set_config('app.business_id', $1, true)`, [String(tenantA.id)]);
  const [inside] = await rows(app, `SELECT count(*)::int AS n FROM customers`);
  await app.query("COMMIT");
  const [afterCommit] = await rows(app, `SELECT count(*)::int AS n FROM customers`);
  check("scope applies inside the transaction", num(inside.n) === 2, `saw ${inside.n}`);
  check("scope is gone after COMMIT on the same connection", num(afterCommit.n) === 0, `saw ${afterCommit.n}`);

  await app.query("BEGIN");
  await app.query(`SELECT set_config('app.business_id', $1, true)`, [String(tenantA.id)]);
  await app.query("ROLLBACK");
  const [afterRollback] = await rows(app, `SELECT count(*)::int AS n FROM customers`);
  check("scope is gone after ROLLBACK too", num(afterRollback.n) === 0, `saw ${afterRollback.n}`);

  console.log("\nthe system scope spans tenants, and only while it is open");
  // Admin dashboards and the pre-authentication paths legitimately span
  // tenants. They say so explicitly, and the exemption is bounded the same way.
  await app.query("BEGIN");
  await app.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
  const [sys] = await rows(app, `
    SELECT count(*)::int AS n, count(DISTINCT business_id)::int AS tenants FROM customers`);
  await app.query("COMMIT");
  const [afterSys] = await rows(app, `SELECT count(*)::int AS n FROM customers`);
  check("system scope sees more than one tenant", num(sys.tenants) > 1, `${sys.tenants} tenants`);
  check("system scope sees both seeded tenants", num(sys.n) >= 3, `saw ${sys.n}`);
  check("system scope ends with its transaction", num(afterSys.n) === 0, `saw ${afterSys.n}`);

  // Housekeeping. Fixtures are removed as the owner, since the app role has
  // just demonstrated at length that it cannot reach them.
  await admin.query(`DELETE FROM customers WHERE business_id = ANY($1)`, [[tenantA.id, tenantB.id]]);
  await admin.query(`DELETE FROM businesses WHERE id = ANY($1)`, [[tenantA.id, tenantB.id]]);
  await admin.query(`DELETE FROM users WHERE id = ANY($1)`, [[tenantA.userId, tenantB.userId]]);
} finally {
  await app.end().catch(() => {});
  await admin.end().catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
