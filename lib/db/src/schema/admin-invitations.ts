import { pgTable, serial, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * A superadmin-issued invitation. The database stores only a hash of the
 * one-time token; an admin account does not exist until its recipient chooses
 * a password through the emailed link.
 */
export const adminInvitationsTable = pgTable(
  "admin_invitations",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    userLimit: integer("user_limit").notNull().default(15),
    invitedByAdminId: integer("invited_by_admin_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("admin_invitations_expires_at_idx").on(table.expiresAt),
    uniqueIndex("admin_invitations_unused_email_idx")
      .on(table.email)
      .where(sql`${table.usedAt} IS NULL`),
  ],
);

export type AdminInvitation = typeof adminInvitationsTable.$inferSelect;