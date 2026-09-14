import { Router } from "express";
import { db, purchasesTable, vendorsTable, productsTable, businessesTable } from "@workspace/db";
import { eq, ilike, and, count, gte, lte, desc } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import { Decimal, dec, paise, sum, sumBy, splitGst, toColumn, toJson } from "../lib/money";
import { ListPurchasesQuery, CreatePurchaseBody, UpdatePurchaseBody, IdParam } from "../schemas";
import { resolveInwardSupplyType } from "../lib/gst";
import { applyStockMovement, findLineProduct, STOCK_IN } from "../lib/stock";
import type { TenantRequest, IdParams } from "../lib/http";
import { mapPurchase } from "../lib/serialise";

const router = Router();

/**
 * Handlers in this router run after `requireAuth` and `requireBusiness`, so
 * the caller's tenant is resolved and the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `businessId` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = TenantRequest<any, any, IdParams>;


/** True if any line on the bill carries GST, so the split actually matters. */
function billHasGst(items: any[]): boolean {
  return items.some((item) => dec(item?.gstRate ?? 0).greaterThan(0));
}

function calcPurchaseTotals(items: any[], isInterstate: boolean) {
  // Same rule as sales: round at the line, then sum the rounded values, so the
  // bill's totals are the exact sum of its items. Input tax credit is claimed
  // from these figures, so a paisa of drift is a paisa of wrong credit.
  const processed = items.map((item) => {
    const qty = dec(item.quantity ?? 1);
    // Accept both `unitPrice` (frontend) and `rate` (legacy)
    const rate = dec(item.unitPrice ?? item.rate ?? 0);
    const gstRate = dec(item.gstRate ?? 0);

    const taxableAmount = paise(qty.times(rate));
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
      totalAmount: toJson(sum([taxableAmount, cgst, sgst, igst])),
    };
  });

  const subtotal = sumBy(processed, (i) => i.taxableAmount);
  const cgst = sumBy(processed, (i) => i.cgst);
  const sgst = sumBy(processed, (i) => i.sgst);
  const igst = sumBy(processed, (i) => i.igst);
  const totalGst = sum([cgst, sgst, igst]);

  return {
    subtotal: toJson(subtotal),
    cgst: toJson(cgst),
    sgst: toJson(sgst),
    igst: toJson(igst),
    totalGst: toJson(totalGst),
    grandTotal: toJson(subtotal.plus(totalGst)),
    items: processed,
  };
}

/**
 * For each purchase line item, match it to an existing catalog product by name
 * (case-insensitive, exact match). If found, update that product's stock quantity,
 * purchase price, GST rate, HSN code and unit to the values from this bill. If no
 * match is found, create a new catalog product from the item so it enters inventory.
 * Returns the items array annotated with the resolved productId.
 *
 * Takes the caller's transaction: this mutates the product catalog, and doing
 * that outside the transaction that records the bill meant a failure part-way
 * left stock and prices updated for a purchase that was never saved.
 */
/**
 * Point each line at a catalog product, creating one where the bill names
 * something new, and refresh the details the bill is authoritative for.
 *
 * Deliberately does *not* move stock. It used to: the same call both resolved a
 * product and added the line's quantity to it, so re-running it on an edit
 * added those quantities a second time without reversing the first — saving the
 * same bill twice left double the goods. Movement is now `applyStockMovement`,
 * which the caller pairs with a reversal.
 *
 * New products are created at zero stock for the same reason; the movement that
 * follows is what puts the goods in.
 */
async function resolveItemsToProducts(tx: any, businessId: number, items: any[]) {
  const catalog = await tx.select().from(productsTable).where(eq(productsTable.businessId, businessId));
  const resolved: any[] = [];
  for (const item of items) {
    const name = String(item.description ?? "").trim();
    const unitPrice = dec(item.unitPrice ?? 0);
    const gstRate = dec(item.gstRate ?? 0);
    let product = findLineProduct(catalog, item);

    if (product) {
      const updates: any = {};
      if (unitPrice.greaterThan(0)) updates.purchasePrice = toColumn(unitPrice);
      if (item.gstRate !== undefined) updates.gstRate = gstRate.toFixed(2);
      if (item.hsnCode) updates.hsnCode = item.hsnCode;
      if (item.unit) updates.unit = item.unit;
      if (Object.keys(updates).length > 0) {
        const [updated] = await tx.update(productsTable).set(updates).where(eq(productsTable.id, product.id)).returning();
        product = updated;
      }
    } else if (name) {
      const [created] = await tx.insert(productsTable).values({
        businessId, name, hsnCode: item.hsnCode || null, unit: item.unit || "Nos",
        purchasePrice: toColumn(unitPrice), sellingPrice: toColumn(unitPrice),
        gstRate: gstRate.toFixed(2), stockQuantity: "0",
      }).returning();
      product = created;
      catalog.push(product);
    }

    resolved.push({ ...item, productId: product?.id ?? null });
  }
  return resolved;
}

