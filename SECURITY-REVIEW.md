# Security & Code Review — GST Pro (Cloud-Billing-Manager)

**Reviewed:** 31 August 2026 · **Head commit:** `a566388` · **Scope:** ~19,700 LOC across 8 workspace packages
**Focus:** `artifacts/api-server`, `lib/db`, `artifacts/gst-platform`

Static review. Findings F-01 and F-03 were verified with a local proof-of-concept; all others were
confirmed by source inspection. No running instance was tested, no dynamic testing or dependency CVE
scan was performed — absence of a finding here is not evidence of absence.

---

## Verdict

**Not safe to expose to the internet.**

The API server signs session tokens with a hardcoded fallback secret committed to this repository. A
valid seven-day admin token can be forged from the repo contents alone — no database, no credentials,
no network access. That single line collapses every authorization check in the codebase, because
`requireAdmin` trusts a claim inside the token rather than the database.

Independently: the login page ships click-to-fill credentials for what appears to be a live
platform-admin account, and passwords are stored as unsalted single-round SHA-256 (~600,000
guesses/sec on one CPU core of the review machine; a commodity GPU does billions).

The tenant-isolation model is sound in design — every table carries `businessId` and nearly every
query scopes to it — but it is enforced by hand in roughly forty places and already leaks in four.
Nothing here is architecturally unfixable. The critical three are about a day of work; the rest is a
fortnight of disciplined hardening.

| Severity | Count | Nature |
| --- | --- | --- |
| Critical | 3 | Full authentication bypass or credential compromise |
| High | 6 | Cross-tenant exposure, unvalidated input, stale authorization |
| Medium | 5 | Information leakage, resource exhaustion, weak policy |
| Low | 5 | Hardening gaps and hygiene |

---

## Findings index

| ID | Severity | Finding |
| --- | --- | --- |
| F-01 | Critical | Hardcoded JWT signing secret in source |
| F-02 | Critical | Admin credentials published on the login screen |
| F-03 | Critical | Passwords stored as unsalted SHA-256 |
| F-04 | High | No request validation on any endpoint |
| F-05 | High | Cross-tenant leak via unscoped customer and vendor lookups |
| F-06 | High | No rate limiting or lockout on login |
| F-07 | High | Authorization frozen in the token for seven days |
| F-08 | High | CORS open to every origin |
| F-09 | High | Token in localStorage with no CSP or security headers |
| F-10 | Medium | Stack traces returned to clients on unhandled errors |
| F-11 | Medium | Unbounded queries and pagination |
| F-12 | Medium | No password policy enforced anywhere |
| F-13 | Medium | Unlogged admin takeover and destructive hard deletes |
| F-14 | Medium | Account enumeration and timing-unsafe comparison |
| L-01…05 | Low | gitignore, unscoped e-way references, spec, CI, dead dependency |

---

# Critical

Each of these gives an unauthenticated attacker platform-administrator access on its own. Fixing two
of the three does not help.

## F-01 — The JWT signing secret is committed to the repository

**CWE-321 · Hardcoded cryptographic key** · `artifacts/api-server/src/routes/auth.ts:9`

```ts
const JWT_SECRET = process.env.SESSION_SECRET ?? "gst-platform-secret-2024";
```

If `SESSION_SECRET` is missing, unset, or empty at boot, the server silently falls back to a secret
that is public in this repo. Nothing logs a warning; the application starts and behaves normally.

**Why it matters.** Confirmed by forging a token from the repo contents alone:

```
Forged admin token:
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc4ODIwMDY2OSwiZXhwIjoxNzg4ODA1NDY5fQ.Jq-2iGiI4eIJlfXPMiXRQSAvg-nXA1-SlxE7-pCS5jQ

Signature verifies against default secret: true
```

Present that as `Authorization: Bearer …` and `requireAuth` accepts it, then `requireAdmin` reads
`role: "admin"` straight out of the payload. No database lookup ever contradicts it. That is read and
write access to every tenant's invoices, customers, vendors, GSTINs and tax filings, plus the ability
to delete users and reset any password. The blast radius spans every instance ever run from this
codebase without the variable set.

**Fix.**

```ts
const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters.");
}
```

