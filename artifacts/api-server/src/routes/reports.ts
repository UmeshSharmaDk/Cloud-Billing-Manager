import { Router } from "express";
import { db, invoicesTable, purchasesTable, productsTable, businessesTable } from "@workspace/db";
import { buildGstr1Json } from "../lib/gstr1-json";
import { buildTallyXml, type TallyDoc } from "../lib/tally-xml";
import { eq, and, gte, lte, count, desc, sql, sum as sqlSum } from "drizzle-orm";
import { taxInvoice, activePurchase, invoiceSign, signedInvoice } from "../lib/tax-documents";
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
  // Cancelled invoices and proformas are not supplies. Credit notes are, but as
  // a reduction: `netted` carries them negated so every sum below nets, while
  // `mapped` keeps each document's own figures for the list.
  const invoices = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.businessId, businessId), taxInvoice(invoicesTable), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to)));
  const mapped = invoices.map(mapInvoice);
  const netted = mapped.map(signedInvoice);

  const intraState = mapped.filter(i => !i.isInterstate);
  const interState = mapped.filter(i => i.isInterstate);

  // Summed as decimals. Adding two-decimal amounts as floats accumulates
  // representation error, and this figure is filed.
  const totalTaxableValue = sumBy(netted, (i) => i.subtotal);
  const totalCgst = sumBy(netted, (i) => i.cgst);
  const totalSgst = sumBy(netted, (i) => i.sgst);
  const totalIgst = sumBy(netted, (i) => i.igst);
  const totalTax = sum([totalCgst, totalSgst, totalIgst]);
  const totalAmount = sumBy(netted, (i) => i.grandTotal);

  const rateMap = new Map<string, { taxable: ReturnType<typeof dec>; gst: ReturnType<typeof dec> }>();
  for (const inv of netted) {
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
    intraStateTaxable: toJson(sumBy(netted.filter(i => !i.isInterstate), (i) => i.subtotal)),
    interStateCount: interState.length,
    interStateTaxable: toJson(sumBy(netted.filter(i => i.isInterstate), (i) => i.subtotal)),
    byRate,
    invoices: mapped.map(inv => ({ ...inv, taxableAmount: inv.subtotal, totalAmount: inv.grandTotal })),
  });
});

/**
 * GET /reports/gstr1/json — the month's GSTR-1 as a file for the GST portal's
 * offline upload. Same documents as the GSTR-1 report above.
 */
router.get("/gstr1/json", requireAuth, requireBusiness, validateQuery(MonthYearQuery), async (req: Req, res) => {
  const { month, year, from, to } = monthRange(req.validatedQuery);
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, req.businessId)).limit(1);
  if (!business?.gstin) return res.status(400).json({ error: "Add the business GSTIN in Settings before downloading GSTR-1." });
  const invoices = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.businessId, req.businessId), taxInvoice(invoicesTable), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to)))
    .orderBy(invoicesTable.invoiceDate, invoicesTable.invoiceNumber);
  const { json } = buildGstr1Json({
    gstin: business.gstin,
    homeState: business.stateCode ?? business.gstin.slice(0, 2),
    month, year,
    invoices: invoices.map(mapInvoice),
  });
  const name = `GSTR1_${business.gstin.toUpperCase()}_${String(month).padStart(2, "0")}${year}.json`;
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  return res.json(json);
});

/**
 * GET /reports/tally — the month's sales and purchases as TallyPrime vouchers.
 */
