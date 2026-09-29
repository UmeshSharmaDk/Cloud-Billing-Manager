import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";

/**
 * A signup that has been submitted but not yet proved.
 *
 * Registration cannot create the account directly any more. The response has to
 * look the same whether or not the address is already taken — otherwise the
 * endpoint is an oracle for "does this person have an account here" — and that
 * means the outcome is settled by email rather than by the HTTP response.
 *
 * The row is deliberately *not* a user. Creating an inactive user up front would
 * let anyone reserve an address they do not control: submit someone's email and
 * they can never sign up. Here, several people may have a pending registration
 * for the same address at once, and whoever proves control of the mailbox first
 * gets the account — the rest simply expire.
 *
 * `tokenHash` and not the token: this table holds a live credential, and a
 * database read (a backup, a log, a stray SELECT) should not yield one. The
 * plaintext exists only in the email that was sent.
 */
export const pendingRegistrationsTable = pgTable(
  "pending_registrations",
  {
    id: serial("id").primaryKey(),
    /** SHA-256 of the verification token. Unique so a lookup is a point read. */
    tokenHash: text("token_hash").notNull().unique(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    // There is deliberately no password here. It used to be chosen by whoever
    // submitted the form and stored (hashed) until the link was opened, so anyone
    // could submit a victim's address with a password they knew — and when the
    // victim, unsuspecting, opened the emailed link, the account they were signed
    // in to had a password the attacker also held. The password is now chosen by
    // whoever opens the link, at the moment they prove they control the mailbox.
    businessName: text("business_name").notNull(),
    gstin: text("gstin"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pending_registrations_email_idx").on(t.email),
    index("pending_registrations_expires_at_idx").on(t.expiresAt),
  ],
);

export type PendingRegistration = typeof pendingRegistrationsTable.$inferSelect;