Fail closed at boot, exactly as `lib/db/src/index.ts` already does for `DATABASE_URL` — the pattern is
in the codebase, it just was not applied here. Then:

- Generate with `openssl rand -base64 48`; store in the deployment's secret manager, never in a file.
- **Rotate now.** Tokens minted under the old secret stay valid for seven days; rotation kills them.
- Move the check into a single `config.ts` that validates every required variable once at startup.
- Add a CI grep that fails the build on `process.env.X ?? "literal"` for secret-shaped names.

## F-02 — Working admin credentials are printed on the public login page

**CWE-798 · Hardcoded credentials** · `artifacts/gst-platform/src/pages/login.tsx:66-78`, `replit.md:52`

```tsx
<p>Demo Credentials (click to fill):</p>
<button onClick={() => { setEmail("demo@acmeindia.in");     setPassword("Demo@123"); }}>…
<button onClick={() => { setEmail("admin@gstplatform.in"); setPassword("Admin@123"); }}>…
```

The second button fills credentials for the **platform administrator** — the account that manages
every tenant's subscription and can reset any user's password. It renders to every unauthenticated
visitor, and the same pair is documented in `replit.md`.

**Why it matters.** This needs no technique. Anyone who loads the login page clicks one button and
signs in as platform admin. Search engines index login pages; credentials in a public repo are
harvested by automated scanners within hours of a deployment going live.

**Fix.**

- **Delete the admin button outright.** A demo affordance must never point at a privileged account.
- Rotate both passwords; treat `admin@gstplatform.in` as compromised on any reachable instance.
- If a demo login is wanted, gate the block behind `import.meta.env.DEV` so it cannot reach a
  production bundle, and point it at a disposable, read-only tenant with synthetic data.
- Remove the credential pair from `replit.md`; a README is a public document.
- Require MFA for any account with `role === "admin"` before general availability.

## F-03 — Passwords are hashed with a single round of SHA-256 and one global salt

**CWE-916 · Weak password hash** · `routes/auth.ts:11-13`, `routes/users.ts:9-11`

```ts
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "gst_salt_v1").digest("hex");
}
```

The README describes this as "bcrypt-style SHA-256 hashing." It is not bcrypt-style in any respect:
SHA-256 is a fast general-purpose digest with no work factor, and `"gst_salt_v1"` is a constant shared
by every user — a pepper, not a salt.

**Why it matters.** Measured on the review machine, single-threaded:

```
sha256('Admin@123' + 'gst_salt_v1') = 6580c619…9cd2853b
Same input -> same digest every time (no per-user salt): true
Single-threaded guesses/sec: ~599,510
```

Two consequences follow from the shared salt specifically:

- **One rainbow table breaks the whole database.** The salt is known and constant, so an attacker
  precomputes once and cracks every user at lookup speed.
- **Identical passwords produce identical hashes**, so a dump reveals which accounts share a password
  — including which match the published `Admin@123`.

Users reuse passwords, so a dump here becomes a credential-stuffing corpus against their banking and
GST portal logins.

**Fix.**

```ts
import argon2 from "argon2";  // or bcrypt

export const hashPassword = (pw: string) =>
  argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2 });

export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw);
```

Both generate a unique random salt per password and embed it in the stored string, so no schema change
is needed beyond widening the column. `build.mjs` already externalises `bcrypt` and `argon2` from the
esbuild bundle.

Migrating without forcing a global reset:

1. Add a `passwordAlgo` column defaulting to `"sha256-v1"`.
2. On a successful login against a legacy hash, re-hash the plaintext with Argon2id and write back
   both fields. Users migrate transparently as they sign in.
3. After a migration window, force a reset on the remainder and drop the legacy branch.
4. Hoist the function into one shared module — it is currently duplicated verbatim in two files, so
   any fix applied to one will silently miss the other.

---

# High

## F-04 — Not one endpoint validates its request body

**CWE-20** · all 13 routers under `artifacts/api-server/src/routes/`

Every handler destructures `req.body` and passes values to Drizzle unchecked. The only `.parse()` call
in the entire server is on a hardcoded object in the health check.

`lib/api-zod/` already contains a generated Zod schema for **every request shape** in the OpenAPI
contract — `InvoiceInput`, `LoginInput`, `ProductUpdate`, all 60-odd. The validation layer was built
and then never wired up.