router.get("/tally", requireAuth, requireBusiness, validateQuery(MonthYearQuery), async (req: Req, res) => {
  const { month, year, from, to } = monthRange(req.validatedQuery);
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, req.businessId)).limit(1);
  const [invoices, purchases] = await Promise.all([
    db.select().from(invoicesTable)
      .where(and(eq(invoicesTable.businessId, req.businessId), taxInvoice(invoicesTable), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to)))
      .orderBy(invoicesTable.invoiceDate, invoicesTable.invoiceNumber),
    db.select().from(purchasesTable)
      .where(and(eq(purchasesTable.businessId, req.businessId), activePurchase(purchasesTable), gte(purchasesTable.invoiceDate, from), lte(purchasesTable.invoiceDate, to)))
      .orderBy(purchasesTable.invoiceDate, purchasesTable.invoiceNumber),
  ]);
  const docs: TallyDoc[] = [
    ...invoices.map((i) => ({
      kind: "sale" as const, type: i.type, number: i.invoiceNumber, date: i.invoiceDate,
      party: i.customerName, partyGstin: i.customerGstin, subtotal: i.subtotal,
      cgst: i.cgst, sgst: i.sgst, igst: i.igst, tcs: i.tcsAmount, total: i.grandTotal,
    })),
    ...purchases.map((p) => ({
      kind: "purchase" as const, type: "Purchase", number: p.invoiceNumber, date: p.invoiceDate,
      party: p.vendorName, partyGstin: p.vendorGstin, subtotal: p.subtotal,
      cgst: p.cgst, sgst: p.sgst, igst: p.igst, total: p.grandTotal,
    })),
  ];
  const name = `Tally_${(business?.name ?? "books").replace(/[^\w]+/g, "_").slice(0, 40)}_${String(month).padStart(2, "0")}${year}.xml`;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  return res.send(buildTallyXml(docs, business?.name));
});

