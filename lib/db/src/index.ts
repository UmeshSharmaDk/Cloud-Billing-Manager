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

/**
 * Keep an idle-connection failure from killing the process.
 *
 * `pg.Pool` emits `error` for problems on a connection that is sitting idle in
 * the pool — the database restarted, a failover moved the primary, an operator
 * ran `pg_terminate_backend`, a firewall dropped an idle socket. That is an
 * EventEmitter `error` event, so with no listener attached Node treats it as an
 * unhandled error and terminates: a routine database restart took the entire
 * API server down with it, and the request that happened to be in flight was
 * never the cause.
 *
 * The pool discards the broken connection and opens a fresh one on the next
 * query, so there is nothing to do here but say what happened. Writing to
 * stderr rather than the application logger keeps this package free of a
 * logging dependency; the process manager collects it either way.
 */
pool.on("error", (err) => {
  console.error("[db] idle client error (the pool will reconnect):", err);
});

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
