#!/usr/bin/env bash
# Fails when the schema code (src/schema) and the migrations disagree: builds one
# database from the migrations and one with drizzle-kit push, then compares
# columns, indexes and constraints. Needs PGHOST/PGUSER/PGPASSWORD for a
# superuser and the pnpm workspace installed.
set -euo pipefail
cd "$(dirname "$0")/.."
base="postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT:-5432}"
for db in drift_migrated drift_pushed; do
  psql -d postgres -qc "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db"
done
DATABASE_URL="$base/drift_migrated" node src/apply-migrations.ts >/dev/null
DATABASE_URL="$base/drift_pushed" npx drizzle-kit push --force --config ./drizzle.config.ts >/dev/null
describe() {
  psql -d "$1" -AtX <<'SQL'
SELECT 'column', table_name, column_name, data_type, is_nullable, coalesce(column_default, '')
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> 'schema_migrations' ORDER BY 2, 3;
SELECT 'index', indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY 2;
SELECT 'constraint', conrelid::regclass::text, conname, pg_get_constraintdef(oid) FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text <> 'schema_migrations' ORDER BY 2, 3;
SQL
}
if diff <(describe drift_migrated) <(describe drift_pushed); then
  echo "Migrations match the schema code."
else
  echo "::error::The schema code and lib/db/migrations disagree (< migrations, > schema code). Add a migration."
  exit 1
fi
