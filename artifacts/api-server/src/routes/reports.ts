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

  const intraState = mapped.filter(i => !i.isInterstate);
  const interState = mapped.filter(i => i.isInterstate);

  const totalTaxableValue = mapped.reduce((s, i) => s + i.subtotal, 0);
  const totalCgst = mapped.reduce((s, i) => s + i.cgst, 0);
  const totalSgst = mapped.reduce((s, i) => s + i.sgst, 0);
  const totalIgst = mapped.reduce((s, i) => s + i.igst, 0);
  const totalTax = totalCgst + totalSgst + totalIgst;
  const totalAmount = mapped.reduce((s, i) => s + i.grandTotal, 0);

  const rateMap: Record<number, { taxable: number; gst: number }> = {};
  for (const inv of mapped) {
    for (const item of inv.items) {
      const rate = parseFloat(String(item.gstRate ?? 0));
      if (!rateMap[rate]) rateMap[rate] = { taxable: 0, gst: 0 };
      rateMap[rate].taxable += parseFloat(String(item.taxableAmount ?? 0));
      rateMap[rate].gst += parseFloat(String(item.cgst ?? 0)) + parseFloat(String(item.sgst ?? 0)) + parseFloat(String(item.igst ?? 0));
    }
  }
  const byRate = Object.entries(rateMap)
    .map(([rate, v]) => ({ rate: parseFloat(rate), taxable: Math.round(v.taxable * 100) / 100, gst: Math.round(v.gst * 100) / 100 }))
    .sort((a, b) => a.rate - b.rate);

  return res.json({
    month, year,
    totalInvoices: mapped.length,
    totalTaxable: Math.round(totalTaxableValue * 100) / 100,
    totalGst: Math.round(totalTax * 100) / 100,
    totalAmount: Math.round(totalAmount * 100) / 100,
    totalTaxableValue: Math.round(totalTaxableValue * 100) / 100,
    totalCgst: Math.round(totalCgst * 100) / 100,
    totalSgst: Math.round(totalSgst * 100) / 100,
    totalIgst: Math.round(totalIgst * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    intraStateCount: intraState.length,
    intraStateTaxable: Math.round(intraState.reduce((s, i) => s + i.subtotal, 0) * 100) / 100,
    interStateCount: interState.length,
    interStateTaxable: Math.round(interState.reduce((s, i) => s + i.subtotal, 0) * 100) / 100,
    byRate,
    invoices: mapped.map(inv => ({ ...inv, taxableAmount: inv.subtotal, totalAmount: inv.grandTotal })),
  });
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
  const mappedPur = purchases.map(mapPurchase);

  const outwardCgst = mappedInv.reduce((s, i) => s + i.cgst, 0);
  const outwardSgst = mappedInv.reduce((s, i) => s + i.sgst, 0);
  const outwardIgst = mappedInv.reduce((s, i) => s + i.igst, 0);
  const outwardTaxable = mappedInv.reduce((s, i) => s + i.subtotal, 0);

  const inputCgst = mappedPur.reduce((s, p) => s + p.cgst, 0);
  const inputSgst = mappedPur.reduce((s, p) => s + p.sgst, 0);
  const inputIgst = mappedPur.reduce((s, p) => s + p.igst, 0);

  const netCgst = Math.max(0, outwardCgst - inputCgst);
  const netSgst = Math.max(0, outwardSgst - inputSgst);
  const netIgst = Math.max(0, outwardIgst - inputIgst);
  const netTax = (outwardCgst + outwardSgst + outwardIgst) - (inputCgst + inputSgst + inputIgst);

  return res.json({
    month, year,
    outwardTaxable: Math.round(outwardTaxable * 100) / 100,
    outwardCgst: Math.round(outwardCgst * 100) / 100,
    outwardSgst: Math.round(outwardSgst * 100) / 100,
    outwardIgst: Math.round(outwardIgst * 100) / 100,
    inputCgst: Math.round(inputCgst * 100) / 100,
    inputSgst: Math.round(inputSgst * 100) / 100,
    inputIgst: Math.round(inputIgst * 100) / 100,
    netCgst: Math.round(netCgst * 100) / 100,
    netSgst: Math.round(netSgst * 100) / 100,
    netIgst: Math.round(netIgst * 100) / 100,
    totalTax: Math.round(netTax * 100) / 100,
    totalTaxableValue: Math.round(outwardTaxable * 100) / 100,
    totalCgst: Math.round(outwardCgst * 100) / 100,
    totalSgst: Math.round(outwardSgst * 100) / 100,
    totalIgst: Math.round(outwardIgst * 100) / 100,
    invoices: mappedInv.map(inv => ({ ...inv, taxableAmount: inv.subtotal, totalAmount: inv.grandTotal })),
  });
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

router.get("/hsn", requireAuth, async (req: any, res) => {
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

  const hsnMap: Record<string, { description: string; quantity: number; uqc: string; taxableValue: number; cgst: number; sgst: number; igst: number }> = {};

  for (const inv of invoices) {
    const items = Array.isArray(inv.items) ? inv.items : [];
    for (const item of items) {
      const hsnCode = String(item.hsnCode || "N/A").trim();
      if (!hsnMap[hsnCode]) {
        hsnMap[hsnCode] = {
          description: item.description ?? item.productName ?? "",
          quantity: 0, uqc: item.unit ?? "Nos",
          taxableValue: 0, cgst: 0, sgst: 0, igst: 0,
        };
      }
      hsnMap[hsnCode].quantity += parseFloat(String(item.quantity ?? 0));
      hsnMap[hsnCode].taxableValue += parseFloat(String(item.taxableAmount ?? 0));
      hsnMap[hsnCode].cgst += parseFloat(String(item.cgst ?? 0));
      hsnMap[hsnCode].sgst += parseFloat(String(item.sgst ?? 0));
      hsnMap[hsnCode].igst += parseFloat(String(item.igst ?? 0));
    }
  }

  const items = Object.entries(hsnMap).map(([hsnCode, v]) => ({
    hsnCode,
    description: v.description,
    quantity: Math.round(v.quantity * 100) / 100,
    uqc: v.uqc,
    taxableValue: Math.round(v.taxableValue * 100) / 100,
    cgst: Math.round(v.cgst * 100) / 100,
    sgst: Math.round(v.sgst * 100) / 100,
    igst: Math.round(v.igst * 100) / 100,
    totalTax: Math.round((v.cgst + v.sgst + v.igst) * 100) / 100,
  })).sort((a, b) => a.hsnCode.localeCompare(b.hsnCode));

  return res.json({ month, year, items });
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
  const lowStockProducts = mapped.filter(p => {
    const threshold = p.lowStockThreshold ?? 5;
    return p.stockQuantity < threshold;
  }).length;
  return res.json({ totalProducts: mapped.length, totalStockValue: Math.round(totalStockValue * 100) / 100, lowStockProducts, products: mapped });
});

export default router;
