/**
 * Brute-force protection for the authentication endpoints.
 *
 * Two layers, doing different jobs:
 *
 *   1. A per-IP limiter held in process memory. Cheap, synchronous, and the
 *      first thing a flood from one source hits — including the flood of
 *      database writes layer 2 would otherwise perform. It resets when an
 *      instance recycles and is invisible to sibling instances, which is
 *      acceptable for what it defends.
 *
 *   2. A durable lockout held in Postgres, keyed on (source address, email).
 *      Keeping the counter in the database means it survives restarts and is
 *      shared across every instance of an autoscale deployment.
 *
 * The lockout is deliberately NOT keyed on the email alone. An email is chosen
 * by the caller, so an email-only key lets anyone lock any account — including
 * the platform administrator's — by failing a login for it, and keep it locked
 * for as long as they like. Scoping the lock to the source address means an
 * attacker can only ever lock themselves out.
 */

import rateLimit from "express-rate-limit";
import { db, loginAttemptsTable } from "@workspace/db";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

/** Failures tolerated inside the window before an account starts locking. */
const FAILURE_THRESHOLD = 10;

/** A quiet period this long resets the counter. */
const WINDOW_MS = 15 * 60 * 1000;

/** Lockout grows with each failure past the threshold, up to this ceiling. */
const MAX_LOCK_MS = 60 * 60 * 1000;

function lockDurationMs(failures: number): number {
  const over = failures - FAILURE_THRESHOLD;
  if (over < 0) return 0;
  return Math.min(60_000 * 2 ** over, MAX_LOCK_MS);
}

/**
 * Namespaced so the different kinds of subject can never collide.
 *
 * `userKey` guards actions that already require a valid session (step-up,
 * change-password). Only a caller who holds that session can charge it, so it is
 * safe to lock the account outright. A failed *login* must never charge it: the
 * caller of a login is unauthenticated, and letting them charge an account-wide
 * key hands them a way to lock the real owner out of their own settings.
 *
 * `loginKey` is what a failed login charges. It includes the source address, so
 * the lock stops that source guessing without touching anyone else's access.
 * The trade-off is that an attacker rotating through many addresses gets a fresh
 * budget per address; each guess still costs a 19 MiB Argon2 verification, the
 * password policy refuses weak and breached passwords, and the per-address
 * limiter above bounds each source.
 *
 * `registerKey` is a per-recipient mail budget and is never read by login.
 */
export const userKey = (userId: number) => `user:${userId}`;
export const loginKey = (email: string, ip: string | undefined) =>
  `login:${ip ?? "unknown"}|${email.toLowerCase().slice(0, 200)}`;
export const registerKey = (email: string) => `register:${email.toLowerCase().slice(0, 200)}`;

/**
 * Failed auth attempts tolerated from one address per window.
 *
 * Tunable because the right number depends on deployment shape — a large
 * office behind one NAT is a single address to us. Raise it deliberately, and
 * note that the per-account lockout below is the layer that actually defends a
 * targeted attack; this one is a coarse outer bound.
 */
const ipLimit = Number(process.env["AUTH_RATE_LIMIT_MAX"] ?? 30);

if (!Number.isInteger(ipLimit) || ipLimit < 1) {
  throw new Error(
    `AUTH_RATE_LIMIT_MAX must be a positive integer (got "${process.env["AUTH_RATE_LIMIT_MAX"]}").`,
  );
}

/**
 * Per-IP limiter for the auth routes. `skipSuccessfulRequests` means a working
 * login does not consume budget, so a shared office NAT is not locked out by
 * ordinary use.
 */
export const authIpLimiter: ReturnType<typeof rateLimit> = rateLimit({
  windowMs: WINDOW_MS,
  limit: ipLimit,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many attempts. Try again later." },
});

/** Registrations one address may submit per window, whatever the outcome. */
const registerIpLimit = Number(process.env["REGISTER_RATE_LIMIT_MAX"] ?? 10);

if (!Number.isInteger(registerIpLimit) || registerIpLimit < 1) {
  throw new Error(
    `REGISTER_RATE_LIMIT_MAX must be a positive integer (got "${process.env["REGISTER_RATE_LIMIT_MAX"]}").`,
  );
}

/**
 * Per-IP limiter for registration.
 *
 * Unlike `authIpLimiter` it counts *every* response. A registration that
 * succeeds still costs a breach lookup, a 19 MiB Argon2 hash, an email and a
 * database row, and the whole point of the endpoint is that success and failure
 * look identical — so skipping successes would leave it unthrottled.
 */
export const registerIpLimiter: ReturnType<typeof rateLimit> = rateLimit({
  windowMs: WINDOW_MS,
  limit: registerIpLimit,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Try again later." },
});