**Why it matters.**

- **Type confusion into 500s.** `POST /api/auth/login` with `{"email": 123}` reaches
  `email.toLowerCase()` on a number and throws.
- **Mass assignment.** `PATCH /api/admin/users/:id` copies `role` with no allowlist —
  `{"role": "superadmin"}` writes a role the authorization code has never heard of.
- **Nonsense in statutory records.** `calcGst` runs `parseFloat` over attacker-supplied items; a
  negative quantity or a 900% GST rate is accepted and stored on a GSTR-1 filing.
- **Unbounded strings** flow into `text` columns with no length cap.

**Fix.**

```ts
// middleware/validate.ts
export const validate = (schema: ZodType) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: "Invalid request", details: result.error.issues });
  }
  req.body = result.data;   // narrowed, coerced, unknown keys stripped
  next();
};

router.post("/", requireAuth, validate(InvoiceInput), handler);
```

Mechanical work: import from `@workspace/api-zod` and attach one middleware per route. Do the same for
`req.query` with a coercing schema, which also closes F-11. Tighten the generated schemas where the
contract is looser than reality — non-negative quantities, GST rate constrained to the statutory set
(0, 0.25, 3, 5, 12, 18, 28), `role` as an enum.

## F-05 — Customer and vendor lookups skip the tenant filter

**CWE-639** · `invoices.ts:115`, `invoices.ts:181`, `purchases.ts:149`, `purchases.ts:192`

Tenant isolation is enforced by hand on every query. It holds in roughly forty places and fails in
four — all four on the same pattern, a lookup by ID with no `businessId` condition:

```ts
// invoices.ts:114-119 — VULNERABLE
if (customerId) {
  const [customer] = await db.select().from(customersTable)
    .where(eq(customersTable.id, parseInt(customerId)))   // no businessId filter
    .limit(1);
  if (customer) {
    resolvedCustomerName  = customer.name;
    resolvedCustomerGstin = customer.gstin ?? null;
  }
}
```

Compare the correct pattern used everywhere else, at `customers.ts:40`:

```ts
.where(and(
  eq(customersTable.id, parseInt(req.params.id)),
  eq(customersTable.businessId, businessId!),
))
```

**Why it matters.** Any authenticated tenant can enumerate integer IDs and pull **the name and GSTIN of
every customer and vendor on the platform**. Post an invoice with `customerId: 4211`; the server
resolves the foreign tenant's record, copies the name and GSTIN onto your invoice, and returns it in
the 201 response. Delete the invoice afterwards and the extraction leaves almost no trace. Loop the ID
space and you have scraped the platform's entire counterparty graph — for a competitor, a customer
list with tax identities attached. The identical bug on `vendorsTable` leaks the supply side.

**Fix.** Patch the four call sites to include `eq(table.businessId, businessId)` and return `400` when
the ID does not resolve, rather than silently falling back to `"Unknown"` — a silent fallback hides the
probe. Then remove the class of bug:

- Wrap tenant tables behind helpers that *require* a business ID — `findCustomer(businessId, id)` — so
  an unscoped query cannot be written by accident.
- Better: enable PostgreSQL row-level security with a per-request `SET LOCAL app.business_id`, making
  isolation a database guarantee rather than a code convention. With eight tenant-scoped tables and
  one connection pool this is a contained change.
- Add an integration test that creates two businesses and asserts every `:id` route returns 404 across
  the boundary. This bug survives code review; it does not survive that test.

## F-06 — Login accepts unlimited attempts at full speed

**CWE-307** · `routes/auth.ts:45`, `app.ts`

No rate-limiting middleware anywhere, no per-account attempt counter, no lockout, no CAPTCHA, no delay.
`POST /api/auth/login`, `/register` and the admin `/reset-password` endpoint are all unthrottled.

**Why it matters.** Credential stuffing is limited only by network round-trips. Because passwords are
fast SHA-256 (F-03), the server does no meaningful work per attempt either, so it will happily service
thousands per second. With `admin@gstplatform.in` published as a valid username (F-02), the target is
already chosen. Unthrottled `/register` separately allows automated account creation, each provisioning
a business row and a 30-day trial.

**Fix.**

