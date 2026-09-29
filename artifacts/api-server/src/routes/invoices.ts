import { Router } from "express";
import { db, invoicesTable, businessesTable, customersTable, productsTable, invoiceCountersTable } from "@workspace/db";
import { eq, ilike, and, count, gte, lte, desc, sql } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import { Decimal, dec, paise, rupees, sum, sumBy, splitGst, toColumn, toJson } from "../lib/money";
import { resolveSupplyType } from "../lib/gst";
import { applyStockMovement, STOCK_OUT } from "../lib/stock";
import { settleInvoice, deriveStatus } from "../lib/invoice-payments";
import { ListInvoicesQuery, CreateInvoiceBody, UpdateInvoiceBody, UpdateInvoiceStatusBody, IdParam } from "../schemas";
import type { TenantRequest, IdParams } from "../lib/http";
import { mapInvoice } from "../lib/serialise";

const router = Router();

/**
 * Handlers in this router run after `requireAuth` and `requireBusiness`, so
 * the caller's tenant is resolved and the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `businessId` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = TenantRequest<any, any, IdParams>;


/**
 * Why an invoice may not be edited as asked, or `null` if it may.
 * See the PATCH handler for the reasoning; kept here so the check made before
 * the write and the one made under the row lock are the same rule.
 */
function invoiceEditBlock(inv: { status: string; paidAmount: unknown }, editsFigures: boolean): string | null {
  if (inv.status === "cancelled") return "A cancelled invoice cannot be changed.";
  if (editsFigures && dec(inv.paidAmount).greaterThan(0)) {
    return "This invoice has payments recorded against it, so its figures can no longer be edited. Cancel it or issue a credit note instead.";
  }
  return null;
}

function calcGst(items: any[], isInterstate: boolean) {
  // Each line is rounded to paise here, and the invoice totals are the sum of
  // those rounded values. The previous version accumulated the unrounded
  // amounts, so the stored lines did not add up to the stored total.
  const processed = items.map((item) => {
    const qty = dec(item.quantity ?? 1);
    // Accept both `unitPrice` (frontend) and `rate` (legacy)
    const rate = dec(item.unitPrice ?? item.rate ?? 0);
    const discount = dec(item.discount ?? 0);
    const gstRate = dec(item.gstRate ?? 0);

    const taxableAmount = paise(
      qty.times(rate).times(new Decimal(100).minus(discount)).dividedBy(100),
    );
    const lineGst = paise(taxableAmount.times(gstRate).dividedBy(100));

    const igst = isInterstate ? lineGst : new Decimal(0);
    const { cgst, sgst } = isInterstate
      ? { cgst: new Decimal(0), sgst: new Decimal(0) }
      : splitGst(lineGst);

    return {
      ...item,
      unitPrice: rate.toNumber(),
      taxableAmount: toJson(taxableAmount),
      cgst: toJson(cgst),
      sgst: toJson(sgst),
      igst: toJson(igst),
      // Exactly the sum of this line's own parts.
      totalAmount: toJson(sum([taxableAmount, cgst, sgst, igst])),
    };
  });

  const subtotal = sumBy(processed, (i) => i.taxableAmount);
  const cgst = sumBy(processed, (i) => i.cgst);
  const sgst = sumBy(processed, (i) => i.sgst);
  const igst = sumBy(processed, (i) => i.igst);
  const totalGst = sum([cgst, sgst, igst]);

  const payable = subtotal.plus(totalGst);
  const grandTotal = rupees(payable);
  const roundOff = paise(grandTotal.minus(payable));

  return {
    subtotal: toJson(subtotal),
    cgst: toJson(cgst),
    sgst: toJson(sgst),
    igst: toJson(igst),
    totalGst: toJson(totalGst),
    grandTotal: grandTotal.toNumber(),
    roundOff: toJson(roundOff),
    items: processed,
  };
}

/**
 * The Indian financial year containing a date, as "2025-26". It runs from
 * 1 April to 31 March, so January to March belong to the year before.
 */
