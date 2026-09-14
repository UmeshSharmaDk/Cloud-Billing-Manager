# Row-level security

Tenant isolation is enforced twice: by the `businessId` filter on every query,
and by Postgres policies underneath. The filters are the working mechanism; the
policies are what catches the one that gets forgotten. Finding F-05 was four
query sites out of roughly forty that resolved a record by id without a filter,
and code review did not catch them.

## It does nothing unless you use a dedicated role

**A superuser, or any role with `BYPASSRLS`, ignores every policy.** Hosted
Postgres usually hands out an admin connection string, so an application using
it would have RLS enabled, policies installed, and no protection at all — the
worst outcome, because it looks protected.

Create a role that cannot bypass:

```sql
CREATE ROLE gst_app LOGIN PASSWORD '<generate one>' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO gst_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gst_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gst_app;

-- So future tables and sequences are usable without repeating the grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gst_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gst_app;
```

Point the application's `DATABASE_URL` at `gst_app`. Keep the owner connection
for migrations only — `drizzle-kit push` and `rls:apply` need to alter tables,
which `gst_app` deliberately cannot.

The API server checks this at boot and logs a warning naming the role if the
connection can bypass policies. `pnpm --filter @workspace/db run rls:apply`
prints the same warning.

## Applying

Both commands need the *owner* connection, not the application's:

```bash
DATABASE_URL=$ADMIN_DATABASE_URL pnpm --filter @workspace/db run push
DATABASE_URL=$ADMIN_DATABASE_URL pnpm --filter @workspace/db run rls:apply
```

**Run `rls:apply` after every `push`, not just after adding a table.** A push
that alters a tenant table drops its policies along the way, and the result is
the dangerous state again — RLS apparently configured, actually inert. Adding a
new tenant-scoped table additionally needs it listed in `TENANT_TABLE_COLUMNS`
in `src/rls.ts`.

The API server checks policy coverage at boot as well as the role, so a push
that stripped them is reported rather than assumed away, and `test:rls` fails
outright.

## Verifying

```bash
DATABASE_URL=<gst_app connection> \
ADMIN_DATABASE_URL=<owner connection> \
  pnpm --filter @workspace/db run test:rls
```

This asserts what the database *refuses*: unscoped reads return nothing, a
scoped connection cannot reach another tenant even by naming its id or its
primary key, cross-tenant writes are rejected, and the scope does not survive
its transaction.

It exits 2 without running if `DATABASE_URL` can bypass RLS, because every
assertion in it would otherwise pass while proving nothing. The application's
integration suite needs `ADMIN_DATABASE_URL` for the same reason: it
manipulates fixtures as an operator, which the application role cannot do.

## How the tenant reaches the database

`requireBusiness` resolves the caller's tenant, and `tenantScope` opens one
transaction per request with `SET LOCAL app.business_id`. Queries made during
the request run on that transaction, because the exported `db` is a proxy that
forwards into the active scope (`src/tenant-scope.ts`). No query site opts in,
so none can forget.

`SET LOCAL` scopes the value to the transaction, which is what stops a pooled
connection carrying one request's tenant into the next.

### The cost

One transaction is held open per request, from `requireBusiness` until the
response is written — it commits on the way out, or rolls back if the handler
produced a 5xx. A slow handler therefore holds a connection for its whole
duration rather than for each query, so pool sizing matters more than it did.
Watch connection saturation after rolling this out.

**With no tenant set, the policies match nothing.** That is deliberate: a code
path that escapes the scope returns no rows rather than everyone's. Two places
legitimately span tenants and say so explicitly via `runInSystemScope` — the
platform admin dashboards, and the authentication and registration paths, which
run before a tenant is known.
