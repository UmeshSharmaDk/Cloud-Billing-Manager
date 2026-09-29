/**
 * Moving money on an invoice, so the invoice and the payments ledger agree.
 *
 * `paidAmount` on an invoice and the rows in `payments` are two records of one
 * fact, and they were maintained independently:
 *
 *   - `paidAmount` was accepted up to 1e12 with no relation to the invoice's own
 *     total, so an invoice could be "paid" ₹1 crore against ₹1,000;
 *   - every rise in it wrote a receipt, but a fall wrote nothing, and cancelling
 *     zeroed it and left the receipts behind;
 *   - two concurrent "mark paid" requests both read the same old amount and both
 *     wrote a receipt;
 *   - `POST /payments` never touched the invoice it named at all.
 *
 * Everything that changes what has been paid now goes through `settleInvoice`:
 * one place that locks the invoice row, refuses an amount outside 0..grandTotal,
 * derives the status from the amount rather than trusting the caller's word for
 * it, and writes the ledger entry that explains the change. The ledger is
 * append-only: lowering what has been paid records a reversal rather than
 * deleting the receipt, so nothing that was ever recorded disappears.
 */

import { and, eq } from "drizzle-orm";
import { invoicesTable, paymentsTable } from "@workspace/db";
import { Decimal, dec, toColumn } from "./money";

export type InvoiceRow = typeof invoicesTable.$inferSelect;
export type PaymentRow = typeof paymentsTable.$inferSelect;

export interface LedgerEntry {
  /** How a receipt is labelled ("received" or "in"); reversals are always "paid". */
  type?: string;
  mode?: string | null;
  referenceNumber?: string | null;
  date?: string;
  notes?: string | null;
  customerId?: number | null;
  vendorId?: number | null;
}

export type Decision = { target: Decimal } | { error: string; status?: 400 | 409 };

export type SettleResult =
  | { ok: true; invoice: InvoiceRow; payment: PaymentRow | null }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** The status an amount implies. A zero-value invoice is paid only if asked. */
export function deriveStatus(
  target: Decimal,
  grandTotal: Decimal,
  requested?: string,
): "unpaid" | "partial" | "paid" {
  if (grandTotal.isZero()) return requested === "paid" ? "paid" : "unpaid";
  if (target.isZero()) return "unpaid";
  return target.greaterThanOrEqualTo(grandTotal) ? "paid" : "partial";
}

/**
 * Lock an invoice and change what has been paid on it.
 *
 * `decide` sees the locked row, so the new amount is computed from the state
 * that will actually be written to. It returns the amount the invoice should
 * show as paid afterwards, or an error to refuse with.
 *
 * With `cancel: true` the invoice ends cancelled with nothing paid: whatever was
 * received is reversed in the ledger first. A cancelled invoice is final, so a
 * request to change one is refused.
 */
export async function settleInvoice(
  tx: any,
  businessId: number,
  invoiceId: number,
  decide: (invoice: InvoiceRow) => Decision,
  entry: LedgerEntry = {},
  options: { cancel?: boolean; requestedStatus?: string } = {},
): Promise<SettleResult> {
  const [invoice]: InvoiceRow[] = await tx
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.businessId, businessId)))
    .for("update")
    .limit(1);
  if (!invoice) return { ok: false, status: 404, error: "Not found" };

  if (invoice.status === "cancelled") {
    return { ok: false, status: 409, error: "A cancelled invoice cannot be changed." };
  }

  const grandTotal = dec(invoice.grandTotal);
  const paid = dec(invoice.paidAmount);

  let target: Decimal;
  if (options.cancel) {
    target = dec(0);
  } else {
    const decision = decide(invoice);
    if ("error" in decision) {
      return { ok: false, status: decision.status ?? 400, error: decision.error };
    }
    target = decision.target;
    if (target.isNegative()) {
      return { ok: false, status: 400, error: "The amount paid cannot be negative." };
    }
    if (target.greaterThan(grandTotal)) {
      return {
        ok: false,
        status: 409,
        error: `The amount paid cannot exceed the invoice total of ${grandTotal.toFixed(2)}.`,
      };
    }
  }

  const delta = target.minus(paid);
  let payment: PaymentRow | null = null;

  if (!delta.isZero()) {
    const received = delta.greaterThan(0);
    const [row] = await tx.insert(paymentsTable).values({
      businessId,
      // A fall in what has been paid is recorded as money going back out, so
      // the ledger nets to the invoice's own figure instead of losing history.
      type: received ? (entry.type ?? "received") : "paid",
      amount: toColumn(delta.abs()),
      date: entry.date ?? new Date().toISOString().slice(0, 10),
      mode: entry.mode ?? "cash",
      referenceNumber: entry.referenceNumber ?? null,
      invoiceId: invoice.id,
      customerId: entry.customerId ?? invoice.customerId ?? null,
      vendorId: entry.vendorId ?? null,
      notes:
        entry.notes ??
        (received
          ? `Invoice ${invoice.invoiceNumber}`
          : `Reversal - ${options.cancel ? "cancelled" : "amount corrected"}: Invoice ${invoice.invoiceNumber}`),
    }).returning();
    payment = row;
  }

  const status = options.cancel
    ? "cancelled"
    : deriveStatus(target, grandTotal, options.requestedStatus);

  const [updated]: InvoiceRow[] = await tx
    .update(invoicesTable)
    .set({ paidAmount: toColumn(target), status })
    .where(and(eq(invoicesTable.id, invoice.id), eq(invoicesTable.businessId, businessId)))
    .returning();

  return { ok: true, invoice: updated, payment };
}
