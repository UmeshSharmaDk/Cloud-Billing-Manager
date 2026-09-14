import { Router } from "express";
import { db, invoicesTable, purchasesTable, customersTable, vendorsTable, productsTable } from "@workspace/db";
import { eq, and, gte, lte, ne, sql, desc, count, sum as sqlSum } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { dec, sum, sumBy, toJson } from "../lib/money";
import type { TenantRequest, IdParams } from "../lib/http";

const router = Router();

/**
 * Handlers in this router run after `requireAuth` and `requireBusiness`, so
 * the caller's tenant is resolved and the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `businessId` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = TenantRequest<any, any, IdParams>;


/**
 * Aggregates are computed by the database.
 *
 * Every figure here used to be produced by reading whole tables into memory and
 * adding them up in JavaScript — five full table scans, serialised across the
 * wire, to return ten numbers. The cost grew with the size of the business
 * rather than with the size of the answer.
 */
router.get("/stats", requireAuth, requireBusiness, async (req: Req, res) => {
  const businessId = req.businessId;
  const today = new Date().toISOString().slice(0, 10);

  const [[invoiceAgg], [purchaseAgg], [customerAgg], [vendorAgg], [productAgg]] = await Promise.all([
    db.select({
      count: count(),
      totalSales: sqlSum(invoicesTable.grandTotal),
      totalGst: sqlSum(invoicesTable.totalGst),
      outstanding: sqlSum(
        sql`CASE WHEN ${invoicesTable.status} = 'unpaid' THEN ${invoicesTable.grandTotal} ELSE 0 END`,
      ),
      overdue: sql<number>`count(*) FILTER (
        WHERE ${invoicesTable.dueDate} IS NOT NULL
          AND ${invoicesTable.dueDate} < ${today}
          AND ${invoicesTable.status} <> 'paid'
      )`,
    }).from(invoicesTable).where(eq(invoicesTable.businessId, businessId)),

    db.select({
      totalPurchases: sqlSum(purchasesTable.grandTotal),
      totalGst: sqlSum(purchasesTable.totalGst),
    }).from(purchasesTable).where(eq(purchasesTable.businessId, businessId)),

    db.select({ count: count() }).from(customersTable).where(eq(customersTable.businessId, businessId)),
    db.select({ count: count() }).from(vendorsTable).where(eq(vendorsTable.businessId, businessId)),

    db.select({
      count: count(),
      // The threshold defaults to 5 when unset, matching what the JavaScript did.
      lowStock: sql<number>`count(*) FILTER (
        WHERE ${productsTable.stockQuantity} < COALESCE(${productsTable.lowStockThreshold}, 5)
      )`,
    }).from(productsTable)
      .where(and(eq(productsTable.businessId, businessId), eq(productsTable.isActive, true))),
  ]);

  const totalGstPayable = dec(invoiceAgg.totalGst).minus(dec(purchaseAgg.totalGst));

  return res.json({
    totalSales: toJson(invoiceAgg.totalSales),
    totalPurchases: toJson(purchaseAgg.totalPurchases),
    totalGstPayable: toJson(totalGstPayable),
    totalOutstanding: toJson(invoiceAgg.outstanding),
    invoiceCount: Number(invoiceAgg.count),
    customerCount: Number(customerAgg.count),
    vendorCount: Number(vendorAgg.count),
    productCount: Number(productAgg.count),
    lowStockCount: Number(productAgg.lowStock),
    overdueInvoiceCount: Number(invoiceAgg.overdue),
  });
});

router.get("/recent-invoices", requireAuth, requireBusiness, async (req: Req, res) => {
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

router.get("/monthly-revenue", requireAuth, requireBusiness, async (req: Req, res) => {
  const businessId = req.businessId;

  // Six months in two grouped queries. This was twelve sequential round trips —
  // one per month per table — issued one after another.
  const now = new Date();
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const from = windowStart.toISOString().slice(0, 10);

  const monthOf = (col: any) => sql<string>`substring(${col} from 1 for 7)`;

  const [invRows, purRows] = await Promise.all([
    db.select({
      month: monthOf(invoicesTable.invoiceDate),
      sales: sqlSum(invoicesTable.grandTotal),
      gst: sqlSum(invoicesTable.totalGst),
    }).from(invoicesTable)
      .where(and(eq(invoicesTable.businessId, businessId), gte(invoicesTable.invoiceDate, from)))
      .groupBy(monthOf(invoicesTable.invoiceDate)),

    db.select({
      month: monthOf(purchasesTable.invoiceDate),
      purchases: sqlSum(purchasesTable.grandTotal),
    }).from(purchasesTable)
      .where(and(eq(purchasesTable.businessId, businessId), gte(purchasesTable.invoiceDate, from)))
      .groupBy(monthOf(purchasesTable.invoiceDate)),
  ]);

  const invByMonth = new Map(invRows.map((r) => [r.month, r]));
  const purByMonth = new Map(purRows.map((r) => [r.month, r]));

  // Months with no activity still need a row, so the series is continuous.
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({
      month: d.toLocaleString("en-IN", { month: "short", year: "numeric" }),
      sales: dec(invByMonth.get(key)?.sales ?? 0).toDecimalPlaces(0).toNumber(),
      purchases: dec(purByMonth.get(key)?.purchases ?? 0).toDecimalPlaces(0).toNumber(),
      gst: dec(invByMonth.get(key)?.gst ?? 0).toDecimalPlaces(0).toNumber(),
    });
  }
  return res.json(months);
});

router.get("/top-products", requireAuth, requireBusiness, async (req: Req, res) => {
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

router.get("/gst-summary", requireAuth, requireBusiness, async (req: Req, res) => {
  const businessId = req.businessId;
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const [[out], [inp]] = await Promise.all([
    db.select({
      cgst: sqlSum(invoicesTable.cgst), sgst: sqlSum(invoicesTable.sgst), igst: sqlSum(invoicesTable.igst),
    }).from(invoicesTable)
      .where(and(eq(invoicesTable.businessId, businessId), gte(invoicesTable.invoiceDate, from))),
    db.select({
      cgst: sqlSum(purchasesTable.cgst), sgst: sqlSum(purchasesTable.sgst), igst: sqlSum(purchasesTable.igst),
    }).from(purchasesTable)
      .where(and(eq(purchasesTable.businessId, businessId), gte(purchasesTable.invoiceDate, from))),
  ]);

  const netPayable = sum([out.cgst, out.sgst, out.igst]).minus(sum([inp.cgst, inp.sgst, inp.igst]));

  return res.json({
    outputCgst: toJson(out.cgst), outputSgst: toJson(out.sgst), outputIgst: toJson(out.igst),
    inputCgst: toJson(inp.cgst), inputSgst: toJson(inp.sgst), inputIgst: toJson(inp.igst),
    netPayable: toJson(netPayable),
  });
});

router.get("/low-stock", requireAuth, requireBusiness, async (req: Req, res) => {
  const businessId = req.businessId;
  // Filtered in SQL rather than by reading the whole catalog and discarding
  // most of it, and capped so a large catalog cannot return unboundedly.
  const lowStock = await db.select().from(productsTable)
    .where(and(
      eq(productsTable.businessId, businessId),
      eq(productsTable.isActive, true),
      sql`${productsTable.stockQuantity} < COALESCE(${productsTable.lowStockThreshold}, 5)`,
    ))
    .orderBy(productsTable.name)
    .limit(100);
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
