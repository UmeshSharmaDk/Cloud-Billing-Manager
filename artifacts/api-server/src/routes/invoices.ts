import { Router } from "express";
import { db, invoicesTable, businessesTable, customersTable, productsTable, invoiceCountersTable } from "@workspace/db";
import { eq, ilike, and, count, gte, lte, desc, sql } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import { ListInvoicesQuery, CreateInvoiceBody, UpdateInvoiceBody, UpdateInvoiceStatusBody, IdParam } from "../schemas";

const router = Router();

function calcGst(items: any[], isInterstate: boolean) {
  let subtotal = 0, cgst = 0, sgst = 0, igst = 0;
  const processed = items.map(item => {
    const qty = parseFloat(String(item.quantity ?? 1));
    // Accept both `unitPrice` (frontend) and `rate` (legacy)
    const rate = parseFloat(String(item.unitPrice ?? item.rate ?? 0));
    const discount = parseFloat(String(item.discount ?? 0));
    const gstRate = parseFloat(String(item.gstRate ?? 0));
    const taxableAmount = qty * rate * (1 - discount / 100);
    let itemCgst = 0, itemSgst = 0, itemIgst = 0;
    if (isInterstate) {
      itemIgst = taxableAmount * gstRate / 100;
    } else {
      itemCgst = taxableAmount * gstRate / 100 / 2;
      itemSgst = taxableAmount * gstRate / 100 / 2;
    }
    subtotal += taxableAmount;
    cgst += itemCgst;
    sgst += itemSgst;
    igst += itemIgst;
    return {
      ...item,
      unitPrice: rate,
      taxableAmount: Math.round(taxableAmount * 100) / 100,
      cgst: Math.round(itemCgst * 100) / 100,
      sgst: Math.round(itemSgst * 100) / 100,
      igst: Math.round(itemIgst * 100) / 100,
      totalAmount: Math.round((taxableAmount + itemCgst + itemSgst + itemIgst) * 100) / 100,
    };
  });
  const totalGst = cgst + sgst + igst;
  const grandTotalRaw = subtotal + totalGst;
  const grandTotal = Math.round(grandTotalRaw);
  const roundOff = Math.round((grandTotal - grandTotalRaw) * 100) / 100;
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    cgst: Math.round(cgst * 100) / 100,
    sgst: Math.round(sgst * 100) / 100,
    igst: Math.round(igst * 100) / 100,
    totalGst: Math.round(totalGst * 100) / 100,
    grandTotal, roundOff, items: processed,
  };
}

function mapInvoice(inv: any) {
  return {
    ...inv,
    subtotal: parseFloat(inv.subtotal),
    cgst: parseFloat(inv.cgst),
    sgst: parseFloat(inv.sgst),
    igst: parseFloat(inv.igst),
    totalGst: parseFloat(inv.totalGst),
    grandTotal: parseFloat(inv.grandTotal),
    roundOff: parseFloat(inv.roundOff),
    paidAmount: parseFloat(inv.paidAmount),
    balanceDue: Math.max(0, parseFloat(inv.grandTotal) - parseFloat(inv.paidAmount)),
    items: Array.isArray(inv.items) ? inv.items : [],
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

router.get("/", requireAuth, requireBusiness, validateQuery(ListInvoicesQuery), async (req: any, res) => {
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

router.post("/", requireAuth, requireBusiness, validateBody(CreateInvoiceBody), async (req: any, res) => {
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

  // Auto-detect interstate based on business state code vs placeOfSupply
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  const bizStateCode = business?.stateCode ?? "";
  const isInterstate = placeOfSupply ? (placeOfSupply.trim() !== bizStateCode.trim()) : false;

  const gstCalc = calcGst(items, isInterstate);

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
      isInterstate, notes, items: gstCalc.items,
      subtotal: gstCalc.subtotal.toString(), cgst: gstCalc.cgst.toString(),
      sgst: gstCalc.sgst.toString(), igst: gstCalc.igst.toString(),
      totalGst: gstCalc.totalGst.toString(), grandTotal: gstCalc.grandTotal.toString(),
      roundOff: gstCalc.roundOff.toString(), paidAmount: "0",
    }).returning();

    // Deduct stock for each sold item.
    const allProducts = await tx.select().from(productsTable).where(eq(productsTable.businessId, businessId));
    for (const item of gstCalc.items) {
      const qty = parseFloat(String(item.quantity ?? 0));
      if (qty <= 0) continue;
      let product = null;
      if (item.productId) {
        product = allProducts.find((p: any) => p.id === item.productId) ?? null;
      }
      if (!product && item.description) {
        product = allProducts.find((p: any) => p.name.toLowerCase() === String(item.description).toLowerCase()) ?? null;
      }
      if (product) {
        const newQty = Math.max(0, parseFloat(product.stockQuantity) - qty);
        await tx.update(productsTable).set({ stockQuantity: newQty.toString() }).where(eq(productsTable.id, product.id));
      }
    }

    return created;
  });

  return res.status(201).json({ invoice: mapInvoice(invoice) });
});

router.get("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: any, res) => {
  const businessId = req.businessId;
  const [invoice] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId))).limit(1);
  if (!invoice) return res.status(404).json({ error: "Not found" });
  return res.json(mapInvoice(invoice));
});

router.patch("/:id", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdateInvoiceBody), async (req: any, res) => {
  const businessId = req.businessId;
  const { type, customerId, invoiceDate, dueDate, placeOfSupply, isInterstate, notes, items } = req.body;
  const updates: any = {};
  if (type) updates.type = type;
  if (dueDate !== undefined) updates.dueDate = dueDate;
  if (placeOfSupply !== undefined) updates.placeOfSupply = placeOfSupply;
  if (notes !== undefined) updates.notes = notes;
  if (items) {
    const gstCalc = calcGst(items, isInterstate ?? false);
    Object.assign(updates, { items: gstCalc.items, subtotal: gstCalc.subtotal.toString(), cgst: gstCalc.cgst.toString(), sgst: gstCalc.sgst.toString(), igst: gstCalc.igst.toString(), totalGst: gstCalc.totalGst.toString(), grandTotal: gstCalc.grandTotal.toString(), roundOff: gstCalc.roundOff.toString(), isInterstate: isInterstate ?? false });
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
  }
  const [invoice] = await db.update(invoicesTable).set(updates).where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId))).returning();
  if (!invoice) return res.status(404).json({ error: "Not found" });
  return res.json(mapInvoice(invoice));
});

router.delete("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: any, res) => {
  const businessId = req.businessId;
  await db.delete(invoicesTable).where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId)));
  return res.json({ success: true });
});

router.patch("/:id/status", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdateInvoiceStatusBody), async (req: any, res) => {
  const businessId = req.businessId;
  const { paymentStatus, status, paidAmount } = req.body;
  const newStatus = paymentStatus ?? status;
  const updates: any = {};
  if (newStatus) updates.status = newStatus;
  if (paidAmount !== undefined) updates.paidAmount = paidAmount.toString();
  const [invoice] = await db.update(invoicesTable).set(updates).where(and(eq(invoicesTable.id, req.validatedParams.id), eq(invoicesTable.businessId, businessId))).returning();
  if (!invoice) return res.status(404).json({ error: "Not found" });
  return res.json(mapInvoice(invoice));
});

export default router;
