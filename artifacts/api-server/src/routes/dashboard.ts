import { Router } from "express";
import { db, invoicesTable, purchasesTable, customersTable, vendorsTable, productsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc, lte as lteOp } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";

const router = Router();

router.get("/stats", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;

  const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.businessId, businessId));
  const purchases = await db.select().from(purchasesTable).where(eq(purchasesTable.businessId, businessId));
  const customers = await db.select().from(customersTable).where(eq(customersTable.businessId, businessId));
  const vendors = await db.select().from(vendorsTable).where(eq(vendorsTable.businessId, businessId));
  const products = await db.select().from(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.isActive, true)));

  const totalSales = invoices.reduce((s, i) => s + parseFloat(i.grandTotal ?? "0"), 0);
  const totalPurchases = purchases.reduce((s, p) => s + parseFloat(p.grandTotal ?? "0"), 0);
  const totalGstPayable = invoices.reduce((s, i) => s + parseFloat(i.totalGst ?? "0"), 0) - purchases.reduce((s, p) => s + parseFloat(p.totalGst ?? "0"), 0);
  const totalOutstanding = invoices.filter(i => i.status === "unpaid").reduce((s, i) => s + parseFloat(i.grandTotal ?? "0"), 0);
  const lowStockCount = products.filter(p => {
    const qty = parseFloat(p.stockQuantity);
    const threshold = p.lowStockThreshold ? parseFloat(p.lowStockThreshold) : 5;
    return qty < threshold;
  }).length;
  const overdueInvoiceCount = invoices.filter(i => i.dueDate && new Date(i.dueDate) < new Date() && i.status !== "paid").length;

  return res.json({
    totalSales: Math.round(totalSales * 100) / 100,
    totalPurchases: Math.round(totalPurchases * 100) / 100,
    totalGstPayable: Math.round(totalGstPayable * 100) / 100,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    invoiceCount: invoices.length,
    customerCount: customers.length,
    vendorCount: vendors.length,
    productCount: products.length,
    lowStockCount,
    overdueInvoiceCount,
  });
});

router.get("/recent-invoices", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;
  const invoices = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.businessId, businessId))
    .orderBy(desc(invoicesTable.createdAt)).limit(5);
  return res.json(invoices.map(inv => ({
    ...inv,
    subtotal: parseFloat(inv.subtotal), cgst: parseFloat(inv.cgst), sgst: parseFloat(inv.sgst),
    igst: parseFloat(inv.igst), totalGst: parseFloat(inv.totalGst), grandTotal: parseFloat(inv.grandTotal),
    roundOff: parseFloat(inv.roundOff), paidAmount: parseFloat(inv.paidAmount),
    items: Array.isArray(inv.items) ? inv.items : [],
  })));
});

router.get("/monthly-revenue", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;

  const months: { month: string; sales: number; purchases: number; gst: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const from = `${monthStr}-01`;
    const toD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const to = `${monthStr}-${String(toD.getDate()).padStart(2, "0")}`;

    const invs = await db.select().from(invoicesTable).where(and(eq(invoicesTable.businessId, businessId), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to)));
    const purs = await db.select().from(purchasesTable).where(and(eq(purchasesTable.businessId, businessId), gte(purchasesTable.invoiceDate, from), lte(purchasesTable.invoiceDate, to)));
    const sales = invs.reduce((s, i) => s + parseFloat(i.grandTotal ?? "0"), 0);
    const purTotal = purs.reduce((s, p) => s + parseFloat(p.grandTotal ?? "0"), 0);
    const gst = invs.reduce((s, i) => s + parseFloat(i.totalGst ?? "0"), 0);
    months.push({ month: d.toLocaleString("en-IN", { month: "short", year: "numeric" }), sales: Math.round(sales), purchases: Math.round(purTotal), gst: Math.round(gst) });
  }
  return res.json(months);
});

router.get("/top-products", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;
  const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.businessId, businessId));
  const productMap: Record<string, { productId: number; productName: string; totalQuantity: number; totalRevenue: number }> = {};
  for (const inv of invoices) {
    const items = Array.isArray(inv.items) ? inv.items : [];
    for (const item of items) {
      const key = item.productId ? String(item.productId) : item.productName;
      if (!productMap[key]) productMap[key] = { productId: item.productId ?? 0, productName: item.productName, totalQuantity: 0, totalRevenue: 0 };
      productMap[key].totalQuantity += parseFloat(item.quantity ?? 0);
      productMap[key].totalRevenue += parseFloat(item.totalAmount ?? 0);
    }
  }
  const sorted = Object.values(productMap).sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 5);
  return res.json(sorted);
});

router.get("/gst-summary", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const invoices = await db.select().from(invoicesTable).where(and(eq(invoicesTable.businessId, businessId), gte(invoicesTable.invoiceDate, from)));
  const purchases = await db.select().from(purchasesTable).where(and(eq(purchasesTable.businessId, businessId), gte(purchasesTable.invoiceDate, from)));
  const outputCgst = invoices.reduce((s, i) => s + parseFloat(i.cgst ?? "0"), 0);
  const outputSgst = invoices.reduce((s, i) => s + parseFloat(i.sgst ?? "0"), 0);
  const outputIgst = invoices.reduce((s, i) => s + parseFloat(i.igst ?? "0"), 0);
  const inputCgst = purchases.reduce((s, p) => s + parseFloat(p.cgst ?? "0"), 0);
  const inputSgst = purchases.reduce((s, p) => s + parseFloat(p.sgst ?? "0"), 0);
  const inputIgst = purchases.reduce((s, p) => s + parseFloat(p.igst ?? "0"), 0);
  const netPayable = (outputCgst + outputSgst + outputIgst) - (inputCgst + inputSgst + inputIgst);
  return res.json({
    outputCgst: Math.round(outputCgst * 100) / 100, outputSgst: Math.round(outputSgst * 100) / 100,
    outputIgst: Math.round(outputIgst * 100) / 100, inputCgst: Math.round(inputCgst * 100) / 100,
    inputSgst: Math.round(inputSgst * 100) / 100, inputIgst: Math.round(inputIgst * 100) / 100,
    netPayable: Math.round(netPayable * 100) / 100,
  });
});

router.get("/low-stock", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;
  const products = await db.select().from(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.isActive, true)));
  const lowStock = products.filter(p => {
    const qty = parseFloat(p.stockQuantity);
    const threshold = p.lowStockThreshold ? parseFloat(p.lowStockThreshold) : 5;
    return qty < threshold;
  });
  return res.json(lowStock.map(p => ({
    ...p,
    purchasePrice: p.purchasePrice ? parseFloat(p.purchasePrice) : null,
    sellingPrice: p.sellingPrice ? parseFloat(p.sellingPrice) : null,
    gstRate: parseFloat(p.gstRate),
    stockQuantity: parseFloat(p.stockQuantity),
    lowStockThreshold: p.lowStockThreshold ? parseFloat(p.lowStockThreshold) : null,
  })));
});

export default router;
