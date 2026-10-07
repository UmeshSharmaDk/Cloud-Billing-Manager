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
CREATE ROLE gst_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA public TO gst_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gst_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gst_app;

-- So future tables and sequences are usable without repeating the grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gst_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO gst_app;
```

An authorized database administrator must provision this login for the existing
database. Set its password through the administrator's password-setting interface
or the interactive `psql` command `\password gst_app`, not in committed SQL,
command-line arguments, or application logs. Do not grant it membership in the
owner or any privileged role. Run default-privilege grants as the role that
actually creates schema objects.

Point the application's `APP_DATABASE_URL` at `gst_app`. In production the API
requires this variable and never falls back to Replit's owner-level
`DATABASE_URL`. Keep the owner connection for schema operations only:
`drizzle-kit push` and `rls:apply` need to alter tables, which `gst_app`
deliberately cannot.

Development ignores the shared production `APP_DATABASE_URL`. Use
`DEVELOPMENT_APP_DATABASE_URL` for a restricted development/scratch login, or
the development `DATABASE_URL` fallback. Local RLS tests also ignore the
production secret so adding it cannot redirect fixture writes to live data.
An application process explicitly started with `NODE_ENV=test` must provide
`TEST_APP_DATABASE_URL`; it never falls back to either shared production
credentials or the workspace owner connection.

The API server checks this at boot and reports whether policies are effective.
It refuses to serve production traffic if the application role can bypass RLS
or any tenant table lacks an active forced policy. Development remains available
for local work while reporting an unsafe development role. `pnpm --filter
@workspace/db run rls:apply` prints the policy status for the connection it uses.

## Applying

The commands below are for development or disposable test databases. Replit
Publish manages the schema in Replit's managed production database; do not point
these commands at production or add them to deployment build/startup commands.
Provisioning a restricted login is a separate administrator access-control step,
not application startup work.

Both development commands need the *owner* connection, not the application's:

```bash
DATABASE_URL=$ADMIN_DATABASE_URL pnpm --filter @workspace/db run push
DATABASE_URL=$ADMIN_DATABASE_URL pnpm --filter @workspace/db run rls:apply
```

**Run `rls:apply` after every `push`, not just after adding a table.** A push
that alters a tenant table drops its policies along the way, and the result is
the dangerous state again — RLS apparently configured, actually inert. Adding a
new tenant-scoped table additionally needs it listed in `TENANT_TABLE_COLUMNS`
in `src/rls.ts`.

The same `push` also creates the `*_business_idx` indexes on every tenant table
(and `payments_invoice_idx`). On a large existing database, create them first with
`CREATE INDEX CONCURRENTLY` so the build does not block writes.

The API server checks policy coverage at boot as well as the role, so a push
that stripped them is reported rather than assumed away, and `test:rls` fails
outright.

## Verifying

```bash
DEVELOPMENT_APP_DATABASE_URL=<restricted scratch connection> \
ADMIN_DATABASE_URL=<scratch owner connection> \
  pnpm --filter @workspace/db run test:rls
```

This asserts what the database *refuses*: unscoped reads return nothing, a
scoped connection cannot reach another tenant even by naming its id or its
primary key, cross-tenant writes are rejected, and the scope does not survive
its transaction.

It exits 2 without running if the application connection can bypass RLS, because
every assertion in it would otherwise pass while proving nothing. The
application's integration suite needs `ADMIN_DATABASE_URL` for the same reason:
it manipulates fixtures as an operator, which the application role cannot do.

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
handler answers — it commits then, and only after that is the response sent, or
it rolls back if the handler produced a 5xx. A slow handler therefore holds a
connection for its whole duration rather than for each query, so pool sizing
matters more than it did. The connection is released at commit, so a slow client
reading the response does not hold one.
Watch connection saturation after rolling this out.

**With no tenant set, the policies match nothing.** That is deliberate: a code
path that escapes the scope returns no rows rather than everyone's. Two places
legitimately span tenants and say so explicitly via `runInSystemScope` — the
platform admin dashboards, and the authentication and registration paths, which
run before a tenant is known.