```ts
import rateLimit from "express-rate-limit";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  skipSuccessfulRequests: true,
});

router.post("/login", authLimiter, handler);
router.post("/register", authLimiter, handler);
```

- Add a **per-account** counter alongside the per-IP limit — distributed attacks rotate IPs — with
  exponential backoff and a temporary lock after ~10 failures.
- Back it with Redis or a table, not in-process memory, or it resets on every autoscale event.
- Set `app.set("trust proxy", 1)` so the limiter reads the real client IP behind the Replit router.
- Log failed attempts with account and source IP; alert on bursts.

## F-07 — Revoking access does nothing for seven days

**CWE-613** · `auth.ts:15-17, 27-43, 112-114`

```ts
jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "7d" });
…
req.userRole = payload.role;      // seven-day-old claim, trusted as current

export function requireAdmin(req, res, next) {
  if (req.userRole !== "admin") return res.status(403)…   // reads the token
}
```

The `isActive` subscription gate is checked **only** at login (`auth.ts:54`), and
`POST /api/auth/logout` is a stub returning `{ success: true }` without touching any state.

**Why it matters.**

- **Demotion does not demote.** An admin stripped of the role keeps every admin route for up to a week.
- **Deactivation does not deactivate.** An account switched off for non-payment keeps full API access.
  For a subscription business this is straightforward revenue leakage: the "Plan Expired" message is a
  login-screen decoration, not an entitlement check.
- **Logout does not log out.** A token captured from a shared machine, a proxy log or a browser
  extension stays valid regardless.
- No way to revoke a single compromised token short of rotating the global secret.

**Fix.** Two options, increasing effort:

- **Re-read the user on each request.** `requireAuth` already has `userId`; load the row and derive
  `role` and `isActive` from the database, rejecting inactive accounts. Nearly every handler already
  calls `getBusinessId(req.userId)` — the same lookup — so fold them into one query and this costs
  nothing.
- **Short access tokens plus refresh.** A 15-minute access token with a rotating, revocable refresh
  token stored server-side, plus a `tokenVersion` column bumped on logout, password change and
  deactivation.

Also add an explicit `subscriptionEnd` check to the request path.

## F-08 — CORS is wide open to every origin

**CWE-942** · `app.ts:28`

```ts
app.use(cors());   // Access-Control-Allow-Origin: *  — every origin, every route
```

Because the client sends a bearer header rather than a cookie, this is not classic drive-by CSRF. But:

- Any website can call the API directly and read the response, so a malicious page that obtains a
  token by any means can immediately drive the full API from the victim's browser.
- **The wildcard blocks the fix for F-09.** Moving the token into an `HttpOnly` cookie requires
  `credentials: true`, which browsers refuse to combine with `*`. This line must change first.
- It advertises the API as freely callable to any scanner that looks.

**Fix.**

```ts
const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
if (allowed.length === 0) throw new Error("ALLOWED_ORIGINS must be set.");

app.use(cors({ origin: allowed, credentials: true, methods: ["GET","POST","PATCH","DELETE"], maxAge: 86400 }));
```

Never reflect `req.headers.origin` back — that is a wildcard with extra steps.

## F-09 — Session token sits in localStorage behind no security headers

**CWE-522 / CWE-693** · `context/AuthContext.tsx:17,23,45`, `app.ts`

```ts
const [token, setToken] = useState(() => localStorage.getItem("gst_token"));
setAuthTokenGetter(() => localStorage.getItem("gst_token"));
```

The seven-day token is readable by any JavaScript on the origin. The server sends no
`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` or
`Referrer-Policy` — `helmet` is not a dependency. `lib/api-client-react/src/custom-fetch.ts:40` carries
a comment warning that the token-getter mechanism "should never be used in web applications"; the web
app uses it anyway.

**Why it matters.** These gaps multiply. React escapes interpolated content by default, so there is no
XSS today. But with no CSP, one compromised npm package, one future `dangerouslySetInnerHTML`, or one
reflected value is enough to read the token — and because it cannot be revoked (F-07), the attacker
holds durable access for a week. With no `X-Frame-Options` the app is clickjackable; with no HSTS a
first request over HTTP can be intercepted.

**Fix.**

```ts
import helmet from "helmet";

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"],
      connectSrc: ["'self'", process.env.API_ORIGIN],
      objectSrc: ["'none'"], frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));
```