router.get("/", requireAuth, requireBusiness, validateQuery(ListPurchasesQuery), async (req: Req, res) => {
  const businessId = req.businessId;
  const { search, vendorId, fromDate, toDate, page, limit } = req.validatedQuery;
  const conditions: any[] = [eq(purchasesTable.businessId, businessId)];
  if (search) conditions.push(ilike(purchasesTable.invoiceNumber, `%${search}%`));
  if (vendorId) conditions.push(eq(purchasesTable.vendorId, vendorId));
  if (fromDate) conditions.push(gte(purchasesTable.invoiceDate, fromDate));
  if (toDate) conditions.push(lte(purchasesTable.invoiceDate, toDate));
  const purchases = await db.select().from(purchasesTable).where(and(...conditions))
    .limit(limit).offset((page - 1) * limit)
    .orderBy(desc(purchasesTable.createdAt));
  const [{ count: total }] = await db.select({ count: count() }).from(purchasesTable).where(and(...conditions));
  return res.json({ purchases: purchases.map(mapPurchase), total: Number(total) });
});

router.post("/", requireAuth, requireBusiness, validateBody(CreatePurchaseBody), async (req: Req, res) => {
  const businessId = req.businessId;

  // Accept both billNumber/billDate (frontend convention) and invoiceNumber/invoiceDate
  const {
    vendorId,
    billNumber, billDate,
    invoiceNumber: rawInvoiceNumber, invoiceDate: rawInvoiceDate,
    dueDate, notes, items = [],
  } = req.body;

  const invoiceNumber = billNumber ?? rawInvoiceNumber;
  const invoiceDate = billDate ?? rawInvoiceDate;

  if (!vendorId) return res.status(400).json({ error: "vendorId required" });
  if (!invoiceDate) return res.status(400).json({ error: "billDate required" });

  // Scoped to the caller's business — see the note in invoices.ts; the same
  // unscoped lookup here leaked every tenant's vendor names and GSTINs.
  const [vendor] = await db.select().from(vendorsTable)
    .where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.businessId, businessId)))
    .limit(1);
  if (!vendor) return res.status(400).json({ error: "Unknown vendor" });

  // Which head the input credit falls under. This used to be left at the
  // default of `false`, so every bill was recorded as CGST + SGST and an
  // inter-state purchase claimed credit under heads it was not entitled to.
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  const supply = resolveInwardSupplyType(business, vendor, vendor.gstin, billHasGst(items));
  if (!supply.ok) return res.status(400).json({ error: supply.error });

  const calc = calcPurchaseTotals(items, supply.isInterstate);

  // Resolve each line item to a product by name (case-insensitive match) — update existing
  // product's stock/price/GST if a match is found, or create a new catalog product otherwise.
  const purchase = await db.transaction(async (tx) => {
    const resolvedItems = await resolveItemsToProducts(tx, businessId, calc.items);
    // Goods arrive. Separate from resolution above so an edit can reverse it.
    await applyStockMovement(tx, productsTable, eq, businessId, resolvedItems, STOCK_IN);

    const [created] = await tx.insert(purchasesTable).values({
      businessId, vendorId: parseInt(vendorId),
      vendorName: vendor.name, vendorGstin: vendor.gstin ?? null,
      invoiceNumber: invoiceNumber ?? `PUR-${Date.now()}`, invoiceDate, notes,
      isInterstate: supply.isInterstate,
      items: resolvedItems, subtotal: toColumn(calc.subtotal), cgst: toColumn(calc.cgst),
      sgst: toColumn(calc.sgst), igst: toColumn(calc.igst),
      totalGst: toColumn(calc.totalGst), grandTotal: toColumn(calc.grandTotal),
    }).returning();

    return created;
  });

  return res.status(201).json(mapPurchase(purchase));
});

router.get("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: Req, res) => {
  const businessId = req.businessId;
  const [purchase] = await db.select().from(purchasesTable).where(and(eq(purchasesTable.id, req.validatedParams.id), eq(purchasesTable.businessId, businessId))).limit(1);
  if (!purchase) return res.status(404).json({ error: "Not found" });
  return res.json(mapPurchase(purchase));
});

