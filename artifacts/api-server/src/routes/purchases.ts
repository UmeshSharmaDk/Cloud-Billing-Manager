import { Router } from "express";
import { db, purchasesTable, usersTable, vendorsTable, productsTable } from "@workspace/db";
import { eq, ilike, and, count, gte, lte, desc } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

async function getBusinessId(userId: number): Promise<number | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.businessId ?? null;
}

function calcPurchaseTotals(items: any[], isInterstate = false) {
  let subtotal = 0, cgst = 0, sgst = 0, igst = 0;
  const processed = items.map(item => {
    const qty = parseFloat(String(item.quantity ?? 1));
    // Accept both `unitPrice` (frontend) and `rate` (legacy)
    const rate = parseFloat(String(item.unitPrice ?? item.rate ?? 0));
    const gstRate = parseFloat(String(item.gstRate ?? 0));
    const taxableAmount = qty * rate;
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
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    cgst: Math.round(cgst * 100) / 100,
    sgst: Math.round(sgst * 100) / 100,
    igst: Math.round(igst * 100) / 100,
    totalGst: Math.round(totalGst * 100) / 100,
    grandTotal: Math.round((subtotal + totalGst) * 100) / 100,
    items: processed,
  };
}

function mapPurchase(p: any) {
  return {
    ...p,
    // Expose as both billNumber/billDate (frontend convention) and invoiceNumber/invoiceDate (DB convention)
    billNumber: p.invoiceNumber,
    billDate: p.invoiceDate,
    subtotal: parseFloat(p.subtotal),
    cgst: parseFloat(p.cgst),
    sgst: parseFloat(p.sgst),
    igst: parseFloat(p.igst),
    totalGst: parseFloat(p.totalGst),
    grandTotal: parseFloat(p.grandTotal),
    status: p.status ?? "unpaid",
    paymentStatus: p.status ?? "unpaid",
    items: Array.isArray(p.items) ? p.items : [],
  };
}

router.get("/", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const { search, vendorId, fromDate, toDate, page = "1", limit = "20" } = req.query as any;
  const conditions: any[] = [eq(purchasesTable.businessId, businessId)];
  if (search) conditions.push(ilike(purchasesTable.invoiceNumber, `%${search}%`));
  if (vendorId) conditions.push(eq(purchasesTable.vendorId, parseInt(vendorId)));
  if (fromDate) conditions.push(gte(purchasesTable.invoiceDate, fromDate));
  if (toDate) conditions.push(lte(purchasesTable.invoiceDate, toDate));
  const purchases = await db.select().from(purchasesTable).where(and(...conditions))
    .limit(parseInt(limit)).offset((parseInt(page) - 1) * parseInt(limit))
    .orderBy(desc(purchasesTable.createdAt));
  const [{ count: total }] = await db.select({ count: count() }).from(purchasesTable).where(eq(purchasesTable.businessId, businessId));
  return res.json({ purchases: purchases.map(mapPurchase), total: Number(total) });
});

router.post("/", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });

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

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, parseInt(vendorId))).limit(1);
  const calc = calcPurchaseTotals(items);

  const [purchase] = await db.insert(purchasesTable).values({
    businessId, vendorId: parseInt(vendorId),
    vendorName: vendor?.name ?? "Unknown", vendorGstin: vendor?.gstin ?? null,
    invoiceNumber: invoiceNumber ?? `PUR-${Date.now()}`, invoiceDate, notes,
    items: calc.items, subtotal: calc.subtotal.toString(), cgst: calc.cgst.toString(),
    sgst: calc.sgst.toString(), igst: calc.igst.toString(),
    totalGst: calc.totalGst.toString(), grandTotal: calc.grandTotal.toString(),
  }).returning();

  // Update stock for each item with a linked product
  for (const item of items) {
    if (item.productId) {
      const [product] = await db.select().from(productsTable).where(eq(productsTable.id, parseInt(item.productId))).limit(1);
      if (product) {
        const newQty = parseFloat(product.stockQuantity) + parseFloat(String(item.quantity ?? 0));
        await db.update(productsTable).set({ stockQuantity: newQty.toString() }).where(eq(productsTable.id, product.id));
      }
    }
  }

  return res.status(201).json(mapPurchase(purchase));
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  const [purchase] = await db.select().from(purchasesTable).where(and(eq(purchasesTable.id, parseInt(req.params.id)), eq(purchasesTable.businessId, businessId!))).limit(1);
  if (!purchase) return res.status(404).json({ error: "Not found" });
  return res.json(mapPurchase(purchase));
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  const { vendorId, billNumber, billDate, invoiceNumber: rawNum, invoiceDate: rawDate, dueDate, notes, items, paymentStatus } = req.body;
  const updates: any = {};
  const invoiceNumber = billNumber ?? rawNum;
  const invoiceDate = billDate ?? rawDate;
  if (invoiceNumber) updates.invoiceNumber = invoiceNumber;
  if (invoiceDate) updates.invoiceDate = invoiceDate;
  if (dueDate !== undefined) updates.dueDate = dueDate;
  if (notes !== undefined) updates.notes = notes;
  if (paymentStatus) updates.status = paymentStatus;
  if (items) {
    const calc = calcPurchaseTotals(items);
    Object.assign(updates, { items: calc.items, subtotal: calc.subtotal.toString(), cgst: calc.cgst.toString(), sgst: calc.sgst.toString(), igst: calc.igst.toString(), totalGst: calc.totalGst.toString(), grandTotal: calc.grandTotal.toString() });
  }
  if (vendorId) {
    const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, parseInt(vendorId))).limit(1);
    updates.vendorId = parseInt(vendorId);
    updates.vendorName = vendor?.name ?? "Unknown";
    updates.vendorGstin = vendor?.gstin ?? null;
  }
  const [purchase] = await db.update(purchasesTable).set(updates).where(and(eq(purchasesTable.id, parseInt(req.params.id)), eq(purchasesTable.businessId, businessId!))).returning();
  if (!purchase) return res.status(404).json({ error: "Not found" });
  return res.json(mapPurchase(purchase));
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  await db.delete(purchasesTable).where(and(eq(purchasesTable.id, parseInt(req.params.id)), eq(purchasesTable.businessId, businessId!)));
  return res.json({ success: true });
});

export default router;