export function financialYear(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const startYear = (m ?? 1) >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * Allocate the next invoice number for a business in a given financial year.
 *
 * The counter is incremented and read in one statement, so two concurrent
 * callers serialise on the row and cannot be handed the same number — the old
 * `COUNT(*) + 1` gave both the same answer. Because the counter only ever goes
 * up, deleting an invoice no longer frees its number for reuse either.
 *
 * Runs inside the caller's transaction so a failed insert rolls the allocation
 * back; a gap in the series is a compliance problem of its own.
 */
async function nextInvoiceNumber(
  tx: any,
  businessId: number,
  invoiceDate: string,
): Promise<string> {
  const [business] = await tx.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  const prefix = business?.invoicePrefix ?? "INV";
  const fy = financialYear(invoiceDate);

  const [counter] = await tx
    .insert(invoiceCountersTable)
    .values({ businessId, financialYear: fy, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [invoiceCountersTable.businessId, invoiceCountersTable.financialYear],
      set: { lastNumber: sql`${invoiceCountersTable.lastNumber} + 1` },
    })
    .returning();

  return `${prefix}-${fy}-${String(counter.lastNumber).padStart(4, "0")}`;
}

router.get("/", requireAuth, requireBusiness, validateQuery(ListInvoicesQuery), async (req: Req, res) => {
  const businessId = req.businessId;
  const { search, type, status, customerId, fromDate, toDate, page, limit } = req.validatedQuery;
  const conditions: any[] = [eq(invoicesTable.businessId, businessId)];
  if (search) conditions.push(ilike(invoicesTable.invoiceNumber, `%${search}%`));
  if (type) conditions.push(eq(invoicesTable.type, type));
  if (status) conditions.push(eq(invoicesTable.status, status));
  if (customerId) conditions.push(eq(invoicesTable.customerId, customerId));
  if (fromDate) conditions.push(gte(invoicesTable.invoiceDate, fromDate));
  if (toDate) conditions.push(lte(invoicesTable.invoiceDate, toDate));
  const invoices = await db.select().from(invoicesTable).where(and(...conditions))
    .limit(limit).offset((page - 1) * limit)
    .orderBy(desc(invoicesTable.createdAt));
  const [{ count: total }] = await db.select({ count: count() }).from(invoicesTable).where(and(...conditions));
  return res.json({ invoices: invoices.map(mapInvoice), total: Number(total) });
});

router.post("/", requireAuth, requireBusiness, validateBody(CreateInvoiceBody), async (req: Req, res) => {
  const businessId = req.businessId;

  const { type, customerId, customerName: customCustomerName, customerGstin: customGstin, invoiceDate, dueDate, placeOfSupply, notes, items = [] } = req.body;

  if (!invoiceDate) return res.status(400).json({ error: "invoiceDate required" });
  if (!customerId && !customCustomerName) return res.status(400).json({ error: "customerId or customerName required" });

  // Resolve customer info — support both registered and walk-in customers
  let resolvedCustomerId = customerId ? parseInt(customerId) : 0;
  let resolvedCustomerName = customCustomerName ?? "Walk-in Customer";
  let resolvedCustomerGstin = customGstin ?? null;

  if (customerId) {
    // Scoped to the caller's business. Without the businessId condition this
    // lookup resolved ANY customer on the platform and copied their name and
    // GSTIN onto the invoice, making invoice creation a read primitive over
    // every tenant's counterparties.
    const [customer] = await db.select().from(customersTable)
      .where(and(eq(customersTable.id, customerId), eq(customersTable.businessId, businessId)))
      .limit(1);
    // Fail loudly rather than silently falling back: the silent fallback is
    // what let the probe go unnoticed.
    if (!customer) return res.status(400).json({ error: "Unknown customer" });
    resolvedCustomerName = customer.name;
    resolvedCustomerGstin = customer.gstin ?? null;
  }

  // CGST+SGST or IGST, decided by the seller's state against the place of
  // supply. See `lib/gst.ts`: this used to treat a business with no state code
  // as being in state "", which made every local sale look inter-state.
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  const supply = resolveSupplyType(business, placeOfSupply);
  if (!supply.ok) return res.status(400).json({ error: supply.error });

  const gstCalc = calcGst(items, supply.isInterstate);

  // One transaction. Previously the invoice was inserted and then stock was
  // deducted in a loop of separate statements, so a failure part-way left an
  // invoice recorded against stock that was never decremented — and the
  // number allocation could succeed while the insert failed, leaving a gap.
  const invoice = await db.transaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(tx, businessId, invoiceDate);

    const [created] = await tx.insert(invoicesTable).values({
      businessId, invoiceNumber, type: type ?? "Tax Invoice", status: "unpaid",
      customerId: resolvedCustomerId, customerName: resolvedCustomerName,
      customerGstin: resolvedCustomerGstin, invoiceDate, dueDate, placeOfSupply,
      isInterstate: supply.isInterstate, notes, items: gstCalc.items,
      subtotal: toColumn(gstCalc.subtotal), cgst: toColumn(gstCalc.cgst),
      sgst: toColumn(gstCalc.sgst), igst: toColumn(gstCalc.igst),
      totalGst: toColumn(gstCalc.totalGst), grandTotal: toColumn(gstCalc.grandTotal),
      roundOff: toColumn(gstCalc.roundOff), paidAmount: "0.00",
    }).returning();

    // Goods leave on a sale. Routed through the shared helper so an edit or a
    // delete can reverse exactly this movement.
    await applyStockMovement(tx, productsTable, eq, businessId, gstCalc.items, STOCK_OUT);

    return created;
  });

  return res.status(201).json({ invoice: mapInvoice(invoice) });
});

