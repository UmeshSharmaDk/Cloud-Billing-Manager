import { Router } from "express";
import { db, invoicesTable, purchasesTable, productsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateQuery } from "../middleware/validate";
import { MonthYearQuery, DateRangeQuery } from "../schemas";
import { dec, paise, sum, sumBy, toJson } from "../lib/money";

const router = Router();

/**
 * Resolve a report window. The span itself is capped by `DateRangeQuery`; this
 * supplies the other half — an absent range used to mean "every invoice this
 * business has ever raised", read into memory and serialised in one response.
 * An unspecified range now means the current month.
 */
function reportRange(q: { fromDate?: string; toDate?: string }): { from: string; to: string } {
  if (q.fromDate && q.toDate) return { from: q.fromDate, to: q.toDate };
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: q.fromDate ?? `${y}-${pad(m)}-01`,
    to: q.toDate ?? `${y}-${pad(m)}-${pad(lastDay)}`,
  };
}

function mapInvoice(inv: any) {
  return {
    ...inv, subtotal: toJson(inv.subtotal), cgst: toJson(inv.cgst),
    sgst: toJson(inv.sgst), igst: toJson(inv.igst), totalGst: toJson(inv.totalGst),
    grandTotal: toJson(inv.grandTotal), roundOff: toJson(inv.roundOff),
    paidAmount: toJson(inv.paidAmount), items: Array.isArray(inv.items) ? inv.items : [],
  };
}

function mapPurchase(p: any) {
  return {
    ...p, subtotal: toJson(p.subtotal), cgst: toJson(p.cgst), sgst: toJson(p.sgst),
    igst: toJson(p.igst), totalGst: toJson(p.totalGst), grandTotal: toJson(p.grandTotal),
    items: Array.isArray(p.items) ? p.items : [],
  };
}

router.get("/gstr1", requireAuth, requireBusiness, validateQuery(MonthYearQuery), async (req: any, res) => {
  const businessId = req.businessId;
  const now = new Date();
  const month = req.validatedQuery.month ?? now.getMonth() + 1;
  const year = req.validatedQuery.year ?? now.getFullYear();
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const invoices = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.businessId, businessId), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to)));
  const mapped = invoices.map(mapInvoice);

  const intraState = mapped.filter(i => !i.isInterstate);
  const interState = mapped.filter(i => i.isInterstate);

  // Summed as decimals. Adding two-decimal amounts as floats accumulates
  // representation error, and this figure is filed.
  const totalTaxableValue = sumBy(mapped, (i) => i.subtotal);
  const totalCgst = sumBy(mapped, (i) => i.cgst);
  const totalSgst = sumBy(mapped, (i) => i.sgst);
  const totalIgst = sumBy(mapped, (i) => i.igst);
  const totalTax = sum([totalCgst, totalSgst, totalIgst]);
  const totalAmount = sumBy(mapped, (i) => i.grandTotal);

  const rateMap = new Map<string, { taxable: ReturnType<typeof dec>; gst: ReturnType<typeof dec> }>();
  for (const inv of mapped) {
    for (const item of inv.items) {
      const rate = dec(item.gstRate ?? 0).toFixed(2);
      const bucket = rateMap.get(rate) ?? { taxable: dec(0), gst: dec(0) };
      bucket.taxable = bucket.taxable.plus(dec(item.taxableAmount ?? 0));
      bucket.gst = bucket.gst.plus(sum([item.cgst ?? 0, item.sgst ?? 0, item.igst ?? 0]));
      rateMap.set(rate, bucket);
    }
  }
  const byRate = [...rateMap.entries()]
    .map(([rate, v]) => ({ rate: Number(rate), taxable: toJson(v.taxable), gst: toJson(v.gst) }))
    .sort((a, b) => a.rate - b.rate);

  return res.json({
    month, year,
    totalInvoices: mapped.length,
    totalTaxable: toJson(totalTaxableValue),
    totalGst: toJson(totalTax),
    totalAmount: toJson(totalAmount),
    totalTaxableValue: toJson(totalTaxableValue),
    totalCgst: toJson(totalCgst),
    totalSgst: toJson(totalSgst),
    totalIgst: toJson(totalIgst),
    totalTax: toJson(totalTax),
    intraStateCount: intraState.length,
    intraStateTaxable: toJson(sumBy(intraState, (i) => i.subtotal)),
    interStateCount: interState.length,
    interStateTaxable: toJson(sumBy(interState, (i) => i.subtotal)),
    byRate,
    invoices: mapped.map(inv => ({ ...inv, taxableAmount: inv.subtotal, totalAmount: inv.grandTotal })),
  });
});

