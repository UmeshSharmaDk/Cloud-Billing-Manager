import { pgTable, text, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Append-only record of privileged actions.
 *
 * Administrators could reset any user's password, promote any account, or
 * delete a user with no record of who did it or when — so a compromised admin
 * session left nothing for an incident response to reconstruct.
 *
 * Nothing in the application updates or deletes these rows. Retention is a
 * database-level concern; if rows are ever pruned, do it on a schedule that
 * matches the record-keeping obligations for the data they describe.
 */
export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  /** Who acted. Kept even if the account is later removed. */
  actorId: integer("actor_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  /** What they did, e.g. "user.password_reset", "user.role_changed". */
  action: text("action").notNull(),
  /** What it was done to. */
  targetType: text("target_type").notNull(),
  targetId: integer("target_id"),
  /** Changed fields, before and after. Never contains credentials. */
  details: jsonb("details").notNull().default({}),
  sourceIp: text("source_ip"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AuditLogEntry = typeof auditLogTable.$inferSelect;
