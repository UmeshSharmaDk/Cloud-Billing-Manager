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
 *   2. A per-account lockout held in Postgres. This is the one that matters:
 *      the attack worth defending is credential stuffing against a known
 *      address, and that attacker rotates IPs. Keeping the counter in the
 *      database means it survives restarts and is shared across every
 *      instance of an autoscale deployment.
 */

import rateLimit from "express-rate-limit";
import { db, loginAttemptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

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
 * Namespaced so an account id and an address can never collide.
 *
 * Addresses are deliberately absent: the durable lockout is per-account only.
 * Applying an account-grade threshold to an address punishes everyone behind a
 * shared NAT for one person's ten typos, and an attacker who rotates addresses
 * walks around it anyway. Addresses are the in-memory limiter's job, at a
 * threshold three times looser.
 */
export const userKey = (userId: number) => `user:${userId}`;
export const emailKey = (email: string) => `email:${email.toLowerCase().slice(0, 200)}`;

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
 * Record a failed attempt against each subject and extend the lock if the
 * threshold has been passed.
 *
 * The upsert resets the counter when the last failure fell outside the window,
 * so occasional typos never accumulate into a lockout.
 */
export async function recordFailures(keys: string[]): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  await Promise.all(
    keys.map(async (key) => {
      try {
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
