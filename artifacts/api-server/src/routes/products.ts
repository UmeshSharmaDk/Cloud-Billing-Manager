import { Router } from "express";
import { db, productsTable } from "@workspace/db";
import { eq, ilike, and, lte, sql, count } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import { ListProductsQuery, CreateProductBody, UpdateProductBody, IdParam } from "../schemas";

const router = Router();

function mapProduct(p: any) {
  return {
    ...p,
    purchasePrice: p.purchasePrice ? parseFloat(p.purchasePrice) : null,
    sellingPrice: p.sellingPrice ? parseFloat(p.sellingPrice) : null,
    gstRate: parseFloat(p.gstRate),
    stockQuantity: parseFloat(p.stockQuantity),
    lowStockThreshold: p.lowStockThreshold ? parseFloat(p.lowStockThreshold) : null,
  };
}

router.get("/", requireAuth, requireBusiness, validateQuery(ListProductsQuery), async (req: any, res) => {
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

router.post("/", requireAuth, requireBusiness, validateBody(CreateProductBody), async (req: any, res) => {
  const businessId = req.businessId;
  const { name, sku, hsnCode, unit, purchasePrice, sellingPrice, gstRate, stockQuantity = 0, lowStockThreshold, description, category } = req.body;
  if (!name || !unit) return res.status(400).json({ error: "name and unit required" });
  const [product] = await db.insert(productsTable).values({
    businessId, name, sku, hsnCode, unit,
    purchasePrice: purchasePrice?.toString(),
    sellingPrice: sellingPrice?.toString(),
    gstRate: (gstRate ?? 18).toString(),
    stockQuantity: stockQuantity.toString(),
    lowStockThreshold: lowStockThreshold?.toString(),
    description, category,
  }).returning();
  return res.status(201).json(mapProduct(product));
});

router.get("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: any, res) => {
  const businessId = req.businessId;
  const [product] = await db.select().from(productsTable).where(and(eq(productsTable.id, req.validatedParams.id), eq(productsTable.businessId, businessId))).limit(1);
  if (!product) return res.status(404).json({ error: "Not found" });
  return res.json(mapProduct(product));
});

router.patch("/:id", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdateProductBody), async (req: any, res) => {
  const businessId = req.businessId;
  const fields = ["name","sku","hsnCode","unit","description","category","isActive"];
  const numericFields = ["purchasePrice","sellingPrice","gstRate","stockQuantity","lowStockThreshold"];
  const updates: any = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
  for (const f of numericFields) if (req.body[f] !== undefined) updates[f] = req.body[f]?.toString();
  const [product] = await db.update(productsTable).set(updates).where(and(eq(productsTable.id, req.validatedParams.id), eq(productsTable.businessId, businessId))).returning();
  if (!product) return res.status(404).json({ error: "Not found" });
  return res.json(mapProduct(product));
});

router.delete("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: any, res) => {
  const businessId = req.businessId;
  await db.update(productsTable).set({ isActive: false }).where(and(eq(productsTable.id, req.validatedParams.id), eq(productsTable.businessId, businessId)));
  return res.json({ success: true });
});

export default router;
