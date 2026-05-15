import { pgTable, text, serial, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  name: text("name").notNull(),
  sku: text("sku"),
  hsnCode: text("hsn_code"),
  unit: text("unit").notNull().default("Nos"),
  purchasePrice: numeric("purchase_price", { precision: 15, scale: 2 }),
  sellingPrice: numeric("selling_price", { precision: 15, scale: 2 }),
  gstRate: numeric("gst_rate", { precision: 5, scale: 2 }).notNull().default("18"),
  stockQuantity: numeric("stock_quantity", { precision: 15, scale: 3 }).notNull().default("0"),
  lowStockThreshold: numeric("low_stock_threshold", { precision: 15, scale: 3 }),
  description: text("description"),
  category: text("category"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
