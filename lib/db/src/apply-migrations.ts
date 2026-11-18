/**
 * Apply pending schema migrations: `DATABASE_URL=<owner url> pnpm --filter @workspace/db run migrate`.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrations, migrateDatabase } from "./migrate.ts";

const url = process.env["DATABASE_URL"];
if (!url) {
  console.error("DATABASE_URL must be set to the schema owner's connection.");
  process.exit(1);
}

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const ssl = process.env["DATABASE_SSL"] === "true" ? { rejectUnauthorized: true } : undefined;
const ran = await migrateDatabase(url, ssl, readMigrations(dir), (l) => console.log(l));
console.log(ran.length ? `Applied ${ran.length} migration(s).` : "Database is up to date.");
