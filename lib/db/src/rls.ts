/**
 * Row-level security: tenant isolation enforced by Postgres, not by convention.
 *
 * Every tenant-scoped query in this codebase carries an explicit
 * `businessId` filter, and those filters are correct — now. They were not
 * always: finding F-05 was four query sites, out of roughly forty, that
 * resolved a record by id without one. Code review did not catch it. A policy
 * in the database does not depend on anyone remembering.
 *
 * The explicit filters stay. This is a second wall, not a replacement.
 *
 * TWO WAYS THIS SILENTLY DOES NOTHING, both guarded against below:
 *
 *   1. The table owner bypasses its own policies unless the table is set to
 *      FORCE ROW LEVEL SECURITY. Every statement here sets it.
 *
 *   2. A superuser — or any role with BYPASSRLS — ignores policies entirely,
 *      FORCE or not. Hosted Postgres commonly hands out an admin connection
 *      string, so an application connecting with it would have RLS enabled,
 *      policies in place, and no protection whatsoever. `assertRlsEffective`
 *      exists to make that state loud instead of invisible.
 */

/**
 * Tables behind a tenant boundary, and the column that carries it.
 *
 * `businesses` is included and keyed on its own `id`: it holds the GSTIN and
 * the bank account, which is exactly the sort of thing a forgotten filter
 * should not be able to hand to the wrong tenant. Registration creates a
 * business before any tenant exists, so that path runs in system scope.
 *
 * `users`, `audit_log`, `login_attempts` and `invoice_counters` are absent on
 * purpose. They are not tenant-scoped — authentication has to find a user
 * before a tenant is known, and the admin surfaces read across all of them.
 * They are protected by the application's own authorization checks.
 */
export const TENANT_TABLE_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["customers", "business_id"],
  ["vendors", "business_id"],
  ["products", "business_id"],
  ["invoices", "business_id"],
  ["purchases", "business_id"],
  ["payments", "business_id"],
  ["eway_bills", "business_id"],
  ["businesses", "id"],
];

export const TENANT_TABLES = TENANT_TABLE_COLUMNS.map(([t]) => t);

/**
 * The predicate, used for both reading and writing.
 *
 * `nullif(..., '')` matters more than it looks: after a transaction that used
 * `SET LOCAL` commits, the setting reverts to an empty string rather than
 * NULL, and `''::int` raises. Without the nullif, the first query after any
 * tenant-scoped request would fail with a type error instead of returning
 * nothing.
 *
 * With no tenant set the predicate is NULL, which is not true, so the default
 * is to see nothing. Fail closed.
 */
const predicateFor = (column: string) => `
    nullif(current_setting('app.bypass_rls', true), '') = 'on'
    OR "${column}" = nullif(current_setting('app.business_id', true), '')::int`;

export const RLS_POLICY_NAME = "tenant_isolation";

/** Statements that install the policies. Idempotent. */
export function rlsStatements(): string[] {
  const out: string[] = [];
  for (const [table, column] of TENANT_TABLE_COLUMNS) {
    const predicate = predicateFor(column);
    out.push(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    // Without FORCE, the role that owns the table ignores its own policy.
    out.push(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    out.push(`DROP POLICY IF EXISTS "${RLS_POLICY_NAME}" ON "${table}"`);
    out.push(
      `CREATE POLICY "${RLS_POLICY_NAME}" ON "${table}" ` +
        `USING (${predicate}) WITH CHECK (${predicate})`,
    );
  }
  return out;
}

export interface RlsStatus {
  /** Roles with BYPASSRLS, or superusers, ignore every policy. */
  connectingRoleBypasses: boolean;
  role: string;
  /** Tables that have RLS both enabled and forced. */
  protectedTables: string[];
  /** Tenant tables missing a policy or missing FORCE. */
  unprotectedTables: string[];
}

/** Runs a SQL string and returns rows. Lets a raw pg client or drizzle be used. */
export type QueryFn = (sql: string) => Promise<Array<Record<string, unknown>>>;

export const ROLE_BYPASS_SQL = `
  SELECT current_user::text AS role,
         (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses`;

export const TABLE_STATE_SQL = `
  SELECT c.relname::text AS table_name,
         c.relrowsecurity AS enabled,
         c.relforcerowsecurity AS forced,
         EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) AS has_policy
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'`;

/** Inspect whether RLS is actually in force for the connecting role. */
export async function inspectRls(query: QueryFn): Promise<RlsStatus> {
  const [info] = await query(ROLE_BYPASS_SQL);
  const tableRows = await query(TABLE_STATE_SQL);

  const byTable = new Map(tableRows.map((r) => [String(r["table_name"]), r]));

  const protectedTables: string[] = [];
  const unprotectedTables: string[] = [];
  for (const table of TENANT_TABLES) {
    const r = byTable.get(table);
    if (r?.["enabled"] && r?.["forced"] && r?.["has_policy"]) protectedTables.push(table);
    else unprotectedTables.push(table);
  }

  return {
    connectingRoleBypasses: Boolean(info?.["bypasses"]),
    role: String(info?.["role"] ?? "unknown"),
    protectedTables,
    unprotectedTables,
  };
}

/**
 * Describe the state in a sentence an operator can act on. Returns null when
 * everything is in order.
 */
export function describeRlsProblem(status: RlsStatus): string | null {
  if (status.connectingRoleBypasses) {
    return (
      `Row-level security is NOT in effect: the database role "${status.role}" is a superuser ` +
      `or holds BYPASSRLS, so Postgres ignores every tenant policy for it. ` +
      `Point DATABASE_URL at a dedicated application role created with ` +
      `NOSUPERUSER NOBYPASSRLS (see lib/db/README-rls.md). Tenant isolation ` +
      `currently rests entirely on the application's own query filters.`
    );
  }
  if (status.unprotectedTables.length > 0) {
    return (
      `Row-level security is missing or unforced on: ${status.unprotectedTables.join(", ")}. ` +
      `Run "pnpm --filter @workspace/db run rls:apply".`
    );
  }
  return null;
}
