import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * A GST return the admin (usually the client's CA) has marked as filed for a
 * client's business and month. `period` is YYYY-MM, `form` GSTR-1 or GSTR-3B,
 * `arn` the acknowledgement number from the portal when they have it.
 */
export const returnFilingsTable = pgTable(
  "return_filings",
  {
    id: serial("id").primaryKey(),
    businessId: integer("business_id").notNull(),
    period: text("period").notNull(),
    form: text("form").notNull(),
    arn: text("arn"),
    filedBy: integer("filed_by").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("return_filings_business_period_form_idx").on(t.businessId, t.period, t.form)],
);

export type ReturnFiling = typeof returnFilingsTable.$inferSelect;