Then move the token out of reach of scripts: issue it as an `HttpOnly; Secure; SameSite=Strict` cookie
(`cookie-parser` is already installed and unused), pair it with a CSRF token, and drop the
`setAuthTokenGetter` path from the web client — leaving it for the native clients it was written for.

---

# Medium

## F-10 — Unhandled errors return a stack trace to the caller

**CWE-209** · `app.ts`, `.replit [deployment]`

`app.ts` registers logging, CORS, body parsers and the router — then stops. No error-handling
middleware, so every rejected promise falls through to Express's default handler, which includes
`err.stack` in the response whenever `NODE_ENV !== "production"`. The `.replit` deployment config never
sets `NODE_ENV`.

Combined with F-04, an attacker triggers errors on demand and reads back absolute file paths, the
bundled source layout, dependency versions and SQL/schema fragments.

**Fix.**

```ts
app.use((err, req, res, _next) => {
  req.log.error({ err }, "Unhandled error");
  res.status(err.status ?? 500).json({ error: "Internal server error" });
});
```

Set `NODE_ENV=production` in the deployment environment as a second line of defence — `lib/logger.ts:3`
also branches on it, so production is currently running the pretty-printing dev transport too.

## F-11 — Pagination is advisory and several endpoints read whole tables

**CWE-770** · `customers.ts:20`, `invoices.ts:94`, `reports.ts:144,158`, `admin.ts:18,60`, `dashboard.ts:17-21`

```ts
.limit(parseInt(limit)).offset((parseInt(page) - 1) * parseInt(limit))
```

No ceiling, no type check. Separately, `GET /api/reports/sales` and `/purchases` return every matching
invoice with full line items; `/api/dashboard/stats` pulls five entire tables into memory to compute
six numbers; `/api/admin/users` loads every user then filters and paginates in JavaScript.

`?limit=100000000` asks Postgres for the entire table and serialises it to JSON. `?limit=abc` yields
`NaN` and `?page=0` a negative offset, both producing driver errors that F-10 renders as stack traces.

**Fix.**

```ts
const Pagination = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

Apply as query-validation middleware everywhere. Push filtering, counting and paging for the admin
lists into SQL. Give report endpoints a date-range cap or cursor pagination. Add a request timeout and
a statement timeout on the pool.

## F-12 — A one-character password is accepted

**CWE-521** · `auth.ts:68-75`, `users.ts:103-108`, `pages/register.tsx:63`

Registration checks only presence. The signup form's placeholder reads "Min 8 characters" but the input
has no `minLength`, and the server never checks length, composition or breach status. The admin
reset-password endpoint is the same.

**Fix.**

```ts
const Password = z.string()
  .min(12, "Use at least 12 characters")
  .max(128)
  .refine(pw => !COMMON_PASSWORDS.has(pw.toLowerCase()),
          "This password appears in known breach lists");
