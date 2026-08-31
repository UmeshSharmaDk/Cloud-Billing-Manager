import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Failed-authentication counters, used to lock out brute-force attempts.
 *
 * Kept in the database rather than in process memory on purpose: the API runs
 * on an autoscale target, so an in-memory counter resets whenever an instance
 * recycles and is invisible to sibling instances — which is exactly the window
 * a credential-stuffing run needs.
 *
 * One row per subject. `key` is namespaced so addresses and accounts cannot
 * collide: `ip:203.0.113.4` or `user:42`.
 */
export const loginAttemptsTable = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  firstFailureAt: timestamp("first_failure_at").notNull().defaultNow(),
  lockedUntil: timestamp("locked_until"),
});

export type LoginAttempt = typeof loginAttemptsTable.$inferSelect;
