# GST Pro — GST Billing & Inventory Platform

A cloud-based, multi-tenant GST Billing & Inventory Management Platform for Indian businesses. Full-stack SaaS with Admin and User panels.

## Run & Operate

- Replit development preview: start the managed workflows
  `artifacts/api-server: API Server` and `artifacts/gst-platform: web`.
  The frontend is served at `/`; the API is served at `/api`.
  The unused Canvas workflow does not need to run.
- This import runs on Node.js 24. Install dependencies with
  `pnpm install --frozen-lockfile`. The development schema and RLS policies
  have been initialized in the workspace PostgreSQL database; no user
  accounts or business records were imported from GitHub.
- The API development workflow supplies the preview CORS origins and its
  `dev` script sets `NODE_ENV=development`. Without `SMTP_URL`, verification
  emails are logged in the API workflow console rather than delivered.
  Register through the app and open the verification link from that console
  to finish creating a development account.
- Production uses `ALLOWED_ORIGINS` and `APP_BASE_URL` from production-scoped
  environment variables. Keep both aligned with the published domain.
  `PRODUCTION_SMTP_URL` selects SMTP outside development, with `SMTP_URL` as
  the shared fallback. Development ignores the production-only credential.
  Configure a dedicated non-superuser, non-BYPASSRLS application database
  connection before using the app for production business data.
  The current workspace owner connection bypasses RLS, as reported by the
  API startup warning; application query filters still apply.
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/gst-platform run dev` — run the frontend (port 25512)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run test` — unit tests (password policy, breach lookup)
- Both suites run in CI (`.github/workflows/security.yml`); the integration job brings up its own
  Postgres service container
- `pnpm --filter @workspace/api-server run test:integration` — security integration suite
  (cross-tenant isolation, validation, lockout, live authorization, cookie sessions, CSRF, admin
  accountability, invoice numbering, transaction rollback). Needs a running server and a real
  Postgres; see the header of `artifacts/api-server/test/integration.mjs`.
- Required env (all fail the boot if unset — there are no defaults; see `.env.example`):
  - `DATABASE_URL` — Postgres connection string; must be a role without `BYPASSRLS` (see `lib/db/README-rls.md`)
  - `SESSION_SECRET` — session signing key, minimum 32 chars (`openssl rand -base64 48`)
  - `ALLOWED_ORIGINS` — comma-separated browser origins permitted by CORS; never `*`
  - `SMTP_URL` (or production-only `PRODUCTION_SMTP_URL`) + `MAIL_FROM` — registration is confirmed by emailed link, so production refuses to boot without a mail transport
- Optional env: `COOKIE_SAME_SITE` (lax | strict | none), `APP_BASE_URL`, `TRUST_PROXY` (reverse-proxy hops
  for the client address, default 1), `AUTH_RATE_LIMIT_MAX` (default 30), `REGISTER_RATE_LIMIT_MAX`,
  `TENANT_WRITE_RATE_LIMIT_MAX`, `TENANT_READ_RATE_LIMIT_MAX`, `TENANT_MAX_IN_FLIGHT` (default 16, keep below
  `DB_POOL_MAX`), `DISABLE_BREACH_CHECK` (skips the Have I Been Pwned lookup on new passwords), `NODE_ENV`
- After any `push`, run `pnpm --filter @workspace/db run rls:apply` with the owner connection
  (`scripts/post-merge.sh` does both)

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
- Build: esbuild (CJS bundle)

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

## Product

- **User Panel**: Dashboard, Sales Invoices (create/view/status), Purchase Bills (ITC tracking), Inventory/Products, Customers, Vendors, Payments, GST Reports (GSTR-1, GSTR-3B), Business Settings
- **Admin Panel**: Platform dashboard, User management (subscriptions, activation)

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

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Generated hooks: `lib/api-client-react/src/generated/api.ts`
- DB schema: `lib/db/src/schema.ts`
- API routes: `artifacts/api-server/src/routes/`
