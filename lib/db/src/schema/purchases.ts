import { pgTable, text, serial, integer, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
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
});

export const insertPurchaseSchema = createInsertSchema(purchasesTable).omit({ id: true, createdAt: true });
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type Purchase = typeof purchasesTable.$inferSelect;