router.get("/gstr3b", requireAuth, requireBusiness, validateQuery(MonthYearQuery), async (req: any, res) => {
  const businessId = req.businessId;
  const now = new Date();
  const month = req.validatedQuery.month ?? now.getMonth() + 1;
  const year = req.validatedQuery.year ?? now.getFullYear();
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const [invoices, purchases] = await Promise.all([
    db.select().from(invoicesTable).where(and(eq(invoicesTable.businessId, businessId), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to))),
    db.select().from(purchasesTable).where(and(eq(purchasesTable.businessId, businessId), gte(purchasesTable.invoiceDate, from), lte(purchasesTable.invoiceDate, to))),
  ]);
  const mappedInv = invoices.map(mapInvoice);
  const mappedPur = purchases.map(mapPurchase);

  const outwardCgst = sumBy(mappedInv, (i) => i.cgst);
  const outwardSgst = sumBy(mappedInv, (i) => i.sgst);
  const outwardIgst = sumBy(mappedInv, (i) => i.igst);
  const outwardTaxable = sumBy(mappedInv, (i) => i.subtotal);

  const inputCgst = sumBy(mappedPur, (p) => p.cgst);
  const inputSgst = sumBy(mappedPur, (p) => p.sgst);
  const inputIgst = sumBy(mappedPur, (p) => p.igst);

  const atLeastZero = (d: ReturnType<typeof dec>) => (d.isNegative() ? dec(0) : d);
  const netCgst = atLeastZero(outwardCgst.minus(inputCgst));
  const netSgst = atLeastZero(outwardSgst.minus(inputSgst));
  const netIgst = atLeastZero(outwardIgst.minus(inputIgst));
  const netTax = sum([outwardCgst, outwardSgst, outwardIgst])
    .minus(sum([inputCgst, inputSgst, inputIgst]));

  return res.json({
    month, year,
    outwardTaxable: toJson(outwardTaxable),
    outwardCgst: toJson(outwardCgst),
    outwardSgst: toJson(outwardSgst),
    outwardIgst: toJson(outwardIgst),
    inputCgst: toJson(inputCgst),
    inputSgst: toJson(inputSgst),
    inputIgst: toJson(inputIgst),
    netCgst: toJson(netCgst),
    netSgst: toJson(netSgst),
    netIgst: toJson(netIgst),
    totalTax: toJson(netTax),
    totalTaxableValue: toJson(outwardTaxable),
    totalCgst: toJson(outwardCgst),
    totalSgst: toJson(outwardSgst),
    totalIgst: toJson(outwardIgst),
    invoices: mappedInv.map(inv => ({ ...inv, taxableAmount: inv.subtotal, totalAmount: inv.grandTotal })),
  });
});

router.get("/sales", requireAuth, requireBusiness, validateQuery(DateRangeQuery), async (req: any, res) => {
  const businessId = req.businessId;
  const { from, to } = reportRange(req.validatedQuery);
  const conditions: any[] = [
    eq(invoicesTable.businessId, businessId),
    gte(invoicesTable.invoiceDate, from),
    lte(invoicesTable.invoiceDate, to),
  ];
  const invoices = await db.select().from(invoicesTable).where(and(...conditions));
  const mapped = invoices.map(mapInvoice);
  const totalSales = sumBy(mapped, (i) => i.grandTotal);
  const totalGst = sumBy(mapped, (i) => i.totalGst);
  return res.json({ totalSales: toJson(totalSales), totalGst: toJson(totalGst), netSales: toJson(totalSales.minus(totalGst)), invoiceCount: mapped.length, invoices: mapped });
});