router.get("/gstr3b", requireAuth, requireBusiness, validateQuery(MonthYearQuery), async (req: Req, res) => {
  const businessId = req.businessId;
  const now = new Date();
  const month = req.validatedQuery.month ?? now.getMonth() + 1;
  const year = req.validatedQuery.year ?? now.getFullYear();
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  // A cancelled bill is not input credit and a cancelled invoice is not output
  // tax; a credit note reduces output tax rather than adding to it.
  const [invoices, purchases] = await Promise.all([
    db.select().from(invoicesTable).where(and(eq(invoicesTable.businessId, businessId), taxInvoice(invoicesTable), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to))),
    db.select().from(purchasesTable).where(and(eq(purchasesTable.businessId, businessId), activePurchase(purchasesTable), gte(purchasesTable.invoiceDate, from), lte(purchasesTable.invoiceDate, to))),
  ]);
  const mappedInv = invoices.map(mapInvoice);
  const nettedInv = mappedInv.map(signedInvoice);
  const mappedPur = purchases.map(mapPurchase);

  const outwardCgst = sumBy(nettedInv, (i) => i.cgst);
  const outwardSgst = sumBy(nettedInv, (i) => i.sgst);
  const outwardIgst = sumBy(nettedInv, (i) => i.igst);
  const outwardTaxable = sumBy(nettedInv, (i) => i.subtotal);

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
    taxInvoice(invoicesTable),
    gte(invoicesTable.invoiceDate, from),
    lte(invoicesTable.invoiceDate, to),
  ];
  // Totals over the whole range, from the database. Credit notes subtract.
  const sign = invoiceSign(invoicesTable);
  const [totals] = await db.select({
    totalSales: sqlSum(sql`${invoicesTable.grandTotal} * ${sign}`),
    totalGst: sqlSum(sql`${invoicesTable.totalGst} * ${sign}`),
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
    activePurchase(purchasesTable),
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
    .where(and(eq(invoicesTable.businessId, businessId), taxInvoice(invoicesTable), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to)));

  type HsnBucket = {
    description: string; uqc: string;
    quantity: ReturnType<typeof dec>; taxableValue: ReturnType<typeof dec>;
    cgst: ReturnType<typeof dec>; sgst: ReturnType<typeof dec>; igst: ReturnType<typeof dec>;
  };
  // A Map, not an object literal: an HSN code is caller-supplied text, and a
  // line coded "constructor" or "__proto__" resolved to a member of
  // `Object.prototype`, so the bucket had no `.plus` and the whole month's
  // report threw a 500.
  const hsnMap = new Map<string, HsnBucket>();

  for (const inv of invoices.map(mapInvoice).map(signedInvoice)) {
    for (const item of inv.items) {
      const hsnCode = String(item.hsnCode || "N/A").trim();
      let bucket = hsnMap.get(hsnCode);
      if (!bucket) {
        bucket = {
          description: item.description ?? item.productName ?? "",
          uqc: item.unit ?? "Nos",
          quantity: dec(0), taxableValue: dec(0), cgst: dec(0), sgst: dec(0), igst: dec(0),
        };
        hsnMap.set(hsnCode, bucket);
      }
      bucket.quantity = bucket.quantity.plus(dec(item.quantity ?? 0));
      bucket.taxableValue = bucket.taxableValue.plus(dec(item.taxableAmount ?? 0));
      bucket.cgst = bucket.cgst.plus(dec(item.cgst ?? 0));
      bucket.sgst = bucket.sgst.plus(dec(item.sgst ?? 0));
      bucket.igst = bucket.igst.plus(dec(item.igst ?? 0));
    }
  }

  const items = [...hsnMap.entries()].map(([hsnCode, v]) => ({
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

const monthRange = (q: { month?: number; year?: number }) => {
  const now = new Date();
  const month = q.month ?? now.getMonth() + 1;
  const year = q.year ?? now.getFullYear();
  const mm = String(month).padStart(2, "0");
  return { month, year, from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}` };
};
/** PAN is characters 3-12 of a GSTIN; TDS/TCS returns are filed against it. */
const panOf = (gstin: string | null) => (gstin && gstin.length >= 12 ? gstin.slice(2, 12) : null);

/**
 * TDS withheld on purchase bills in a month, by section and deductee: what is
 * due to the government by the 7th of the next month and goes into Form 26Q.
 */
router.get("/tds", requireAuth, requireBusiness, validateQuery(MonthYearQuery), async (req: Req, res) => {
  const r = monthRange(req.validatedQuery);
  const rows = await db.select().from(purchasesTable).where(and(
    eq(purchasesTable.businessId, req.businessId), activePurchase(purchasesTable),
    gte(purchasesTable.invoiceDate, r.from), lte(purchasesTable.invoiceDate, r.to),
    sql`${purchasesTable.tdsAmount} > 0`,
  ));
  const entries = rows.map((p) => ({
    id: p.id, section: p.tdsSection ?? "—", vendorName: p.vendorName, pan: panOf(p.vendorGstin),
    billNumber: p.invoiceNumber, date: p.invoiceDate, taxable: toJson(p.subtotal), rate: Number(p.tdsRate), tds: toJson(p.tdsAmount),
  }));
  const bySection = new Map<string, { section: string; bills: number; taxable: ReturnType<typeof dec>; tds: ReturnType<typeof dec> }>();
  for (const p of rows) {
    const k = p.tdsSection ?? "—";
    const s = bySection.get(k) ?? { section: k, bills: 0, taxable: dec(0), tds: dec(0) };
    s.bills++; s.taxable = s.taxable.plus(dec(p.subtotal)); s.tds = s.tds.plus(dec(p.tdsAmount));
    bySection.set(k, s);
  }
  return res.json({
    month: r.month, year: r.year,
    totalTds: toJson(sumBy(rows, (p) => p.tdsAmount)),
    sections: [...bySection.values()].map((s) => ({ section: s.section, bills: s.bills, taxable: toJson(s.taxable), tds: toJson(s.tds) })),
    entries,
  });
});

/** TCS collected on sales in a month, by customer: Form 27EQ. */
router.get("/tcs", requireAuth, requireBusiness, validateQuery(MonthYearQuery), async (req: Req, res) => {
  const r = monthRange(req.validatedQuery);
  const rows = await db.select().from(invoicesTable).where(and(
    eq(invoicesTable.businessId, req.businessId), taxInvoice(invoicesTable),
    gte(invoicesTable.invoiceDate, r.from), lte(invoicesTable.invoiceDate, r.to),
    sql`${invoicesTable.tcsAmount} > 0`,
  ));
  return res.json({
    month: r.month, year: r.year,
    totalTcs: toJson(sumBy(rows, (i) => i.tcsAmount)),
    entries: rows.map((i) => ({
      id: i.id, customerName: i.customerName, pan: panOf(i.customerGstin), invoiceNumber: i.invoiceNumber,
      date: i.invoiceDate, amount: toJson(dec(i.subtotal).plus(dec(i.totalGst))), rate: Number(i.tcsRate), tcs: toJson(i.tcsAmount),
    })),
  });
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
