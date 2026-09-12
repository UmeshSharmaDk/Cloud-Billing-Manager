import { Router } from "express";
import { db, invoicesTable, purchasesTable, customersTable, vendorsTable, productsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc, lte as lteOp } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { dec, sum, sumBy, toJson } from "../lib/money";

const router = Router();

router.get("/stats", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;

  const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.businessId, businessId));
  const purchases = await db.select().from(purchasesTable).where(eq(purchasesTable.businessId, businessId));
  const customers = await db.select().from(customersTable).where(eq(customersTable.businessId, businessId));
  const vendors = await db.select().from(vendorsTable).where(eq(vendorsTable.businessId, businessId));
  const products = await db.select().from(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.isActive, true)));

  const totalSales = sumBy(invoices, (i) => i.grandTotal ?? "0");
  const totalPurchases = sumBy(purchases, (p) => p.grandTotal ?? "0");
  const totalGstPayable = sumBy(invoices, (i) => i.totalGst ?? "0")
    .minus(sumBy(purchases, (p) => p.totalGst ?? "0"));
  const totalOutstanding = sumBy(invoices.filter(i => i.status === "unpaid"), (i) => i.grandTotal ?? "0");
  const lowStockCount = products.filter(p => {
    const qty = dec(p.stockQuantity);
    const threshold = dec(p.lowStockThreshold ?? 5);
    return qty.lessThan(threshold);
  }).length;
  const overdueInvoiceCount = invoices.filter(i => i.dueDate && new Date(i.dueDate) < new Date() && i.status !== "paid").length;

  return res.json({
    totalSales: toJson(totalSales),
    totalPurchases: toJson(totalPurchases),
    totalGstPayable: toJson(totalGstPayable),
    totalOutstanding: toJson(totalOutstanding),
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
    subtotal: toJson(inv.subtotal), cgst: toJson(inv.cgst), sgst: toJson(inv.sgst),
    igst: toJson(inv.igst), totalGst: toJson(inv.totalGst), grandTotal: toJson(inv.grandTotal),
    roundOff: toJson(inv.roundOff), paidAmount: toJson(inv.paidAmount),
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
    const sales = sumBy(invs, (i) => i.grandTotal ?? "0");
    const purTotal = sumBy(purs, (p) => p.grandTotal ?? "0");
    const gst = sumBy(invs, (i) => i.totalGst ?? "0");
    months.push({
      month: d.toLocaleString("en-IN", { month: "short", year: "numeric" }),
      sales: sales.toDecimalPlaces(0).toNumber(),
      purchases: purTotal.toDecimalPlaces(0).toNumber(),
      gst: gst.toDecimalPlaces(0).toNumber(),
    });
  }
  return res.json(months);
});

router.get("/top-products", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;
  const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.businessId, businessId));
  const productMap: Record<string, { productId: number; productName: string; totalQuantity: ReturnType<typeof dec>; totalRevenue: ReturnType<typeof dec> }> = {};
  for (const inv of invoices) {
    const items = Array.isArray(inv.items) ? inv.items : [];
    for (const item of items) {
      const key = item.productId ? String(item.productId) : item.productName;
      if (!productMap[key]) productMap[key] = { productId: item.productId ?? 0, productName: item.productName, totalQuantity: dec(0), totalRevenue: dec(0) };
      productMap[key].totalQuantity = productMap[key].totalQuantity.plus(dec(item.quantity ?? 0));
      productMap[key].totalRevenue = productMap[key].totalRevenue.plus(dec(item.totalAmount ?? 0));
    }
  }
  const sorted = Object.values(productMap)
    .sort((a, b) => b.totalRevenue.comparedTo(a.totalRevenue))
    .slice(0, 5)
    .map((p) => ({ ...p, totalQuantity: Number(p.totalQuantity.toFixed(3)), totalRevenue: toJson(p.totalRevenue) }));
  return res.json(sorted);
});

router.get("/gst-summary", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const invoices = await db.select().from(invoicesTable).where(and(eq(invoicesTable.businessId, businessId), gte(invoicesTable.invoiceDate, from)));
  const purchases = await db.select().from(purchasesTable).where(and(eq(purchasesTable.businessId, businessId), gte(purchasesTable.invoiceDate, from)));
  const outputCgst = sumBy(invoices, (i) => i.cgst ?? "0");
  const outputSgst = sumBy(invoices, (i) => i.sgst ?? "0");
  const outputIgst = sumBy(invoices, (i) => i.igst ?? "0");
  const inputCgst = sumBy(purchases, (p) => p.cgst ?? "0");
  const inputSgst = sumBy(purchases, (p) => p.sgst ?? "0");
  const inputIgst = sumBy(purchases, (p) => p.igst ?? "0");
  const netPayable = sum([outputCgst, outputSgst, outputIgst])
    .minus(sum([inputCgst, inputSgst, inputIgst]));
  return res.json({
    outputCgst: toJson(outputCgst), outputSgst: toJson(outputSgst),
    outputIgst: toJson(outputIgst), inputCgst: toJson(inputCgst),
    inputSgst: toJson(inputSgst), inputIgst: toJson(inputIgst),
    netPayable: toJson(netPayable),
  });
});

router.get("/low-stock", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;
  const products = await db.select().from(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.isActive, true)));
  const lowStock = products.filter(p => {
    const qty = dec(p.stockQuantity);
    const threshold = dec(p.lowStockThreshold ?? 5);
    return qty.lessThan(threshold);
  });
  return res.json(lowStock.map(p => ({
    ...p,
    purchasePrice: p.purchasePrice ? toJson(p.purchasePrice) : null,
    sellingPrice: p.sellingPrice ? toJson(p.sellingPrice) : null,
    gstRate: Number(dec(p.gstRate).toFixed(2)),
    stockQuantity: Number(dec(p.stockQuantity).toFixed(3)),
    lowStockThreshold: p.lowStockThreshold ? Number(dec(p.lowStockThreshold).toFixed(3)) : null,
  })));
});

export default router;