router.get("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: Req, res) => {
  const businessId = req.businessId;
  const [invoice] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId))).limit(1);
  if (!invoice) return res.status(404).json({ error: "Not found" });
  return res.json(mapInvoice(invoice));
});

router.patch("/:id", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdateInvoiceBody), async (req: Req, res) => {
  const businessId = req.businessId;
  // `isInterstate` is deliberately not read from the body. It decides whether
  // the customer may claim IGST or CGST+SGST credit, so it is the server's to
  // derive from the place of supply — a client that could assert it could
  // mis-state the tax head on an invoice that still totals correctly.
  const { type, customerId, invoiceDate, dueDate, placeOfSupply, notes, items } = req.body;

  // Read before writing: the effective place of supply may be one this request
  // is not changing, and a 404 should not be discovered after building updates.
  const [existing] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Not found" });

  // An issued invoice is a tax document. Once it is cancelled it is final, and
  // once money has been recorded against it the figures it was paid against
  // cannot move — an edit could drop the total below what was received, and
  // silently rewrite what a customer was told they owe. Notes and the due date
  // are not part of that, so they stay editable. To correct a paid invoice,
  // cancel it (which reverses the receipts) or issue a credit note.
  const editsFigures = Boolean(
    type || customerId || invoiceDate || placeOfSupply !== undefined || items,
  );
  const blocked = invoiceEditBlock(existing, editsFigures);
  if (blocked) return res.status(409).json({ error: blocked });

  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  const effectivePlace = placeOfSupply !== undefined ? placeOfSupply : existing.placeOfSupply;
  const supply = resolveSupplyType(business, effectivePlace);
  if (!supply.ok) return res.status(400).json({ error: supply.error });

  const updates: any = {};
  if (type) updates.type = type;
  if (dueDate !== undefined) updates.dueDate = dueDate;
  if (placeOfSupply !== undefined) updates.placeOfSupply = placeOfSupply;
  if (notes !== undefined) updates.notes = notes;

  // Changing the customer or the date is applied whether or not the lines are
  // being resent. Both used to sit inside the recompute branch below, so
  // `PATCH {"customerId": 7}` on its own returned 200 having changed nothing —
  // and a date change silently failed to move the invoice into the financial
  // year that drives GSTR-1 period selection.
  if (customerId) {
    const [customer] = await db.select().from(customersTable)
      .where(and(eq(customersTable.id, customerId), eq(customersTable.businessId, businessId)))
      .limit(1);
    if (!customer) return res.status(400).json({ error: "Unknown customer" });
    updates.customerId = customer.id;
    updates.customerName = customer.name;
    updates.customerGstin = customer.gstin ?? null;
  }
  if (invoiceDate) updates.invoiceDate = invoiceDate;

  // Recompute when the lines change, and also when the supply type does —
  // moving the place of supply across a state line changes which tax applies to
  // lines nobody edited, and leaving the stored split alone would keep charging
  // the old one.
  const supplyTypeChanged = supply.isInterstate !== existing.isInterstate;
  const linesToPrice = items ?? (supplyTypeChanged ? (existing.items as any[]) : null);

  if (linesToPrice) {
    const gstCalc = calcGst(linesToPrice, supply.isInterstate);
    Object.assign(updates, { items: gstCalc.items, subtotal: toColumn(gstCalc.subtotal), cgst: toColumn(gstCalc.cgst), sgst: toColumn(gstCalc.sgst), igst: toColumn(gstCalc.igst), totalGst: toColumn(gstCalc.totalGst), grandTotal: toColumn(gstCalc.grandTotal), roundOff: toColumn(gstCalc.roundOff), isInterstate: supply.isInterstate });
  }

  // A request that changes nothing is not an error, but `set({})` is invalid SQL.
  if (Object.keys(updates).length === 0) return res.json(mapInvoice(existing));

  const outcome = await db.transaction(async (tx) => {
    // Re-read under a row lock and re-apply the rule. The check above ran on a
    // snapshot, and a payment or a cancellation can land between it and here.
    const [locked] = await tx.select().from(invoicesTable)
      .where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId)))
      .for("update")
      .limit(1);
    if (!locked) return { kind: "missing" as const };
    const conflict = invoiceEditBlock(locked, editsFigures);
    if (conflict) return { kind: "conflict" as const, error: conflict };

    // Only a change of lines moves goods. A re-split for a changed place of
    // supply rewrites the same quantities, so reversing and reapplying it would
    // net to nothing — but doing neither keeps the stored movement honest.
    if (items) {
      await applyStockMovement(tx, productsTable, eq, businessId, locked.items as any[], -STOCK_OUT);
      await applyStockMovement(tx, productsTable, eq, businessId, updates.items, STOCK_OUT);
    }

    const [updated] = await tx.update(invoicesTable).set(updates)
      .where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId)))
      .returning();
    return { kind: "updated" as const, invoice: updated };
  });

  if (outcome.kind === "missing") return res.status(404).json({ error: "Not found" });
  if (outcome.kind === "conflict") return res.status(409).json({ error: outcome.error });
  return res.json(mapInvoice(outcome.invoice));
});

