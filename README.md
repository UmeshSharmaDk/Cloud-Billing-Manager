# Billing Pilot — GST Billing & Inventory Platform

A cloud-based, multi-tenant GST Billing & Inventory Management Platform for Indian businesses. Full-stack SaaS with Admin and User panels.

## Run & Operate

- Production is billing.myindiatrips.com on Hostinger (Node.js, Git auto-deploy from `main`,
  build `pnpm run build:hostinger`, entry `server.mjs`), with Postgres on Neon.
  The Android app lives in `exports/GST-Pro-Android`.
- Node.js 24. Install dependencies with `pnpm install --frozen-lockfile`.
- Mail: `PRODUCTION_SMTP_URL` selects SMTP outside development. In development, `SMTP_URL`
  opts in to SMTP; without it, mail is only logged (or written to `MAIL_OUTBOX_PATH`).

### Schema changes

Every schema change ships as a numbered SQL file in `lib/db/migrations` (write it so it can
run twice: `IF NOT EXISTS`), together with the matching change in `lib/db/src/schema`. CI builds
its database only from the migrations and fails if they disagree with the schema code
(`lib/db/test/schema-drift.sh`).

- Apply: `DATABASE_URL=<owner url> pnpm --filter @workspace/db run migrate`
- Or set `MIGRATION_DATABASE_URL` (the schema owner) on the host: the server then applies pending
  migrations before it starts listening.
- Without either, a production server refuses to start while a migration is missing, and says
  which one, rather than serving pages that fail on a missing column.

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/gst-platform run dev` — run the frontend (port 25512)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push the schema code to a scratch database (never production)
- `pnpm --filter @workspace/api-server run test` — unit tests (password policy, breach lookup)
- Both suites run in CI (`.github/workflows/security.yml`); the integration job brings up its own
  Postgres service container
- `pnpm --filter @workspace/api-server run test:integration` — security integration suite
  (cross-tenant isolation, validation, lockout, live authorization, cookie sessions, CSRF, admin
  accountability, invoice numbering, transaction rollback). Needs a running server and a real
  Postgres; see the header of `artifacts/api-server/test/integration.mjs`.
- Required env (all fail the boot if unset — there are no defaults; see `.env.example`):
  - `APP_DATABASE_URL` — required production application connection; must use a dedicated `NOSUPERUSER NOBYPASSRLS` role with no privileged-role memberships (see `lib/db/README-rls.md`). Development ignores it and uses `DEVELOPMENT_APP_DATABASE_URL` or its local `DATABASE_URL`.
  - `SESSION_SECRET` — session signing key, minimum 32 chars (`openssl rand -base64 48`)
  - `ALLOWED_ORIGINS` — comma-separated browser origins permitted by CORS; never `*`
  - `PRODUCTION_SMTP_URL` + `MAIL_FROM` — production registration email uses user-approved Hostinger SMTP. The production secret is ignored in development; `SMTP_URL` is a separate development opt-in.
- Optional env: `MIGRATION_DATABASE_URL` (see Schema changes), `DEMO_REQUEST_TO` (who receives
  "Book a demo" requests; defaults to `MAIL_FROM`), `COOKIE_SAME_SITE` (lax | strict | none), `APP_BASE_URL`, `TRUST_PROXY` (reverse-proxy hops
  for the client address, default 1), `AUTH_RATE_LIMIT_MAX` (default 30), `REGISTER_RATE_LIMIT_MAX`,
  `TENANT_WRITE_RATE_LIMIT_MAX`, `TENANT_READ_RATE_LIMIT_MAX`, `TENANT_MAX_IN_FLIGHT` (default 16, keep below
  `DB_POOL_MAX`), `DISABLE_BREACH_CHECK` (skips the Have I Been Pwned lookup on new passwords), `NODE_ENV`
- RLS policies: `pnpm --filter @workspace/db run rls:apply` with the owner connection (safe to repeat).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Auth: session JWT in an `HttpOnly` cookie (bearer header still accepted for native clients),
  double-submit CSRF, Argon2id password hashing
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Frontend: React + Vite, TanStack Query, Wouter router, shadcn/ui, Tailwind CSS
- Charts: Recharts
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/api-server/` — Express API server
- `artifacts/gst-platform/` — React frontend
- `lib/api-spec/` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/` — Generated React Query hooks + Zod schemas
- `lib/db/` — Drizzle ORM schema + migrations

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → typed React Query hooks
- Multi-tenant: each user belongs to a business; all data queries are scoped by `businessId`
- Session token lives in the `gst_session` `HttpOnly` cookie — page scripts cannot read it. Browser
  clients echo the readable `gst_csrf` cookie in an `X-CSRF-Token` header on writes. Native clients
  may still use `Authorization: Bearer`.
- Password hashing: Argon2id (OWASP baseline: 19 MiB, t=2, p=1), salt generated per password and
  embedded in the stored hash. Pre-existing SHA-256 hashes are re-hashed transparently on next login
  — see `artifacts/api-server/src/lib/password.ts`
- GST calculation: CGST+SGST for intra-state, IGST for inter-state, based on `placeOfSupply` vs business state code
- Money and tax use exact decimal arithmetic (`artifacts/api-server/src/lib/money.ts`, decimal.js).
  Round at the line, then sum the rounded values, so an invoice total is always the exact sum of its
  items — which is what a GSTR-1 return has to show. Do not reintroduce `parseFloat` for amounts.
- Invoice numbering: `<prefix>-<financial year>-<0001>`, allocated from the `invoice_counters` table.
  Indian FY (April–March), never reused, unique per business at the database level
- Privileged admin actions are recorded in `audit_log` and require the admin to re-enter their own
  password (`confirmPassword` in the body)
- Admins and superadmins must have TOTP two-factor authentication on before any admin route answers
  (`403 mfa_enrolment_required` otherwise; the web app sends them to `/security`). Login for an MFA
  account returns `{ mfaRequired, mfaToken }` and finishes at `/auth/mfa/login`. A superadmin can
  reset another admin's MFA. See "Two-factor authentication for administrators" in SECURITY-REVIEW.md

## Product

- No public sign-up. The superadmin invites admins; admins create their users. The public site
  has sign-in, forgot password and "Book a free demo" only.
- **User**: dashboard, invoices, purchases, inventory, customers, vendors, payments, e-way bills,
  GST reports (GSTR-1, GSTR-3B, HSN, TDS, TCS), business settings.
- **Admin**: every client's month on one screen, users, read-only view of a user's books, books freeze.
  Admins have a plan end date; when it passes, the admin and their users cannot sign in.
- **Superadmin**: admins, seat requests (granted only on approval), demo requests.

## User preferences

- All pages use correct generated hook names from `lib/api-client-react/src/generated/api.ts`
- Query hooks use `export function use...` pattern; mutation hooks use `export const use...` pattern
- Always import from `@workspace/api-client-react` main entry — never subpath imports

## Gotchas

- Query hook naming: `useListCustomers` (not `useGetCustomers`), `useListInvoices`, `useListProducts`, `useListVendors`, `useListPurchases`, `useListPayments`, `useListUsers`
- Report params: `{ month: number, year: number }` — not startDate/endDate
- Payment list filter: `{ type: string }` — not `paymentType`
- `setAuthTokenGetter` must be imported from main `@workspace/api-client-react` package, not from subpath

## Pointers

- Generated hooks: `lib/api-client-react/src/generated/api.ts`
- DB schema: `lib/db/src/schema/`, migrations: `lib/db/migrations/`
- API routes: `artifacts/api-server/src/routes/`
