import { pgTable, text, serial, integer, numeric, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  type: text("type").notNull().default("Tax Invoice"),
  status: text("status").notNull().default("unpaid"),
  customerId: integer("customer_id").notNull(),
  customerName: text("customer_name").notNull(),
  customerGstin: text("customer_gstin"),
  invoiceDate: text("invoice_date").notNull(),
  dueDate: text("due_date"),
  placeOfSupply: text("place_of_supply"),
  isInterstate: boolean("is_interstate").notNull().default(false),
  subtotal: numeric("subtotal", { precision: 15, scale: 2 }).notNull().default("0"),
  cgst: numeric("cgst", { precision: 15, scale: 2 }).notNull().default("0"),
  sgst: numeric("sgst", { precision: 15, scale: 2 }).notNull().default("0"),
  igst: numeric("igst", { precision: 15, scale: 2 }).notNull().default("0"),
  totalGst: numeric("total_gst", { precision: 15, scale: 2 }).notNull().default("0"),
  roundOff: numeric("round_off", { precision: 10, scale: 2 }).notNull().default("0"),
  grandTotal: numeric("grand_total", { precision: 15, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  items: jsonb("items").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
