import { pgTable, text, serial, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  isActive: boolean("is_active").notNull().default(true),
  subscriptionStatus: text("subscription_status"),
  subscriptionEnd: text("subscription_end"),
  businessId: integer("business_id"),
  /**
   * Soft delete. A hard DELETE removed only this row and left the business,
   * invoices, customers and products behind with a dangling businessId —
   * unreachable tax records that nobody could retrieve or remove. Statutory
   * retention makes that the wrong default, so deletion is now reversible.
   */
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