/**
 * Invoices are never deleted. The number was allocated from a gapless statutory
 * series and is on the customer's copy; removing the row leaves a hole in the
 * series that cannot be explained, and takes any payments recorded against it
 * out from under their invoice. Cancelling keeps the number and the history,
 * takes the invoice out of every total, and puts its goods back in stock.
 */
router.delete("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: Req, res) => {
  const businessId = req.businessId;
  const [existing] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Not found" });
  return res.status(409).json({
    error: "An issued invoice cannot be deleted. Cancel it instead, so its number stays on record.",
  });
});

router.patch("/:id/status", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdateInvoiceStatusBody), async (req: Req, res) => {
  const businessId = req.businessId;
  const { paymentStatus, status, paidAmount, mode, referenceNumber } = req.body;
  const newStatus = paymentStatus ?? status;
  const cancelling = newStatus === "cancelled";

  if (cancelling && paidAmount !== undefined) {
    return res.status(400).json({ error: "A cancelled invoice has nothing paid; omit paidAmount." });
  }

  // Everything that changes what has been paid goes through `settleInvoice`,
  // which locks the row, keeps the amount inside 0..grandTotal, derives the
  // status from it and writes the ledger entry. Marking an invoice paid used to
  // set the status alone, then the amount, then a receipt, none of it atomic.
  const result = await db.transaction(async (tx) => {
    const settled = await settleInvoice(
      tx, businessId, req.validatedParams.id,
      (invoice) => {
        const grandTotal = dec(invoice.grandTotal);
        let target: Decimal;
        if (paidAmount !== undefined) target = dec(paidAmount);
        else if (newStatus === "paid") target = grandTotal;
        else if (newStatus === "unpaid") target = dec(0);
        else if (newStatus === "partial") {
          return { error: "State the amount received to mark an invoice partly paid." };
        } else target = dec(invoice.paidAmount);

        // The status is a description of the amount, not a second input. Taking
        // both at face value let an invoice read "paid" with its balance due.
        const implied = deriveStatus(target, grandTotal, newStatus);
        if (newStatus && newStatus !== implied) {
          return {
            error: `An amount paid of ${target.toFixed(2)} makes this invoice '${implied}', not '${newStatus}'.`,
          };
        }
        return { target };
      },
      { mode, referenceNumber },
      { cancel: cancelling, requestedStatus: newStatus },
    );

    // Cancelling un-sells the goods, exactly once: a cancelled invoice is final,
    // so this cannot run twice for the same invoice.
    if (settled.ok && cancelling) {
      await applyStockMovement(tx, productsTable, eq, businessId, settled.invoice.items as any[], -STOCK_OUT);
    }
    return settled;
  });

  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(mapInvoice(result.invoice));
});

export default router;
