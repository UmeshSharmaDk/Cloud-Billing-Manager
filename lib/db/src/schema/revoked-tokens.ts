import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Sessions ended before their token expired.
 *
 * A JWT is valid until it expires, so signing out cannot invalidate one by
 * itself — clearing the cookie only removes the browser's copy. `tokenVersion`
 * on `users` revokes *every* session at once, which is right for "my laptop was
 * stolen" and wrong for ordinary sign-out: it would sign the person out of
 * their phone too.
 *
 * So each token carries a `jti`, and signing out records that one id here.
 * `requireAuth` refuses any token whose id is listed.
 *
 * Rows are only useful until the token they name would have expired anyway, and
 * `pruneExpired` deletes them after that — the table is bounded by the number of
 * sign-outs in a seven-day window, not by all sign-outs ever.
 */
export const revokedTokensTable = pgTable(
  "revoked_tokens",
  {
    jti: text("jti").primaryKey(),
    /** When the token would have expired on its own, and the row stops mattering. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("revoked_tokens_expires_at_idx").on(t.expiresAt)],
);

export type RevokedToken = typeof revokedTokensTable.$inferSelect;
