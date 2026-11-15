import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const businessesTable = pgTable("businesses", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  gstin: text("gstin"),
  pan: text("pan"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  stateCode: text("state_code"),
  pincode: text("pincode"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  logoUrl: text("logo_url"),
  invoicePrefix: text("invoice_prefix").default("INV"),
  bankName: text("bank_name"),
  bankAccount: text("bank_account"),
  bankIfsc: text("bank_ifsc"),
  bankBranch: text("bank_branch"),
  /** UPI ID (VPA) shown as a pay-by-QR on invoices, e.g. shop@okhdfcbank. */
  upiId: text("upi_id"),
  termsConditions: text("terms_conditions"),
  /**
   * Books are frozen on and before this day (YYYY-MM-DD): invoices, purchases,
   * payments and e-way bills dated then cannot be added, edited or cancelled.
   * Set by the business's administrator; null means nothing is frozen.
   */
  lockDate: text("lock_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBusinessSchema = createInsertSchema(businessesTable).omit({ id: true, createdAt: true });
export type InsertBusiness = z.infer<typeof insertBusinessSchema>;
export type Business = typeof businessesTable.$inferSelect;
