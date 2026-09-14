import { Router } from "express";
import { db, productsTable } from "@workspace/db";
import { eq, ilike, and, lte, sql, count } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { dec, toColumn, toJson } from "../lib/money";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import { ListProductsQuery, CreateProductBody, UpdateProductBody, IdParam } from "../schemas";
import type { TenantRequest, IdParams } from "../lib/http";

const router = Router();

/**
 * Handlers in this router run after `requireAuth` and `requireBusiness`, so
 * the caller's tenant is resolved and the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `businessId` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = TenantRequest<any, any, IdParams>;


function mapProduct(p: any) {
  return {
    ...p,
    purchasePrice: p.purchasePrice ? toJson(p.purchasePrice) : null,
    sellingPrice: p.sellingPrice ? toJson(p.sellingPrice) : null,
    gstRate: Number(dec(p.gstRate).toFixed(2)),
    stockQuantity: Number(dec(p.stockQuantity).toFixed(3)),
    lowStockThreshold: p.lowStockThreshold ? Number(dec(p.lowStockThreshold).toFixed(3)) : null,
  };
}

router.get("/", requireAuth, requireBusiness, validateQuery(ListProductsQuery), async (req: Req, res) => {
  const businessId = req.businessId;
  const { search, lowStock, page, limit } = req.validatedQuery;
  const conditions: any[] = [eq(productsTable.businessId, businessId), eq(productsTable.isActive, true)];
  if (search) conditions.push(ilike(productsTable.name, `%${search}%`));
  if (lowStock === "true") {
    conditions.push(lte(sql`CAST(${productsTable.stockQuantity} AS NUMERIC)`, sql`CAST(${productsTable.lowStockThreshold} AS NUMERIC)`));
  }
  const products = await db.select().from(productsTable).where(and(...conditions))
    .limit(limit).offset((page - 1) * limit)
    .orderBy(productsTable.name);
  const [{ count: total }] = await db.select({ count: count() }).from(productsTable).where(and(...conditions));
  return res.json({ products: products.map(mapProduct), total: Number(total) });
});

router.post("/", requireAuth, requireBusiness, validateBody(CreateProductBody), async (req: Req, res) => {
  const businessId = req.businessId;
  const { name, sku, hsnCode, unit, purchasePrice, sellingPrice, gstRate, stockQuantity = 0, lowStockThreshold, description, category } = req.body;
  if (!name || !unit) return res.status(400).json({ error: "name and unit required" });
  const [product] = await db.insert(productsTable).values({
    businessId, name, sku, hsnCode, unit,
    purchasePrice: purchasePrice === undefined || purchasePrice === null ? undefined : toColumn(purchasePrice),
    sellingPrice: sellingPrice === undefined || sellingPrice === null ? undefined : toColumn(sellingPrice),
    gstRate: dec(gstRate ?? 18).toFixed(2),
    stockQuantity: dec(stockQuantity).toFixed(3),
    lowStockThreshold: lowStockThreshold === undefined || lowStockThreshold === null ? undefined : dec(lowStockThreshold).toFixed(3),
    description, category,
  }).returning();
  return res.status(201).json(mapProduct(product));
});

router.get("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: Req, res) => {
  const businessId = req.businessId;
  const [product] = await db.select().from(productsTable).where(and(eq(productsTable.id, req.validatedParams.id), eq(productsTable.businessId, businessId))).limit(1);
  if (!product) return res.status(404).json({ error: "Not found" });
  return res.json(mapProduct(product));
});

router.patch("/:id", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdateProductBody), async (req: Req, res) => {
  const businessId = req.businessId;
  const fields = ["name","sku","hsnCode","unit","description","category","isActive"];
  // Money to two places, quantities to three — matching the column scales, so
  // nothing is silently re-rounded on the way in.
  const moneyFields = ["purchasePrice", "sellingPrice"];
  const quantityFields = ["stockQuantity", "lowStockThreshold"];
  const updates: any = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
  for (const f of moneyFields) if (req.body[f] !== undefined) updates[f] = req.body[f] === null ? null : toColumn(req.body[f]);
  for (const f of quantityFields) if (req.body[f] !== undefined) updates[f] = req.body[f] === null ? null : dec(req.body[f]).toFixed(3);
  if (req.body.gstRate !== undefined) updates.gstRate = dec(req.body.gstRate).toFixed(2);
  const [product] = await db.update(productsTable).set(updates).where(and(eq(productsTable.id, req.validatedParams.id), eq(productsTable.businessId, businessId))).returning();
  if (!product) return res.status(404).json({ error: "Not found" });
  return res.json(mapProduct(product));
});

router.delete("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: Req, res) => {
  const businessId = req.businessId;
  await db.update(productsTable).set({ isActive: false }).where(and(eq(productsTable.id, req.validatedParams.id), eq(productsTable.businessId, businessId)));
  return res.json({ success: true });
});

export default router;
