import { pgTable, integer, text, primaryKey } from "drizzle-orm/pg-core";

/**
 * Per-business, per-financial-year invoice sequence.
 *
 * Numbers were previously derived from `COUNT(*) + 1` over the business's
 * invoices, which is wrong in two ways that matter legally, not just
 * cosmetically: two invoices raised at the same moment both read the same
 * count and get the same number, and deleting an invoice lowers the count so
 * the next one reuses a number already issued.
 *
 * Indian GST requires a unique, unbroken, sequential series per financial
 * year. A counter row incremented with `ON CONFLICT DO UPDATE ... RETURNING`
 * is atomic in a single statement, so concurrent callers serialise on the row
 * and each gets its own number.
 */
export const invoiceCountersTable = pgTable(
  "invoice_counters",
  {
    businessId: integer("business_id").notNull(),
    /** Indian financial year, April to March, as "2025-26". */
    financialYear: text("financial_year").notNull(),
    lastNumber: integer("last_number").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.financialYear] })],
);

export type InvoiceCounter = typeof invoiceCountersTable.$inferSelect;
