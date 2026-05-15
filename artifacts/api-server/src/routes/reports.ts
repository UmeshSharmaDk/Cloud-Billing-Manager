import { Router } from "express";
import { db, invoicesTable, purchasesTable, productsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

async function getBusinessId(userId: number): Promise<number | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.businessId ?? null;
}

function mapInvoice(inv: any) {
  return {
    ...inv, subtotal: parseFloat(inv.subtotal), cgst: parseFloat(inv.cgst),
    sgst: parseFloat(inv.sgst), igst: parseFloat(inv.igst), totalGst: parseFloat(inv.totalGst),
    grandTotal: parseFloat(inv.grandTotal), roundOff: parseFloat(inv.roundOff),
    paidAmount: parseFloat(inv.paidAmount), items: Array.isArray(inv.items) ? inv.items : [],
  };
}

function mapPurchase(p: any) {
  return {
    ...p, subtotal: parseFloat(p.subtotal), cgst: parseFloat(p.cgst), sgst: parseFloat(p.sgst),
    igst: parseFloat(p.igst), totalGst: parseFloat(p.totalGst), grandTotal: parseFloat(p.grandTotal),
    items: Array.isArray(p.items) ? p.items : [],
  };
}

router.get("/gstr1", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const now = new Date();
  const month = parseInt((req.query.month as string) ?? String(now.getMonth() + 1));
  const year = parseInt((req.query.year as string) ?? String(now.getFullYear()));
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const invoices = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.businessId, businessId), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to)));
  const mapped = invoices.map(mapInvoice);
  const totalTaxableValue = mapped.reduce((s, i) => s + i.subtotal, 0);
  const totalCgst = mapped.reduce((s, i) => s + i.cgst, 0);
  const totalSgst = mapped.reduce((s, i) => s + i.sgst, 0);
  const totalIgst = mapped.reduce((s, i) => s + i.igst, 0);
  return res.json({ month, year, totalTaxableValue: Math.round(totalTaxableValue * 100) / 100, totalCgst: Math.round(totalCgst * 100) / 100, totalSgst: Math.round(totalSgst * 100) / 100, totalIgst: Math.round(totalIgst * 100) / 100, totalTax: Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100, invoices: mapped });
});

router.get("/gstr3b", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const now = new Date();
  const month = parseInt((req.query.month as string) ?? String(now.getMonth() + 1));
  const year = parseInt((req.query.year as string) ?? String(now.getFullYear()));
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const [invoices, purchases] = await Promise.all([
    db.select().from(invoicesTable).where(and(eq(invoicesTable.businessId, businessId), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to))),
    db.select().from(purchasesTable).where(and(eq(purchasesTable.businessId, businessId), gte(purchasesTable.invoiceDate, from), lte(purchasesTable.invoiceDate, to))),
  ]);
  const mappedInv = invoices.map(mapInvoice);
  const outputTax = mappedInv.reduce((s, i) => s + i.totalGst, 0);
  const inputTax = purchases.reduce((s, p) => s + parseFloat(p.totalGst ?? "0"), 0);
  const netTax = outputTax - inputTax;
  return res.json({ month, year, totalTaxableValue: Math.round(mappedInv.reduce((s, i) => s + i.subtotal, 0) * 100) / 100, totalCgst: Math.round(mappedInv.reduce((s, i) => s + i.cgst, 0) * 100) / 100, totalSgst: Math.round(mappedInv.reduce((s, i) => s + i.sgst, 0) * 100) / 100, totalIgst: Math.round(mappedInv.reduce((s, i) => s + i.igst, 0) * 100) / 100, totalTax: Math.round(netTax * 100) / 100, invoices: mappedInv });
});

router.get("/sales", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const { fromDate, toDate } = req.query as any;
  const conditions: any[] = [eq(invoicesTable.businessId, businessId)];
  if (fromDate) conditions.push(gte(invoicesTable.invoiceDate, fromDate));
  if (toDate) conditions.push(lte(invoicesTable.invoiceDate, toDate));
  const invoices = await db.select().from(invoicesTable).where(and(...conditions));
  const mapped = invoices.map(mapInvoice);
  const totalSales = mapped.reduce((s, i) => s + i.grandTotal, 0);
  const totalGst = mapped.reduce((s, i) => s + i.totalGst, 0);
  return res.json({ totalSales: Math.round(totalSales * 100) / 100, totalGst: Math.round(totalGst * 100) / 100, netSales: Math.round((totalSales - totalGst) * 100) / 100, invoiceCount: mapped.length, invoices: mapped });
});

router.get("/purchases", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const { fromDate, toDate } = req.query as any;
  const conditions: any[] = [eq(purchasesTable.businessId, businessId)];
  if (fromDate) conditions.push(gte(purchasesTable.invoiceDate, fromDate));
  if (toDate) conditions.push(lte(purchasesTable.invoiceDate, toDate));
  const purchases = await db.select().from(purchasesTable).where(and(...conditions));
  const mapped = purchases.map(mapPurchase);
  const totalPurchases = mapped.reduce((s, p) => s + p.grandTotal, 0);
  const totalGst = mapped.reduce((s, p) => s + p.totalGst, 0);
  return res.json({ totalPurchases: Math.round(totalPurchases * 100) / 100, totalGst: Math.round(totalGst * 100) / 100, netPurchases: Math.round((totalPurchases - totalGst) * 100) / 100, purchaseCount: mapped.length, purchases: mapped });
});

router.get("/stock", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const products = await db.select().from(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.isActive, true)));
  const mapped = products.map(p => ({
    ...p,
    purchasePrice: p.purchasePrice ? parseFloat(p.purchasePrice) : null,
    sellingPrice: p.sellingPrice ? parseFloat(p.sellingPrice) : null,
    gstRate: parseFloat(p.gstRate),
    stockQuantity: parseFloat(p.stockQuantity),
    lowStockThreshold: p.lowStockThreshold ? parseFloat(p.lowStockThreshold) : null,
  }));
  const totalStockValue = mapped.reduce((s, p) => s + (p.sellingPrice ?? 0) * p.stockQuantity, 0);
  const lowStockProducts = mapped.filter(p => p.lowStockThreshold && p.stockQuantity <= p.lowStockThreshold).length;
  return res.json({ totalProducts: mapped.length, totalStockValue: Math.round(totalStockValue * 100) / 100, lowStockProducts, products: mapped });
});

export default router;
