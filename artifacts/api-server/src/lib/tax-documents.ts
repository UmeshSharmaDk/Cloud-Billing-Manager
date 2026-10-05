/**
 * Which documents count toward sales, tax and input credit.
 *
 * Every report and dashboard figure used to add up every invoice and bill in the
 * date range, whatever its state. So a cancelled invoice stayed in GSTR-1 as
 * outward supply, a cancelled purchase stayed in GSTR-3B as input credit, and a
 * credit note *added* to the liability it exists to reduce. All three overstate
 * or misstate a figure that is filed.
 *
 * The rules, in one place so the reports cannot disagree with each other:
 *
 *   - a cancelled document counts for nothing;
 *   - a proforma invoice is a quotation, not a supply, so it is not a tax
 *     document at all;
 *   - a credit note counts as the negative of an invoice.
 *
 * `type` is matched case-insensitively and by prefix because invoices written
 * before the type was an enum can hold any string.
 */

import { and, ne, sql, type SQL } from "drizzle-orm";
import { dec } from "./money";

export const INVOICE_TYPES = [
  "Tax Invoice",
  "Bill of Supply",
  "Proforma Invoice",
  "Credit Note",
  "Debit Note",
] as const;

export const isCreditNoteType = (type: unknown) => /^\s*credit note/i.test(String(type ?? ""));
export const isProformaType = (type: unknown) => /^\s*proforma/i.test(String(type ?? ""));

interface InvoiceColumns {
  status: any;
  type: any;
}

/** Invoices that count toward sales and tax: not cancelled, not a proforma. */
export function taxInvoice(t: InvoiceColumns): SQL {
  return and(ne(t.status, "cancelled"), sql`lower(${t.type}) NOT LIKE 'proforma%'`)!;
}

/** Invoices that are owed to the business: a tax invoice that is not a credit note. */
export function receivableInvoice(t: InvoiceColumns): SQL {
  return and(taxInvoice(t), sql`lower(${t.type}) NOT LIKE 'credit note%'`)!;
}

/** `-1` for a credit note, `1` for everything else, for use inside an aggregate. */
export function invoiceSign(t: InvoiceColumns): SQL<number> {
  return sql<number>`(CASE WHEN lower(${t.type}) LIKE 'credit note%' THEN -1 ELSE 1 END)`;
}

/** Purchases that count toward input credit: anything not cancelled. */
export function activePurchase(t: { status: any }): SQL {
  return ne(t.status, "cancelled");
}

/** `-1` for a credit note, `1` otherwise. */
export function signOf(type: unknown): 1 | -1 {
  return isCreditNoteType(type) ? -1 : 1;
}

/**
 * Whether an already-loaded invoice counts toward tax. The database filters do
 * the same job; this is for callers that hold the rows.
 */
export function countsTowardTax(inv: { status?: unknown; type?: unknown }): boolean {
  return inv.status !== "cancelled" && !isProformaType(inv.type);
}

const NEGATED_LINE_FIELDS = ["quantity", "taxableAmount", "cgst", "sgst", "igst", "totalAmount"] as const;

/**
 * A copy of a mapped invoice with every amount negated when it is a credit
 * note, so summing a mixed list nets correctly. The original is untouched: the
 * report still lists the document with its own, positive figures.
 */
export function signedInvoice<T extends Record<string, any>>(inv: T): T {
  if (signOf(inv["type"]) === 1) return inv;
  const negate = (v: unknown) => dec(v).negated().toNumber();
  const items = Array.isArray(inv["items"])
    ? inv["items"].map((line: Record<string, any>) => {
        const copy: Record<string, any> = { ...line };
        for (const field of NEGATED_LINE_FIELDS) {
          if (copy[field] !== undefined) copy[field] = negate(copy[field]);
        }
        return copy;
      })
    : inv["items"];
  return {
    ...inv,
    subtotal: negate(inv["subtotal"]),
    cgst: negate(inv["cgst"]),
    sgst: negate(inv["sgst"]),
    igst: negate(inv["igst"]),
    totalGst: negate(inv["totalGst"]),
    grandTotal: negate(inv["grandTotal"]),
    items,
  };
}
