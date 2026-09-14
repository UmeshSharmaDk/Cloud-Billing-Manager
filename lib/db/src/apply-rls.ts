/**
 * Install the row-level security policies.
 *
 * Kept out of `drizzle-kit push`, which manages tables and columns but not
 * policies. Safe to run repeatedly. Uses the pg driver directly rather than
 * the ORM — a schema migration should not depend on the query builder.
 */

import pg from "pg";
import { rlsStatements, inspectRls, describeRlsProblem } from "./rls.ts";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL must be set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });

async function main() {
  await client.connect();

  for (const statement of rlsStatements()) {
    process.stdout.write(`  ${statement.slice(0, 96)}\n`);
    await client.query(statement);
  }

  const status = await inspectRls(async (sql) => (await client.query(sql)).rows);
  process.stdout.write(`\nProtected tables: ${status.protectedTables.join(", ")}\n`);
  process.stdout.write(`Connecting role:  ${status.role}\n`);

  const problem = describeRlsProblem(status);
  if (problem) {
    // Applying the policies succeeded; whether they bite is a deployment
    // question this script cannot decide. Say so rather than failing silently.
    process.stdout.write(`\nWARNING\n${problem}\n`);
  } else {
    process.stdout.write("\nRow-level security is in effect for this role.\n");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
