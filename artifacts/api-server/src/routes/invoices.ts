import { Router } from "express";
import { db, invoicesTable, businessesTable, customersTable, productsTable, invoiceCountersTable, paymentsTable } from "@workspace/db";
import { eq, ilike, and, count, gte, lte, desc, sql } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import { Decimal, dec, paise, rupees, sum, sumBy, splitGst, toColumn, toJson } from "../lib/money";
import { resolveSupplyType } from "../lib/gst";
import { applyStockMovement, STOCK_OUT } from "../lib/stock";
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

  const invoice = await db.transaction(async (tx) => {
    // Only a change of lines moves goods. A re-split for a changed place of
    // supply rewrites the same quantities, so reversing and reapplying it would
    // net to nothing — but doing neither keeps the stored movement honest.
    if (items) {
      await applyStockMovement(tx, productsTable, eq, businessId, existing.items as any[], -STOCK_OUT);
      await applyStockMovement(tx, productsTable, eq, businessId, updates.items, STOCK_OUT);
    }

    const [updated] = await tx.update(invoicesTable).set(updates)
      .where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId)))
      .returning();
    return updated;
  });

  if (!invoice) return res.status(404).json({ error: "Not found" });
  return res.json(mapInvoice(invoice));
});

router.delete("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: Req, res) => {
  const businessId = req.businessId;

  // Deleting an invoice un-sells its goods. Without this the stock it deducted
  // stayed deducted, so a create/delete cycle walked inventory down with no
  // sales on the books and the low-stock reports followed it.
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(invoicesTable)
      .where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId)))
      .limit(1);
    if (!existing) return;
    await applyStockMovement(tx, productsTable, eq, businessId, existing.items as any[], -STOCK_OUT);
    await tx.delete(invoicesTable)
      .where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId)));
  });
  return res.json({ success: true });
});

router.patch("/:id/status", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdateInvoiceStatusBody), async (req: Req, res) => {
  const businessId = req.businessId;
  const { paymentStatus, status, paidAmount, mode, referenceNumber } = req.body;
  const newStatus = paymentStatus ?? status;

  const [existing] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const updates: any = {};
  if (newStatus) updates.status = newStatus;

  // Marking an invoice paid used to set the status and nothing else, so the
  // invoice showed "paid" with its full balance still due — `paidAmount` stayed
  // at zero and `balanceDue` is derived from it. Settle the money alongside the
  // status unless the caller states an amount itself.
  const previouslyPaid = dec(existing.paidAmount);
  let settled = previouslyPaid;
  if (paidAmount !== undefined) {
    settled = dec(paidAmount);
  } else if (newStatus === "paid") {
    settled = dec(existing.grandTotal);
  } else if (newStatus === "unpaid" || newStatus === "cancelled") {
    settled = dec(0);
  }
  if (!settled.equals(previouslyPaid)) updates.paidAmount = toColumn(settled);

  const invoice = await db.transaction(async (tx) => {
    const [updated] = await tx.update(invoicesTable).set(updates)
      .where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId)))
      .returning();

    // Record the receipt, so the Payments page reflects what actually happened.
    // Its empty state has always promised that "payments are recorded when you
    // mark invoices as paid"; nothing wrote one, so the page was always empty.
    const received = settled.minus(previouslyPaid);
    if (received.greaterThan(0)) {
      await tx.insert(paymentsTable).values({
        businessId,
        type: "received",
        amount: toColumn(received),
        date: new Date().toISOString().slice(0, 10),
        mode: mode ?? "cash",
        referenceNumber: referenceNumber ?? null,
        invoiceId: updated.id,
        customerId: updated.customerId ?? null,
        notes: `Invoice ${updated.invoiceNumber}`,
      });
    }

    return updated;
  });

  return res.json(mapInvoice(invoice));
});

export default router;
