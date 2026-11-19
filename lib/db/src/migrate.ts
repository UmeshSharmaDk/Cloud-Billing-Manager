/**
 * Versioned schema migrations.
 *
 * Every schema change ships as a numbered SQL file in `lib/db/migrations`,
 * reviewed in its pull request. `runMigrations` applies the ones a database
 * has not seen, in order, each in its own transaction, and records them in
 * `schema_migrations`. A database that already holds the schema but has never
 * been migrated (production before this file existed) adopts the baseline
 * without running it.
 *
 * The runner needs the schema owner's connection; the application role cannot
 * alter tables. The application only reads `schema_migrations` to see whether
 * it is running ahead of its database.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export interface Migration {
  name: string;
  sql: string;
}

const BASELINE = "0000_baseline";
const LOCK_KEY = 727_001; // any constant; serialises concurrent runners

export function readMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ name: f.replace(/\.sql$/, ""), sql: readFileSync(path.join(dir, f), "utf8") }));
}

/** Names in `all` that `applied` lacks, in order. */
export function pendingMigrations(all: Migration[], applied: Iterable<string>): string[] {
  const done = new Set(applied);
  return all.map((m) => m.name).filter((n) => !done.has(n));
}

type Query = Pick<pg.Client, "query">;

export async function appliedMigrations(client: Query): Promise<string[] | null> {
  const exists = await client.query(`SELECT to_regclass('public.schema_migrations') AS t`);
  if (!exists.rows[0]?.t) return null;
  const res = await client.query(`SELECT name FROM schema_migrations ORDER BY name`);
  return res.rows.map((r: { name: string }) => r.name);
}

/** Apply pending migrations. Returns the names applied. */
export async function runMigrations(
  client: Query,
  all: Migration[],
  log: (line: string) => void = () => {},
): Promise<string[]> {
  await client.query(`SELECT pg_advisory_lock(${LOCK_KEY})`);
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const applied = (await appliedMigrations(client)) ?? [];
    if (applied.length === 0) {
      const existing = await client.query(`SELECT to_regclass('public.users') AS t`);
      if (existing.rows[0]?.t) {
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [BASELINE]);
        applied.push(BASELINE);
        log(`${BASELINE}: schema already present, recorded without running`);
      }
    }
    const ran: string[] = [];
    for (const name of pendingMigrations(all, applied)) {
      const m = all.find((x) => x.name === name)!;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [name]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
      }
      ran.push(name);
      log(`${name}: applied`);
    }
    // The application role reads this table at boot. Granted every run so a
    // freshly created table is covered; harmless when the role does not exist.
    await client.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gst_app') THEN GRANT SELECT ON schema_migrations TO gst_app; END IF; END $$`,
    );
    return ran;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_KEY})`);
  }
}

/** Connect as `url` (the schema owner), apply pending migrations, disconnect. */
export async function migrateDatabase(
  url: string,
  ssl: pg.ClientConfig["ssl"],
  all: Migration[],
  log?: (line: string) => void,
): Promise<string[]> {
  const client = new pg.Client({ connectionString: url, ssl });
  await client.connect();
  try {
    return await runMigrations(client, all, log);
  } finally {
    await client.end();
  }
}
