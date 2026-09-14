import { Router } from "express";
import { db, invoicesTable, purchasesTable, productsTable } from "@workspace/db";
import { eq, and, gte, lte, count, desc, sum as sqlSum } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateQuery } from "../middleware/validate";
import { MonthYearQuery, DateRangeQuery } from "../schemas";
import { dec, paise, sum, sumBy, toJson } from "../lib/money";
import type { TenantRequest, IdParams } from "../lib/http";
import { mapInvoice, mapPurchase } from "../lib/serialise";
import { isLowStock } from "../lib/low-stock";

const router = Router();

/**
 * Most rows a report will return in one response.
 *
 * These endpoints used to serialise every matched row — a 366-day sales report
 * on an active business is a year of invoices in a single payload, built in
 * memory and held there until it is written. The summary figures are what the
 * page actually shows, and they are now computed in SQL over the *whole* range,
 * so capping the row list costs nothing in accuracy. `truncated` tells a caller
 * the list is a sample rather than the lot.
 */
const REPORT_ROW_CAP = 500;

/**
 * Handlers in this router run after `requireAuth` and `requireBusiness`, so
 * the caller's tenant is resolved and the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `businessId` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = TenantRequest<any, any, IdParams>;


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

router.get("/gstr1", requireAuth, requireBusiness, validateQuery(MonthYearQuery), async (req: Req, res) => {
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

router.get("/gstr3b", requireAuth, requireBusiness, validateQuery(MonthYearQuery), async (req: Req, res) => {
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

router.get("/sales", requireAuth, requireBusiness, validateQuery(DateRangeQuery), async (req: Req, res) => {
  const businessId = req.businessId;
  const { from, to } = reportRange(req.validatedQuery);
  const conditions: any[] = [
    eq(invoicesTable.businessId, businessId),
    gte(invoicesTable.invoiceDate, from),
    lte(invoicesTable.invoiceDate, to),
  ];
  // Totals over the whole range, from the database.
  const [totals] = await db.select({
    totalSales: sqlSum(invoicesTable.grandTotal),
    totalGst: sqlSum(invoicesTable.totalGst),
    invoiceCount: count(),
  }).from(invoicesTable).where(and(...conditions));

  const invoices = await db.select().from(invoicesTable).where(and(...conditions))
    .orderBy(desc(invoicesTable.invoiceDate)).limit(REPORT_ROW_CAP);

  const totalSales = dec(totals.totalSales ?? 0);
  const totalGst = dec(totals.totalGst ?? 0);
  const invoiceCount = Number(totals.invoiceCount);
  return res.json({
    totalSales: toJson(totalSales), totalGst: toJson(totalGst),
    netSales: toJson(totalSales.minus(totalGst)), invoiceCount,
    invoices: invoices.map(mapInvoice), truncated: invoiceCount > invoices.length,
  });
});

router.get("/purchases", requireAuth, requireBusiness, validateQuery(DateRangeQuery), async (req: Req, res) => {
  const businessId = req.businessId;
  const { from, to } = reportRange(req.validatedQuery);
  const conditions: any[] = [
    eq(purchasesTable.businessId, businessId),
    gte(purchasesTable.invoiceDate, from),
    lte(purchasesTable.invoiceDate, to),
  ];
  const [totals] = await db.select({
    totalPurchases: sqlSum(purchasesTable.grandTotal),
    totalGst: sqlSum(purchasesTable.totalGst),
    purchaseCount: count(),
  }).from(purchasesTable).where(and(...conditions));

  const purchases = await db.select().from(purchasesTable).where(and(...conditions))
    .orderBy(desc(purchasesTable.invoiceDate)).limit(REPORT_ROW_CAP);

  const totalPurchases = dec(totals.totalPurchases ?? 0);
  const totalGst = dec(totals.totalGst ?? 0);
  const purchaseCount = Number(totals.purchaseCount);
  return res.json({
    totalPurchases: toJson(totalPurchases), totalGst: toJson(totalGst),
    netPurchases: toJson(totalPurchases.minus(totalGst)), purchaseCount,
    purchases: purchases.map(mapPurchase), truncated: purchaseCount > purchases.length,
  });
});

router.get("/hsn", requireAuth, requireBusiness, validateQuery(MonthYearQuery), async (req: Req, res) => {
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

router.get("/stock", requireAuth, requireBusiness, async (req: Req, res) => {
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
  const lowStockProducts = mapped.filter(isLowStock).length;
  return res.json({ totalProducts: mapped.length, totalStockValue: toJson(totalStockValue), lowStockProducts, products: mapped });
});

export default router;
