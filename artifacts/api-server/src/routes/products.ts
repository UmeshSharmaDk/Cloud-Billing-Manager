import { Router } from "express";
import { db, productsTable, usersTable } from "@workspace/db";
import { eq, ilike, and, lte, sql, count } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

async function getBusinessId(userId: number): Promise<number | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.businessId ?? null;
}

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

router.get("/", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const { search, lowStock, page = "1", limit = "20" } = req.query as any;
  const conditions: any[] = [eq(productsTable.businessId, businessId), eq(productsTable.isActive, true)];
  if (search) conditions.push(ilike(productsTable.name, `%${search}%`));
  if (lowStock === "true") {
    conditions.push(lte(sql`CAST(${productsTable.stockQuantity} AS NUMERIC)`, sql`CAST(${productsTable.lowStockThreshold} AS NUMERIC)`));
  }
  const products = await db.select().from(productsTable).where(and(...conditions))
    .limit(parseInt(limit)).offset((parseInt(page) - 1) * parseInt(limit))
    .orderBy(productsTable.name);
  const [{ count: total }] = await db.select({ count: count() }).from(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.isActive, true)));
  return res.json({ products: products.map(mapProduct), total: Number(total) });
});

router.post("/", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
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

router.get("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  const [product] = await db.select().from(productsTable).where(and(eq(productsTable.id, parseInt(req.params.id)), eq(productsTable.businessId, businessId!))).limit(1);
  if (!product) return res.status(404).json({ error: "Not found" });
  return res.json(mapProduct(product));
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  const fields = ["name","sku","hsnCode","unit","description","category","isActive"];
  const numericFields = ["purchasePrice","sellingPrice","gstRate","stockQuantity","lowStockThreshold"];
  const updates: any = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
  for (const f of numericFields) if (req.body[f] !== undefined) updates[f] = req.body[f]?.toString();
  const [product] = await db.update(productsTable).set(updates).where(and(eq(productsTable.id, parseInt(req.params.id)), eq(productsTable.businessId, businessId!))).returning();
  if (!product) return res.status(404).json({ error: "Not found" });
  return res.json(mapProduct(product));
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  await db.update(productsTable).set({ isActive: false }).where(and(eq(productsTable.id, parseInt(req.params.id)), eq(productsTable.businessId, businessId!)));
  return res.json({ success: true });
});

export default router;
