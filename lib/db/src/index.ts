import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { createScopedDb } from "./tenant-scope";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** The pooled database, without any tenant context. */
export const rootDb = drizzle(pool, { schema });

/**
 * The database as the application uses it.
 *
 * Inside a tenant scope (see `tenant-scope.ts`) every query runs on that
 * scope's transaction, which is the connection carrying `app.business_id` —
 * so the row-level security policies apply. Outside one it behaves exactly as
 * the pooled database always did.
 *
 * This indirection is why enabling RLS did not require touching a hundred
 * query sites, and why a new one cannot forget to opt in.
 */
export const db: typeof rootDb = createScopedDb(rootDb);

export * from "./schema";
export {
  runInTenantScope,
  runInSystemScope,
  currentBusinessId,
  inTenantScope,
} from "./tenant-scope";
export {
  rlsStatements,
  inspectRls,
  describeRlsProblem,
  TENANT_TABLES,
  type RlsStatus,
} from "./rls";
