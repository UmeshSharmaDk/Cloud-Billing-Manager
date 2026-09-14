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

## Status — all three phases complete

All three phases of the remediation plan are implemented on branch
`claude/security-threats-review-gq7rhu`. **Eighteen of the nineteen findings are fixed and
verified** — 133 integration checks against a real Postgres plus 34 unit tests, both running in CI. The nineteenth
(F-14's account-enumeration half) is partly done and cannot be finished in code alone; see below.

| ID | Status | Verification |
| --- | --- | --- |
| F-01 | **Fixed** | Server refuses to boot without a ≥32-char `SESSION_SECRET`; a token forged with the old hardcoded secret now returns `401`; the string is absent from the built bundle. |
| F-02 | **Fixed** | Demo credential block removed from the login page and `replit.md`; absent from the production frontend bundle. **Operator action still required — see below.** |
| F-03 | **Fixed** | Argon2id (19 MiB, t=2, p=1) with a per-password salt; legacy SHA-256 hashes verify once and are re-hashed on the spot. 18/18 behavioural checks pass. |
| F-10 | **Fixed** | Terminal error handler returns `{error, requestId}` and nothing else; full detail is logged server-side under the same id. Logger now treats an unset `NODE_ENV` as production. |
| F-04 | **Fixed** | Zod validation on every route. Type-confused login, negative quantity, 900% GST rate, malformed date and non-numeric `:id` all return `400`; unknown body keys are stripped rather than written. |
| F-05 | **Fixed** | The four unscoped lookups now filter by `businessId` and return `400` instead of silently falling back. A two-tenant suite proves every `:id` route is `404` across the boundary and that no cross-tenant name or GSTIN appears in any response. |
| F-06 | **Fixed** | Per-IP limiter plus a per-account lockout held in Postgres, so it survives restarts and spans autoscale instances. Locks after 11 failures with exponential backoff, and holds even against the correct password. |
| F-07 | **Fixed** | `requireAuth` loads the user row on every request. Promotion, demotion, deactivation and subscription expiry all take effect immediately — previously up to seven days. |
| F-11 | **Fixed** (caps) | `?limit=100000000`, `?limit=abc` and `?page=0` are `400`; report spans are capped at 366 days and default to the current month; the admin user lists filter, count and page in SQL. |
| L-02 | **Fixed** | E-way bills can no longer reference another tenant's invoice. |
| F-08 | **Fixed** | `cors()` replaced by an explicit origin allowlist that fails the boot if unset and rejects `*`. An unknown origin gets no `Access-Control-Allow-Origin` header at all. |
| F-09 | **Fixed** | The session is an `HttpOnly` cookie; no token is reachable from page script anywhere in the app. Double-submit CSRF on every cookie-authenticated write. Helmet adds a `default-src 'none'` CSP, HSTS, nosniff and `X-Frame-Options: DENY`. Logout is no longer a stub. |
| F-12 | **Fixed** | 12-character minimum, common-password screening, and a Have I Been Pwned k-anonymity lookup that fails open. New self-service `POST /auth/change-password`. |
| F-13 | **Fixed** | Append-only `audit_log`; step-up re-authentication for password resets and role changes; soft delete so tenant records are never orphaned; last-admin and self-action guards. |
| F-14 | **Partly fixed** | The timing half closed in Phase 1. Registration still confirms a known address — closing that needs email delivery this product has no provider for. Enumeration now charges the account lockout, so bulk probing hits the same backoff as password guessing. |
| L-01 | **Fixed** | `.env*` ignored, `.env.example` added, gitleaks in CI. |
| L-03 | **Fixed** | `securitySchemes` declared (cookie + bearer), applied globally, with the three genuinely public operations marked `security: []`. |
| L-04 | **Fixed** | `.github/workflows/security.yml`: `pnpm audit`, gitleaks, typecheck, and a grep that rejects the exact `process.env.X ?? "literal"` shape that caused F-01. |
| L-05 | **Fixed** | `cookie-parser` is now load-bearing rather than dead; `verifyToken` distinguishes an expired token from a malformed one. |
| Code review | **Fixed** | Invoice numbering (financial-year series, atomic allocation, never reused, unique at the database level) and transactional invoice/purchase writes. |

### Phase 2 notes

**The generated schemas could not be used, and that is a finding in itself.** The plan assumed
attaching `@workspace/api-zod` to each route would be mechanical. It is not: the OpenAPI spec has
drifted behind the implementation, and enforcing it would have rejected requests the app makes
today — `CreateInvoiceBody` requires `customerId` (walk-in invoices have none), invoice and purchase
line items are specified as `productName`/`rate` but sent as `description`/`unitPrice`,
`CreatePurchaseBody` requires `invoiceNumber`/`invoiceDate` where the client sends
`billNumber`/`billDate`, and e-way bills, the admin routes and the HSN report are absent from the
spec entirely. The schemas in `artifacts/api-server/src/schemas/index.ts` are therefore written
against the routes as they actually behave. This raises the priority of L-03 (reconcile the spec):
until it is done, the spec is documentation, not a contract.

**GST rate is bounded at 0–28 rather than enumerated.** The plan proposed an enum of the statutory
slabs. Special rates (0.1, 1.5, 6, 7.5) exist alongside the headline ones, and rejecting a valid rate
blocks a real invoice, which is worse operationally than accepting an unusual one. The bound is what
defeats the attack — a 900% rate no longer reaches a GSTR-1 filing.

**Validated query values live on `req.validatedQuery`, not `req.query`.** Express 5 defines
`req.query` as a getter with no setter, so the usual overwrite-in-place pattern throws in strict mode.

**Two adjacent fixes came along.** L-02 (e-way bills referencing another tenant's invoice) is the same
bug class as F-05 and was fixed with it. Separately, list endpoints reported an unfiltered `total`
alongside a filtered page, so the UI computed the wrong page count whenever a search was active; that
is corrected in all seven list routes.

**What F-11 does not cover.** `/dashboard/stats` and `/admin/stats` still compute their aggregates by
reading whole tables into memory. That is a scaling cost, not a live vulnerability, and rewriting
financial aggregations without tests covering them is a worse risk than leaving them slow. They remain
open.

### Found while implementing Phase 2

**A business with no state code issues IGST on local sales.** `invoices.ts` decides interstate by
comparing `placeOfSupply` against the business's `stateCode`. Registration never sets a state code, so
until an owner fills it in on the settings page, every invoice compares against `""`, is treated as
interstate, and is charged IGST instead of CGST+SGST. The totals are right; the split is wrong, and a
wrong split is a wrong GST return. Not a security issue and not in any phase — but it should be fixed
before the next filing, either by requiring the state code at registration or by refusing to issue an
invoice while it is unset.

### Clearing the remaining backlog

**F-11 is now fully closed.** `/dashboard/stats`, `/dashboard/gst-summary`, `/dashboard/low-stock`
and `/admin/stats` computed their figures by reading whole tables into memory and filtering arrays;
`/dashboard/monthly-revenue` issued twelve sequential queries, one per month per table. All are SQL
aggregates now — two queries for the six-month series, `count(*) FILTER (...)` for the tallies. The
rewrite was done test-first: the expected figures were pinned against independently computed
expectations on seeded data *before* the change, and the SQL reproduces them exactly.

**Bearer tokens can now be revoked.** A `tokenVersion` column on `users` is embedded in each token
and checked on every request. Changing a password, an administrator resetting one, and deleting an
account all bump it, so sessions held elsewhere die immediately rather than outliving the change by
up to seven days. New `POST /auth/logout-all` revokes every session deliberately, with a
**Sign out everywhere** control on the Settings → Security tab. Ordinary logout still ends only the
calling device's session, which is what people expect. Tokens issued before the column existed carry
no version and are treated as generation 0, so the upgrade does not sign everyone out.

**The OpenAPI spec is a contract again.** The drift described above is fixed: walk-in invoices,
`description`/`unitPrice` line items and `billNumber`/`billDate` purchases are all described
correctly, with the old field names kept as deprecated aliases; `/auth/logout-all`, the admin user
routes and the e-way bill routes are no longer missing. `test/spec-contract.test.mjs` validates the
*generated* schemas against the payloads the frontend actually posts, so the next drift fails a test
rather than being discovered by whoever tries to use them. `src/schemas/index.ts` stays hand-written,
but for a better reason now: it carries bounds a contract cannot express — a GST rate capped at 28,
money stopping short of what `numeric(15, 2)` holds, text lengths matched to their columns.

**`req: any` is gone from the handlers.** New `lib/http.ts` types an authenticated request and a
tenant-scoped one; 57 handlers use them. This is load-bearing, not decoration — a misspelled
`req.buisnessId` and a read of a non-existent column on `req.user` are both compile errors now,
verified by deliberately introducing each. The three middleware that *attach* those properties keep
a loose signature, because they are what creates the shape.

**Duplication:** `mapUser` moved to `lib/serialise.ts`, and `GET /api/users/admin/stats` — a second,
subtly different copy of `/api/admin/stats` that counted deleted users and tallied administrators
inconsistently — is deleted. One admin surface.

### What is left, and why it is not code

- **F-14's enumeration half** needs an email provider. Nothing about it is a coding problem.
- **MFA for administrators** is a product feature — enrolment, QR provisioning, recovery codes, and
  a policy for what happens when someone loses their authenticator. Shipping it badly is worse than
  not shipping it, so it wants its own decision rather than a corner of a cleanup sweep.
- **An external penetration test** remains the one step no amount of self-review substitutes for.

## Row-level security — done

F-05 was four query sites, out of roughly forty, that resolved a record by its primary key without a
tenant filter. All four were fixed, and the fix is a discipline: every future query site has to
remember. Code review already failed to catch these four once.

The policies are the thing that does not have to remember. Every tenant table now carries
`ENABLE`/`FORCE ROW LEVEL SECURITY` and a policy matching `app.business_id`, set per request with
`SET LOCAL`. With no tenant set the policies match *nothing* — a path that escapes the scope returns
an empty page rather than another tenant's ledger.

### Three ways this fails silently, and what was done about each

Each of these was reproduced against a real Postgres before any code was written, because all three
produce a system that looks protected.

**A superuser ignores RLS entirely, even with FORCE.** Hosted Postgres hands out an admin connection
string by default, so the natural setup has policies installed and no protection at all. This is the
worst failure mode available: it is indistinguishable from success. The API server now checks its own
role at boot and logs a warning naming it; `rls:apply` prints the same; and the enforcement test
below *refuses to run* rather than passing vacuously.

**A query outside the scope would silently see nothing.** Pinning the tenant needs the `set_config`
and the query on the same connection, which with a pool means a transaction. Threading a handle
through a hundred call sites is exactly the kind of change that gets forgotten once, so the exported
`db` is a proxy: inside a scope it forwards to that scope's transaction, outside one it is the
ordinary pool. No call site opts in, so none can forget.

**A pooled connection could carry one request's tenant into the next.** `set_config(..., true)` is
`SET LOCAL`, scoped to the transaction. Asserted directly: after `COMMIT` and after `ROLLBACK`, the
same connection sees nothing.

### Two scopes, and the cost

`requireBusiness` opens a tenant scope. Two places legitimately span tenants and say so explicitly
via `systemScope` — the platform admin dashboards, and authentication and registration, which run
before a tenant is known. Anything reached that way is trusting its own authorization checks with no
database-level net underneath, which is why it is applied per-router rather than being the default.

The cost is honest: **one transaction is held open per request**, from `requireBusiness` until the
response is written. It commits on the way out, or rolls back if the handler produced a 5xx. On a
connection-constrained deployment this changes pool sizing, and a slow handler now holds a connection
for its whole duration rather than per query. That is the price of the guarantee; it should be
watched under load.

### Verified

A passing application suite proves nothing here — every request it makes is one the application is
*entitled* to make, so it would pass just as happily with the policies switched off. So there are two
suites, both run in CI against a `NOSUPERUSER NOBYPASSRLS` role:

| Suite | Asserts |
| --- | --- |
| `test:integration` (133 checks) | the application still works with policies enforced |
| `test:rls` (17 checks) | what the database *refuses* |

The second is the one that matters: unscoped reads return zero rows on every tenant table; a scoped
connection sees its own rows and no other, including when another tenant's id is named directly;
an unfiltered lookup by primary key — the exact shape of F-05 — returns nothing; cross-tenant
`INSERT` is refused by `WITH CHECK` and a cross-tenant `UPDATE` cannot walk a row across the
boundary; and the scope does not outlive its transaction.

**Operators must create the dedicated role** (`lib/db/README-rls.md`). Until `DATABASE_URL` points at
a role that cannot bypass, tenant isolation still rests entirely on the application's query filters —
and the boot log will say so.

### Money in floats — fixed

The drift was real and reproducible. Three lines of 33.333 on one invoice:

```
stored line taxableAmounts : 33.33 + 33.33 + 33.33 = 99.99
invoice subtotal           : 100.00
DRIFT                      : 0.01
```

The float representation error was the smaller half. The structural error was that each line was
rounded to paise for storage while the invoice totals accumulated the **unrounded** values — so the
lines never added up to the total, by construction. On a GSTR-1 return both are filed and both are
expected to reconcile.

The rule is now: **round at the line, then sum the rounded values**, so a total is the exact sum of
its parts. `artifacts/api-server/src/lib/money.ts` wraps `decimal.js` with the handful of operations
this domain needs; `parseFloat` no longer appears anywhere in the API server. Two details worth
naming:

- **CGST and SGST are split, not computed twice.** Rounding each half independently could leave
  `cgst + sgst` a paisa away from the tax actually charged. One half is rounded and the other is the
  remainder, so they always reconstruct the total.
- **Values reach Postgres as decimal text**, not as a float rendered to a string, so nothing passes
  through a binary float on the way into a `numeric` column.

Verified: the same invoice now reports a subtotal of 99.99 — the honest figure — and reconciles.
A property test over 500 generated invoices (fractional quantities, discounts, every GST slab,
intra- and inter-state) asserts that lines sum exactly to the subtotal, to each tax component, and
that grand total less round-off reconstructs the payable amount; 2,000 generated splits confirm
CGST + SGST never loses or invents a paisa. The suite also records that the old float implementation
*fails* the same invariant, so the regression cannot quietly return. End to end, GSTR-1's taxable
value, tax components and rate-wise breakdown all reconcile against the invoices they are built from.

### The wrong tax on the invoice — fixed

Found while adding the row-level security tests, and worse than the float drift because the
arithmetic was never wrong — the *tax head* was. Charging IGST where CGST + SGST is due produces an
invoice whose total is correct to the paisa, so nothing on the document looks off. It surfaces at
filing: the customer claims input credit under a head they are not entitled to, GSTR-1 and GSTR-3B
disagree with the counterparty's return, and unwinding it needs a credit note and a revised return.

The supply type was decided like this:

```ts
const bizStateCode = business?.stateCode ?? "";
const isInterstate = placeOfSupply ? placeOfSupply.trim() !== bizStateCode.trim() : false;
```

`businesses.state_code` is nullable and **registration never sets it**, so every business started
with `null`, and `null ?? ""` compares unequal to every real state code. The result was IGST on every
invoice that named a place of supply — including purely local sales — for every business that had not
found and filled in the field by hand. Nothing prompted them to.

Against five realistic cases, the old expression charged the wrong tax on three:

| Case | Correct | Old behaviour |
| --- | --- | --- |
| Freshly registered business, local sale in 29 | CGST + SGST | **IGST** |
| GSTIN registered in 27, no state code, local sale in 27 | CGST + SGST | **IGST** |
| State code `07`, place of supply `7` | CGST + SGST | **IGST** |
| State code 29, genuine inter-state sale to 27 | IGST | IGST |
| State code 29, local sale in 29 | CGST + SGST | CGST + SGST |

`lib/gst.ts` now resolves it in three steps. The seller's state comes from `state_code` when set;
otherwise from the **GSTIN**, whose first two characters *are* the state of registration — that is
authoritative rather than a guess, and it settles the common case, since a GST product's businesses
nearly all have a GSTIN even when they never filled in the separate field. Codes are normalised
before comparison, so `7` and `07` are one state. And when neither source yields a state, it
**refuses the invoice** with a message naming the fix, rather than guessing: either guess writes a
legally wrong document that the total does not reveal, and the same "fail loudly rather than silently
fall back" already applies to the cross-tenant lookups.

Two further problems in the update path, found while fixing the first:

- **`isInterstate` was read from the request body.** A client could assert the tax head directly,
  producing an invoice that totals correctly and credits the wrong tax. It is now derived server-side
  and the body value ignored.
- **Editing any line silently re-taxed the invoice.** `calcGst(items, isInterstate ?? false)` meant a
  legitimate inter-state invoice became CGST + SGST the moment someone edited a quantity without
  resending the flag. Conversely, changing the place of supply *without* resending items left the old
  split in place, because totals were only recomputed when items were present. Both now follow the
  derived supply type, and a change of supply type re-prices the stored lines.

Covered by 38 unit checks and 8 integration checks, including the regression itself and the
client-asserted flag.

**Still open, and deliberately not widened into here:** `purchases.ts` calls
`calcPurchaseTotals(items)` and never passes `isInterstate`, so every recorded purchase is split as
CGST + SGST. An inter-state purchase therefore books input credit under the wrong head — the same
class of bug on the buy side. Purchases carry no place-of-supply field at all, so fixing it is a
schema and API change rather than a corrected expression, and it wants its own change.

### Two ways the server could be killed from outside — fixed

Both found by stopping Postgres underneath a running server while testing the row-level security
work. Neither is exploitable as a privilege escalation; both are availability, and both were a single
event away from taking the whole process down.

**An idle connection error crashed the process.** `pg.Pool` emits `error` for a connection sitting
idle in the pool when the database goes away — a restart, a failover, `pg_terminate_backend`, a
firewall dropping an idle socket. That is an EventEmitter `error` event, and with no listener attached
Node treats it as unhandled and terminates. No listener was attached. A routine database restart took
the API server down with it, and whichever request happened to be in flight was never the cause. The
pool already discards the broken connection and reconnects on the next query, so the fix is to
observe the event and say what happened.

**The tenant scope could reject with nobody listening.** The middleware held a promise that rejected
on a 5xx, to roll the request's transaction back. On the normal path the scope callback awaits it, so
the rejection is handled. But when `transaction()` fails *before* running its callback — the database
was already unreachable — the callback never runs, nothing awaits that promise, and it rejects alone
when the error handler writes its 500. Unhandled rejection, process gone. So a database blip during a
request killed the server rather than returning a 500. It now resolves with a boolean and the
rollback is thrown at the await site, which cannot produce an unobserved rejection.

Verified by killing Postgres in both orders — while connections sat idle, and with a request arriving
after it was already down. The server logs, returns `500`, and keeps serving. Before the fixes each
case terminated the process.

### Follow-up after Phase 3

**A regression Phase 3 introduced, now fixed.** Step-up confirmation was gated on the `role` field
being *present* in the body rather than on the role actually changing. The admin edit form posts the
whole record, unchanged role included, so every save from the user-detail page returned `403` — a
subscription edit was being refused for want of a password confirmation the UI never asked for. The
check now compares against the stored role, and the form sends only what changed. Two integration
checks pin it: an unchanged role does not demand a password, and the edit alongside it still applies.

**The rest of that family.** Phase 3 shipped backend contracts without the UI to match:
a confirm-password dialog for genuine role changes, a Security tab on Settings for the new
self-service `POST /auth/change-password`, and register copy that said "Min 8 characters" while the
server required 12. All three are done. `/auth/change-password` is now in the OpenAPI spec too, so it
has a generated hook rather than a hand-rolled fetch — a small step against the drift described
above, not a fix for it.

**The suites now run in CI.** They previously existed but nothing ran them: the workflow did audit,
secret scan and typecheck only, because there was no database. `.github/workflows/security.yml` gains
an `integration` job with a Postgres service container that pushes the schema, builds and starts the
API, and runs all 95 checks; the unit suite joins the typecheck job. Verified by replicating the job
steps against a freshly created database — 95/95 from a clean slate, and the suite is idempotent
across repeated runs.

### Phase 3 notes

**F-14 is the one finding I could not close, and I did not pretend otherwise.** Making registration
non-enumerable means not telling the caller whether the address is taken — which means not signing
them in either, which means the confirmation has to arrive by email. This codebase has no email
provider and inventing one would have meant shipping a signup flow that nobody can complete. What
landed instead: a failed registration against an existing address now increments the same lockout
counters as a failed login, so bulk enumeration runs into exponential backoff. Closing it properly
is a product decision (choose a mail provider, add verification) rather than a code change.

**The HIBP lookup could not be exercised here.** This sandbox's egress proxy does not reach
`api.pwnedpasswords.com`, so the live call fails open exactly as designed — which is also why it
proves nothing. The decision logic is covered by 10 unit tests instead
(`test/password-policy.test.ts`), including that only the five-character hash prefix ever leaves the
process, that a padding row is not read as a hit, and that a network failure fails open rather than
locking users out of registration.

**The durable lockout is per-account, not per-address.** The first implementation counted failures
against the IP as well, at the same threshold, which meant ten typos from one office locked out
everyone behind that NAT — and an attacker rotating addresses walks around it anyway. Addresses are
now the in-memory limiter's job at a threshold three times looser, which is what the module claimed
to do all along.

**Invoice numbering changes format.** Numbers become `<prefix>-<financial year>-<0001>`, e.g.
`INV-2026-27-0001`. A business that already has invoices under the old `INV-<calendar year>-<n>`
scheme will see the series restart. That is unavoidable when moving to a statutory FY series and is
best done at an April boundary — worth telling customers before it happens.

**One judgement call worth surfacing:** `AUTH_RATE_LIMIT_MAX` exists because the integration suite
deliberately fails dozens of logins from one address and would otherwise lock itself out. The
default stays at 30 and the per-account lockout the suite actually asserts runs at its real
threshold of 10.

### Operator actions that code cannot perform

1. **Set `SESSION_SECRET`** in the deployment environment (`openssl rand -base64 48`). The server will
   not start without it — this is deliberate, but it means the variable must be set *before* the next
   deploy. Setting a new value also invalidates every token issued under the old secret, which is the
   point.
2. **Rotate the two demo passwords** in the database, and treat `admin@gstplatform.in` as compromised
   on any instance that has been publicly reachable. Removing the credentials from the page does not
   change the credentials.
3. **Set `NODE_ENV=production`** in the deployment environment. The code no longer depends on this for
   safety — the error handler never leaks and the logger now fails safe — but setting it explicitly is
   still correct, and `.replit` was left untouched rather than guessing at its deployment-env schema.
4. **Set `ALLOWED_ORIGINS`** to the exact origins the web app is served from. Like `SESSION_SECRET`,
   the server refuses to start without it, so set it *before* the next deploy.
5. **Set `COOKIE_SAME_SITE=none`** only if the app and API are served from different sites. It
   requires HTTPS. The default `lax` is correct when they share a site.
6. **Run the database migration.** Phase 3 adds `audit_log` and `invoice_counters`, `deleted_at` and
   `token_version` columns on `users`, a `deleted_at`
   column on `users`, and a unique index on `(business_id, invoice_number)`. Apply with
   `pnpm --filter @workspace/db run push`. The unique index will fail to build if duplicate invoice
   numbers already exist — if it does, that is the old `COUNT(*) + 1` bug showing up in real data,
   and those invoices need renumbering before the index can be created.

### Where the implementation deviates from the recommendations below

- **F-03 needs no schema migration.** The report proposed a `passwordAlgo` column. The stored hash is
  self-describing instead — Argon2id hashes start with `$argon2id$`, legacy ones are bare 64-char hex —
  so the algorithm is detected from the value and no column, migration or backfill is required.
- **F-14's timing half came along with F-03.** Rewriting the login path made the constant-time
  comparison and the unknown-account decoy verification free to include, so both are done. The
  enumeration half of F-14 (the `/register` response) is untouched and remains Phase 3.
- **A password length cap (1024 bytes) was added** to the three password entry points. Argon2 has no
  input limit of its own, so without a cap a multi-megabyte password is a cheap memory/CPU burn.

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

**Status: fixed in Phase 1.** Retained here as the record of what was wrong and why.

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

**Status: fixed in Phase 1** (code). Password rotation is an operator action and may still be outstanding.

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

**Status: fixed in Phase 1.** Implemented in `artifacts/api-server/src/lib/password.ts`.

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

**Status: fixed in Phase 2.** See the Phase 2 notes above: the generated schemas could not be used verbatim.

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

**Status: fixed in Phase 2**, with a two-tenant integration suite guarding it.

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

**Status: fixed in Phase 2.** Database-backed lockout, so it holds across autoscale instances.

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

**Status: fixed in Phase 2.** `requireAuth` re-reads the user row on every request.

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

**Status: fixed in Phase 3.** Explicit allowlist; the boot fails without it and rejects `*`.

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

**Status: fixed in Phase 3.** `HttpOnly` cookie plus double-submit CSRF, and helmet headers.

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

**Status: fixed in Phase 1.** Handler added in `artifacts/api-server/src/app.ts`.

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

**Status: partly fixed in Phase 2.** Caps and report bounds are in; the dashboard and admin stats aggregations still read whole tables.

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

**Status: fixed in Phase 3.** 12-character minimum, breach screening, and self-service password change.

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

**Status: fixed in Phase 3.** Audit log, step-up auth, soft delete, last-admin guard.

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

**Status: partly fixed.** The timing half closed in Phase 1; the enumeration half needs email delivery — see the Phase 3 notes.

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

### Phase 1 — before the app is reachable from the internet  ✅ done

- **F-01** — remove the fallback secret, fail closed at boot, generate and rotate `SESSION_SECRET`.
- **F-02** — delete the admin demo button, rotate both demo passwords, scrub `replit.md`.
- **F-03** — switch to Argon2id with transparent re-hash on login.
- **F-10** — add the error handler and set `NODE_ENV=production`.

*Roughly one focused day. Until all four land, assume any deployed instance is fully compromised.*

### Phase 2 — before a second tenant's data is on the platform  ✅ done

- **F-05** — scope the four customer/vendor lookups, then add the cross-tenant integration test.
- **F-04** — wire the existing `@workspace/api-zod` schemas in as validation middleware on every route.
- **F-07** — re-read the user per request; enforce `isActive` and `subscriptionEnd` continuously.
- **F-06** — rate-limit the auth endpoints, per IP and per account.
- **F-11** — cap `limit`, paginate the report and admin endpoints.

*Implemented and verified: 45 integration checks against a real Postgres, covering cross-tenant
probes, validation, lockout, live authorization and GST-calculation regressions.*

### Phase 3 — before general availability  ✅ done

- **F-08 · F-09** — origin allowlist, then `helmet` with a CSP and the token moved to an `HttpOnly`
  cookie with CSRF protection.
- **F-12 · F-14** — password policy with breach screening, email verification, non-enumerable
  registration, self-service password change.
- **F-13** — audit log, step-up auth for admin actions, soft delete, last-admin guard.
- **L-01 … L-05** — secret scanning, dependency audit in CI, security schemes in the OpenAPI spec.
- Invoice numbering, transactions, and the three starter test suites.

*Implemented and verified: 92 integration checks plus 10 unit tests. Book an external penetration
test now — that is the remaining step before general availability, and it is one no amount of
self-review substitutes for.*

### Ongoing

- Multi-factor authentication for all admin accounts.
- Inter-state purchases. `calcPurchaseTotals` never receives `isInterstate`, so every purchase is
  booked as CGST + SGST and an inter-state one claims input credit under the wrong head. Purchases
  have no place-of-supply field, so this is a schema and API change, not a corrected expression.
- A data-retention and backup policy matching GST record-keeping obligations, with restores tested.
- Alerting on failed-login bursts, admin actions, and 5xx rates.
