# GST Pro — GST Billing & Inventory Platform

A cloud-based, multi-tenant GST Billing & Inventory Management Platform for Indian businesses. Full-stack SaaS with Admin and User panels.

## Run & Operate

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
  - `DATABASE_URL` — Postgres connection string
  - `SESSION_SECRET` — session signing key, minimum 32 chars (`openssl rand -base64 48`)
  - `ALLOWED_ORIGINS` — comma-separated browser origins permitted by CORS; never `*`
- Optional env: `COOKIE_SAME_SITE` (lax | strict | none), `AUTH_RATE_LIMIT_MAX` (default 30),
  `DISABLE_BREACH_CHECK` (skips the Have I Been Pwned lookup on new passwords), `NODE_ENV`

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