router.get("/purchases", requireAuth, requireBusiness, validateQuery(DateRangeQuery), async (req: any, res) => {
  const businessId = req.businessId;
  const { from, to } = reportRange(req.validatedQuery);
  const conditions: any[] = [
    eq(purchasesTable.businessId, businessId),
    gte(purchasesTable.invoiceDate, from),
    lte(purchasesTable.invoiceDate, to),
  ];
  const purchases = await db.select().from(purchasesTable).where(and(...conditions));
  const mapped = purchases.map(mapPurchase);
  const totalPurchases = sumBy(mapped, (p) => p.grandTotal);
  const totalGst = sumBy(mapped, (p) => p.totalGst);
  return res.json({ totalPurchases: toJson(totalPurchases), totalGst: toJson(totalGst), netPurchases: toJson(totalPurchases.minus(totalGst)), purchaseCount: mapped.length, purchases: mapped });
});

router.get("/hsn", requireAuth, requireBusiness, validateQuery(MonthYearQuery), async (req: any, res) => {
  const businessId = req.businessId;
  const now = new Date();
  const month = req.validatedQuery.month ?? now.getMonth() + 1;
  const year = req.validatedQuery.year ?? now.getFullYear();
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const invoices = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.businessId, businessId), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to)));

  type HsnBucket = {
    description: string; uqc: string;
    quantity: ReturnType<typeof dec>; taxableValue: ReturnType<typeof dec>;
    cgst: ReturnType<typeof dec>; sgst: ReturnType<typeof dec>; igst: ReturnType<typeof dec>;
  };
  const hsnMap: Record<string, HsnBucket> = {};

  for (const inv of invoices) {
    const items = Array.isArray(inv.items) ? inv.items : [];
    for (const item of items) {
      const hsnCode = String(item.hsnCode || "N/A").trim();
      if (!hsnMap[hsnCode]) {
        hsnMap[hsnCode] = {
          description: item.description ?? item.productName ?? "",
          uqc: item.unit ?? "Nos",
          quantity: dec(0), taxableValue: dec(0), cgst: dec(0), sgst: dec(0), igst: dec(0),
        };
      }
      const bucket = hsnMap[hsnCode];
      bucket.quantity = bucket.quantity.plus(dec(item.quantity ?? 0));
      bucket.taxableValue = bucket.taxableValue.plus(dec(item.taxableAmount ?? 0));
      bucket.cgst = bucket.cgst.plus(dec(item.cgst ?? 0));
      bucket.sgst = bucket.sgst.plus(dec(item.sgst ?? 0));
      bucket.igst = bucket.igst.plus(dec(item.igst ?? 0));
    }
  }

  const items = Object.entries(hsnMap).map(([hsnCode, v]) => ({
    hsnCode,
    description: v.description,
    quantity: toJson(v.quantity),
    uqc: v.uqc,
    taxableValue: toJson(v.taxableValue),
    cgst: toJson(v.cgst),
    sgst: toJson(v.sgst),
    igst: toJson(v.igst),
    totalTax: toJson(sum([v.cgst, v.sgst, v.igst])),
  })).sort((a, b) => a.hsnCode.localeCompare(b.hsnCode));

  return res.json({ month, year, items });
});

router.get("/stock", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;
  const products = await db.select().from(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.isActive, true)));
  const mapped = products.map(p => ({
    ...p,
    purchasePrice: p.purchasePrice ? toJson(p.purchasePrice) : null,
    sellingPrice: p.sellingPrice ? toJson(p.sellingPrice) : null,
    gstRate: Number(dec(p.gstRate).toFixed(2)),
    stockQuantity: Number(dec(p.stockQuantity).toFixed(3)),
    lowStockThreshold: p.lowStockThreshold ? Number(dec(p.lowStockThreshold).toFixed(3)) : null,
  }));
  const totalStockValue = mapped.reduce(
    (acc, p) => acc.plus(dec(p.sellingPrice ?? 0).times(dec(p.stockQuantity))), dec(0));
  const lowStockProducts = mapped.filter(p => {
    const threshold = p.lowStockThreshold ?? 5;
    return p.stockQuantity < threshold;
  }).length;
  return res.json({ totalProducts: mapped.length, totalStockValue: toJson(totalStockValue), lowStockProducts, products: mapped });
});

export default router;