/** Registrations that may name one address per window, from any source. */
export const REGISTER_RECIPIENT_LIMIT = 5;

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer (got "${raw}").`);
  }
  return value;
}

/**
 * Requests one business may make per minute, split into reads and writes.
 *
 * Nothing limited an authenticated caller. A registered tenant could script
 * thousands of large writes — an e-way bill carries up to 500 free-form line
 * records — and then list them, growing storage and response size without bound.
 * The limit is per *business* rather than per address: one business is one
 * tenant however many devices or offices it uses, and a botnet cannot multiply
 * it by changing address. Writes are limited much harder than reads because
 * they are what grows the database.
 *
 * Held in process memory, so it bounds each instance rather than the fleet; it
 * is a ceiling against runaway or abusive clients, not a quota. The defaults are
 * far above what a person clicking through the app reaches.
 */
const tenantWriteLimit = positiveIntFromEnv("TENANT_WRITE_RATE_LIMIT_MAX", 300);
const tenantReadLimit = positiveIntFromEnv("TENANT_READ_RATE_LIMIT_MAX", 1200);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const isRead = (req: { method: string }) => SAFE_METHODS.has(req.method);

export const tenantApiLimiter: ReturnType<typeof rateLimit> = rateLimit({
  windowMs: 60_000,
  limit: (req) => (isRead(req) ? tenantReadLimit : tenantWriteLimit),
  keyGenerator: (req) => `${(req as any).businessId}:${isRead(req) ? "read" : "write"}`,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Slow down and try again shortly." },
});

/**
 * Whether this subject is currently locked out, and until when.
 * A read failure returns `null` — the lockout must never become an outage.
 */
export async function lockedUntil(key: string): Promise<Date | null> {
  try {
    const [row] = await db
      .select()
      .from(loginAttemptsTable)
      .where(eq(loginAttemptsTable.key, key))
      .limit(1);

    if (!row?.lockedUntil) return null;
    return row.lockedUntil.getTime() > Date.now() ? row.lockedUntil : null;
  } catch {
    return null;
  }
}

/** True if any of the given subjects is locked out. */
export async function anyLocked(keys: string[]): Promise<Date | null> {
  const results = await Promise.all(keys.map(lockedUntil));
  const active = results.filter((d): d is Date => d !== null);
  if (active.length === 0) return null;
  return active.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
}

/**
 * Add one to a subject's counter and return the row.
 *
 * The upsert resets the counter when the last failure fell outside the window,
 * so occasional typos never accumulate into a lockout.
 */
async function incrementCounter(key: string) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  const [row] = await db
    .insert(loginAttemptsTable)
    .values({ key, failures: 1, firstFailureAt: now, lockedUntil: null })
    .onConflictDoUpdate({
      target: loginAttemptsTable.key,
      set: {
        failures: sql`CASE
          WHEN ${loginAttemptsTable.firstFailureAt} < ${windowStart}
            AND (${loginAttemptsTable.lockedUntil} IS NULL
                 OR ${loginAttemptsTable.lockedUntil} < ${now})
          THEN 1
          ELSE ${loginAttemptsTable.failures} + 1
        END`,
        firstFailureAt: sql`CASE
          WHEN ${loginAttemptsTable.firstFailureAt} < ${windowStart}
            AND (${loginAttemptsTable.lockedUntil} IS NULL
                 OR ${loginAttemptsTable.lockedUntil} < ${now})
          THEN ${now}
          ELSE ${loginAttemptsTable.firstFailureAt}
        END`,
      },
    })
    .returning();

  return row;
}

/**
 * Spend one unit of a per-window budget and report whether it was within
 * `limit`. Fails open: a database error must not stop people registering.
 */
export async function consumeBudget(key: string, limit: number): Promise<boolean> {
  try {
    const row = await incrementCounter(key);
    return (row?.failures ?? 0) <= limit;
  } catch {
    return true;
  }
}

/**
 * Record a failed attempt against each subject and extend the lock if the
 * threshold has been passed.
 */
export async function recordFailures(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        const row = await incrementCounter(key);

        const lockMs = lockDurationMs(row?.failures ?? 0);
        if (lockMs > 0) {
          await db
            .update(loginAttemptsTable)
            .set({ lockedUntil: new Date(Date.now() + lockMs) })
            .where(eq(loginAttemptsTable.key, key));
        }
      } catch {
        // Never let bookkeeping turn a failed login into a 500.
      }
    }),
  );
}

/**
 * Delete counters that can no longer affect anyone.
 *
 * The key is the address the *caller* supplied, so every failed login for an
 * address that does not exist creates a row — and `clearFailures` only runs on
 * a successful login for that exact address, which by definition never happens
 * for one. A run through a stolen credential list therefore left a row per
 * address, permanently, and every later lockout lookup paid for the bloat.
 *
 * A row is safe to delete once its window has passed and it holds no live lock:
 * the same condition under which `recordFailures` would reset the counter to 1
 * anyway, so pruning changes no behaviour.
 */
export async function pruneLoginAttempts(): Promise<number> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  const deleted = await db
    .delete(loginAttemptsTable)
    .where(
      and(
        lt(loginAttemptsTable.firstFailureAt, windowStart),
        or(isNull(loginAttemptsTable.lockedUntil), lt(loginAttemptsTable.lockedUntil, now)),
      ),
    )
    .returning({ key: loginAttemptsTable.key });

  return deleted.length;
}

/** Clear counters after a successful authentication. */
export async function clearFailures(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await db.delete(loginAttemptsTable).where(eq(loginAttemptsTable.key, key));
      } catch {
        // As above: best-effort.
      }
    }),
  );
}