```

Follow NIST 800-63B: favour length over composition rules, screen against a breach list (the
k-anonymity range API from Have I Been Pwned works without sending the password), drop forced rotation.
Add a self-service password-change endpoint — there currently is none, so the only way a user changes a
password is to ask an admin to reset it.

## F-13 — Admin actions are unlogged, unconfirmed and irreversible

**CWE-778 / CWE-266** · `users.ts:91-108`, `admin.ts:101-111`

Any admin can reset any user's password, promote any account to admin, or hard-delete a user — with no
audit record, no re-authentication, no notification, and no guard against acting on their own account.

- A compromised admin session (trivial today via F-01 or F-02) can reset a tenant owner's password,
  sign in as them and read their books, with nothing tying the action to an actor.
- `DELETE /users/:id` removes the user row only. `businesses`, `invoices`, `customers` and `products`
  rows survive with a dangling `businessId` — orphaned tax records nobody can reach or delete. For
  records Indian GST rules require be retained and produced on demand, an accidental click is
  unrecoverable.
- No self-lockout guard: an admin can demote or delete the last remaining admin.

**Fix.**

- Append-only `audit_log` table — actor, action, target, timestamp, source IP, before/after — written
  from every admin mutation.
- Require password re-entry (step-up auth) for password resets and role changes; email the affected
  user when either happens.
- Replace hard delete with soft delete (`deletedAt`), which `products.ts:78` already models. If hard
  delete is genuinely needed, add `ON DELETE` constraints so the cascade is explicit.
- Refuse any change that removes the last admin or targets the caller's own role.

## F-14 — Registration confirms which email addresses have accounts

**CWE-204 / CWE-208** · `auth.ts:75`, `auth.ts:52`

```ts
if (existing.length > 0) return res.status(400).json({ error: "Email already registered" });
…
if (user.passwordHash !== hashPassword(password))   // non-constant-time compare
```

The registration response is a free oracle: submit an address, learn whether it has an account. With no
rate limit (F-06) an attacker enumerates a customer list in bulk before ever attempting a password.

The `!==` comparison is a separate, smaller issue: JavaScript string comparison short-circuits on the
first differing byte. It matters little here because the compared value is a hash of an unknown input,
but the correct primitive costs nothing.

The login path is otherwise well-behaved — the same generic 401 for unknown user and wrong password,
and the `isActive` check placed *after* the password check so "Plan Expired" cannot confirm an account.

**Fix.**

- Return the same `202 Accepted` from `/register` whether or not the address is taken; resolve out of
  band with a verification email to a new address, or a "someone tried to register with your address"
  email to an existing one. This also gives you email verification, which the flow lacks entirely.
- Use `crypto.timingSafeEqual` on equal-length buffers — or adopt `argon2.verify` / `bcrypt.compare`
  from F-03, which are constant-time by construction.
- Add a dummy hash computation on the unknown-user path so latency does not distinguish "no such user"
  from "wrong password."

---

# Low

| ID | Finding | Location | Fix |
| --- | --- | --- | --- |
| L-01 | **No `.env` rule in `.gitignore`** — nothing stops the next developer committing a real `DATABASE_URL` or `SESSION_SECRET`. No secrets are committed today. | `.gitignore` | Add `.env*` (with `!.env.example`); run `gitleaks` pre-commit and in CI. |
| L-02 | **E-way bill `invoiceId` is not tenant-scoped** — a bill can reference another business's invoice. No data crosses the boundary today, but it plants a broken reference a future join would resolve. | `eway-bills.ts:69` | Verify the invoice belongs to `businessId` before storing; add a composite foreign key. |
| L-03 | **The API contract declares no authentication.** `openapi.yaml` has no `securitySchemes`, so generated clients and any consumer reading the spec see every endpoint as public. | `lib/api-spec/openapi.yaml` | Declare a `bearerAuth` scheme and apply `security` per operation. |
| L-04 | **No dependency scanning.** No `pnpm audit` step, no Dependabot. The `minimumReleaseAge: 1440` setting in `pnpm-workspace.yaml` is a genuinely good supply-chain control — it just has nothing checking for known CVEs alongside it. | CI | Add `pnpm audit --audit-level=high` to the build; enable automated dependency updates. |
| L-05 | **Unused `cookie-parser` dependency**, and a silent `catch {}` in `verifyToken` swallowing the difference between an expired token and a misconfigured secret. | `package.json`, `auth.ts:22` | Drop the dependency until F-09 needs it; log `JsonWebTokenError` distinctly from `TokenExpiredError`. |

---

# Beyond security — code review

The workspace layout is genuinely good: contract-first OpenAPI, generated typed hooks, a clean Drizzle
schema, one shared UI kit. These are the issues that will cost real money or real correctness.

> **The highest-value non-security fix is invoice numbering.** It is a correctness bug with statutory
> consequences, cheap to fix now and expensive to fix after the first filing season.

| Area | Issue | Recommendation |
| --- | --- | --- |
| **Invoice numbering**<br>`invoices.ts:73-80` | Numbers derive from `COUNT(*) + 1`. Two concurrent invoices get the same number; a deleted invoice causes the next to reuse a number. Indian GST law requires a unique, unbroken, sequential series per financial year — and the code uses the calendar year, not April–March. | Use a per-business Postgres sequence or a `SELECT … FOR UPDATE` counter row inside the insert transaction. Switch to financial-year numbering. Never reuse a number: cancel invoices rather than deleting them. |
| **Transactions**<br>`invoices.ts:130-157`, `purchases.ts:131-166` | Creating an invoice inserts the row, then deducts stock in a loop of separate statements. A failure midway leaves an invoice recorded against stock never decremented. Purchase creation likewise mutates the product catalog outside any transaction. | Wrap each multi-write handler in `db.transaction(async (tx) => { … })`. Drizzle supports this directly. |
| **Money in floats**<br>`invoices.ts:13-55`, `reports.ts` | Amounts are stored as numeric but pulled through `parseFloat` for every calculation, then rounded per line. Binary floating point cannot represent decimal currency exactly, so GSTR-1 and GSTR-3B totals will drift by paise against the sum of their line items. | Compute in integer paise, or use a decimal library, and round once at presentation. Add a property test asserting line items sum exactly to the invoice total. |
| **No tests** | Zero test files across ~19,700 lines; no test runner in any `package.json`. Every finding in this report would be caught and kept fixed by a modest suite. | Start with three: an auth suite (forged token rejected, expired token rejected, inactive user rejected), a tenant-isolation suite over every `:id` route, and a GST calculation suite. Wire into CI. |
| **`req: any` throughout** | Every authenticated handler is typed `(req: any, res)`, so `req.userId` and `req.userRole` are unchecked. TypeScript is switched off precisely where the security-relevant state lives. | Declare an `AuthedRequest` interface (or augment `Express.Request`) and type the handlers. The compiler then catches a handler that forgets the tenant filter. |
| **Duplication** | `getBusinessId` is copy-pasted into eight routers, `hashPassword` into two, `mapUser` into two, `mapInvoice` into two with slightly different bodies. `/api/users` and `/api/admin/users` are two overlapping admin surfaces with divergent behaviour. | Extract shared helpers into `src/lib/`. Duplication is how F-03 needs a fix in two places and F-05 ended up correct in forty places but not four. |
| **Query efficiency** | `getBusinessId` issues a separate `SELECT` on every authenticated request, after `requireAuth` has already decoded the same user. `/dashboard/monthly-revenue` runs twelve sequential queries in a loop. | Resolve the user once in `requireAuth` and attach it to the request — this also implements F-07's fix. Collapse the monthly loop into one grouped aggregate query. |

---

# Remediation plan

Ordered by what each phase makes safe, not by effort. The gates are cumulative — nothing in a later
phase substitutes for an earlier one.

### Phase 1 — before the app is reachable from the internet

- **F-01** — remove the fallback secret, fail closed at boot, generate and rotate `SESSION_SECRET`.
- **F-02** — delete the admin demo button, rotate both demo passwords, scrub `replit.md`.
- **F-03** — switch to Argon2id with transparent re-hash on login.
- **F-10** — add the error handler and set `NODE_ENV=production`.

*Roughly one focused day. Until all four land, assume any deployed instance is fully compromised.*

### Phase 2 — before a second tenant's data is on the platform

- **F-05** — scope the four customer/vendor lookups, then add the cross-tenant integration test.
- **F-04** — wire the existing `@workspace/api-zod` schemas in as validation middleware on every route.
- **F-07** — re-read the user per request; enforce `isActive` and `subscriptionEnd` continuously.
- **F-06** — rate-limit the auth endpoints, per IP and per account.
- **F-11** — cap `limit`, paginate the report and admin endpoints.

*Roughly a week. This is where tenant isolation stops being a convention and becomes a guarantee.*

### Phase 3 — before general availability

- **F-08 · F-09** — origin allowlist, then `helmet` with a CSP and the token moved to an `HttpOnly`
  cookie with CSRF protection.
- **F-12 · F-14** — password policy with breach screening, email verification, non-enumerable
  registration, self-service password change.
- **F-13** — audit log, step-up auth for admin actions, soft delete, last-admin guard.
- **L-01 … L-05** — secret scanning, dependency audit in CI, security schemes in the OpenAPI spec.
- Invoice numbering, transactions, and the three starter test suites.

*Roughly two to three weeks. Book an external penetration test at the end of it, not before.*

### Ongoing

- Multi-factor authentication for all admin accounts.
- Postgres row-level security as the durable answer to F-05.
- A data-retention and backup policy matching GST record-keeping obligations, with restores tested.
- Alerting on failed-login bursts, admin actions, and 5xx rates.
