#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Schema changes and policies are applied with the owner connection; the
# application's own role (gst_app) deliberately cannot alter tables. Fall back
# to DATABASE_URL for single-role development setups.
export DATABASE_URL="${ADMIN_DATABASE_URL:-$DATABASE_URL}"
pnpm --filter @workspace/db run push
# Always after a push: a push that alters a tenant table drops its row-level
# security policies, which leaves isolation apparently configured and inert.
pnpm --filter @workspace/db run rls:apply