router.patch("/:id", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdatePurchaseBody), async (req: Req, res) => {
  const businessId = req.businessId;
  const { vendorId, billNumber, billDate, invoiceNumber: rawNum, invoiceDate: rawDate, dueDate, notes, items, paymentStatus } = req.body;

  // Read before writing: the supply type may depend on a vendor or on lines
  // this request is not changing.
  const [existing] = await db.select().from(purchasesTable)
    .where(and(eq(purchasesTable.id, req.validatedParams.id), eq(purchasesTable.businessId, businessId)))
    .limit(1);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const updates: any = {};
  const invoiceNumber = billNumber ?? rawNum;
  const invoiceDate = billDate ?? rawDate;
  if (invoiceNumber) updates.invoiceNumber = invoiceNumber;
  if (invoiceDate) updates.invoiceDate = invoiceDate;
  if (dueDate !== undefined) updates.dueDate = dueDate;
  if (notes !== undefined) updates.notes = notes;
  if (paymentStatus) updates.status = paymentStatus;

  // The vendor decides the supply type, so the one that matters is the vendor
  // this bill will have once the update lands — the new one, or the existing.
  let vendor;
  if (vendorId) {
    [vendor] = await db.select().from(vendorsTable)
      .where(and(eq(vendorsTable.id, vendorId), eq(vendorsTable.businessId, businessId)))
      .limit(1);
    if (!vendor) return res.status(400).json({ error: "Unknown vendor" });
    updates.vendorId = vendor.id;
    updates.vendorName = vendor.name;
    updates.vendorGstin = vendor.gstin ?? null;
  } else {
    [vendor] = await db.select().from(vendorsTable)
      .where(and(eq(vendorsTable.id, existing.vendorId), eq(vendorsTable.businessId, businessId)))
      .limit(1);
  }

  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId)).limit(1);
  const lines = (items ?? existing.items) as any[];
  const supply = resolveInwardSupplyType(
    business, vendor, vendor?.gstin ?? existing.vendorGstin, billHasGst(lines),
  );
  if (!supply.ok) return res.status(400).json({ error: supply.error });

  const assignTotals = (calc: ReturnType<typeof calcPurchaseTotals>, lineItems: any[]) => {
    Object.assign(updates, {
      items: lineItems, subtotal: toColumn(calc.subtotal), cgst: toColumn(calc.cgst),
      sgst: toColumn(calc.sgst), igst: toColumn(calc.igst), totalGst: toColumn(calc.totalGst),
      grandTotal: toColumn(calc.grandTotal), isInterstate: supply.isInterstate,
    });
  };

  const purchase = await db.transaction(async (tx) => {
    if (items) {
      const calc = calcPurchaseTotals(items, supply.isInterstate);
      const resolvedItems = await resolveItemsToProducts(tx, businessId, calc.items);
      // Undo what this bill previously put into stock, then apply what it says
      // now. Without the reversal, re-saving a bill for 10 units left 20.
      await applyStockMovement(tx, productsTable, eq, businessId, existing.items as any[], -STOCK_IN);
      await applyStockMovement(tx, productsTable, eq, businessId, resolvedItems, STOCK_IN);
      assignTotals(calc, resolvedItems);
    } else if (supply.isInterstate !== existing.isInterstate) {
      // Only the tax split changes here; the same goods were received, so stock
      // is left exactly as it is.
      const calc = calcPurchaseTotals(existing.items as any[], supply.isInterstate);
      assignTotals(calc, calc.items);
    }

    // A request that changes nothing is not an error, but `set({})` is invalid SQL.
    if (Object.keys(updates).length === 0) return existing;

    const [updated] = await tx.update(purchasesTable).set(updates)
      .where(and(eq(purchasesTable.id, req.validatedParams.id), eq(purchasesTable.businessId, businessId)))
      .returning();
    return updated;
  });
  if (!purchase) return res.status(404).json({ error: "Not found" });
  return res.json(mapPurchase(purchase));
});

router.delete("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: Req, res) => {
  const businessId = req.businessId;

  // Deleting a bill un-receives its goods. Without this the stock it added
  // stayed, so deleting a purchase left phantom inventory behind.
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(purchasesTable)
      .where(and(eq(purchasesTable.id, req.validatedParams.id), eq(purchasesTable.businessId, businessId)))
      .limit(1);
    if (!existing) return;
    await applyStockMovement(tx, productsTable, eq, businessId, existing.items as any[], -STOCK_IN);
    await tx.delete(purchasesTable)
      .where(and(eq(purchasesTable.id, req.validatedParams.id), eq(purchasesTable.businessId, businessId)));
  });
  return res.json({ success: true });
});

export default router;
