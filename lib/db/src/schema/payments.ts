import { pgTable, text, serial, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  type: text("type").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  date: text("date").notNull(),
  mode: text("mode").notNull().default("cash"),
  referenceNumber: text("reference_number"),
  invoiceId: integer("invoice_id"),
  customerId: integer("customer_id"),
  vendorId: integer("vendor_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Every query is for one business; without this each one scans the table, and
  // the row-level-security filter is applied after the scan rather than before.
  index("payments_business_idx").on(t.businessId),
  index("payments_invoice_idx").on(t.invoiceId),
]);

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
