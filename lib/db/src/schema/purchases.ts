import { pgTable, text, serial, integer, numeric, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const purchasesTable = pgTable("purchases", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  vendorId: integer("vendor_id").notNull(),
  vendorName: text("vendor_name").notNull(),
  vendorGstin: text("vendor_gstin"),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: text("invoice_date").notNull(),
  dueDate: text("due_date"),
  /**
   * Whether the supplier is in another state, which decides whether the
   * input credit is IGST or CGST + SGST. Derived from the vendor rather than
   * supplied by the client — see `lib/gst.ts`.
   */
  isInterstate: boolean("is_interstate").notNull().default(false),
  status: text("status").notNull().default("unpaid"),
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).notNull().default("0"),
  cgst: numeric("cgst", { precision: 15, scale: 2 }).notNull().default("0"),
  sgst: numeric("sgst", { precision: 15, scale: 2 }).notNull().default("0"),
  igst: numeric("igst", { precision: 15, scale: 2 }).notNull().default("0"),
  totalGst: numeric("total_gst", { precision: 15, scale: 2 }).notNull().default("0"),
  grandTotal: numeric("grand_total", { precision: 15, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  items: jsonb("items").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Every query is for one business; without this each one scans the table, and
  // the row-level-security filter is applied after the scan rather than before.
  index("purchases_business_idx").on(t.businessId),
]);

export const insertPurchaseSchema = createInsertSchema(purchasesTable).omit({ id: true, createdAt: true });
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type Purchase = typeof purchasesTable.$inferSelect;
