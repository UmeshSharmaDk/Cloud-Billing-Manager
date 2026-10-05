import { pgTable, text, serial, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vendorsTable = pgTable("vendors", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull(),
  name: text("name").notNull(),
  gstin: text("gstin"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  stateCode: text("state_code"),
  pincode: text("pincode"),
  outstandingBalance: numeric("outstanding_balance", { precision: 15, scale: 2 }).default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Every query is for one business; without this each one scans the table, and
  // the row-level-security filter is applied after the scan rather than before.
  index("vendors_business_idx").on(t.businessId),
]);

export const insertVendorSchema = createInsertSchema(vendorsTable).omit({ id: true, createdAt: true });
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendorsTable.$inferSelect;
