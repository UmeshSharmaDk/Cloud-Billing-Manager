import { Router } from "express";
import { db, vendorsTable, usersTable } from "@workspace/db";
import { eq, ilike, and, count } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

async function getBusinessId(userId: number): Promise<number | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.businessId ?? null;
}

router.get("/", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const { search, page = "1", limit = "20" } = req.query as any;
  const conditions: any[] = [eq(vendorsTable.businessId, businessId)];
  if (search) conditions.push(ilike(vendorsTable.name, `%${search}%`));
  const vendors = await db.select().from(vendorsTable).where(and(...conditions))
    .limit(parseInt(limit)).offset((parseInt(page) - 1) * parseInt(limit))
    .orderBy(vendorsTable.name);
  const [{ count: total }] = await db.select({ count: count() }).from(vendorsTable).where(eq(vendorsTable.businessId, businessId));
  return res.json({ vendors, total: Number(total) });
});

router.post("/", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const { name, gstin, phone, email, address, city, state, stateCode, pincode } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const [vendor] = await db.insert(vendorsTable).values({
    businessId, name, gstin, phone, email, address, city, state, stateCode, pincode,
  }).returning();
  return res.status(201).json(vendor);
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  const [vendor] = await db.select().from(vendorsTable).where(and(eq(vendorsTable.id, parseInt(req.params.id)), eq(vendorsTable.businessId, businessId!))).limit(1);
  if (!vendor) return res.status(404).json({ error: "Not found" });
  return res.json(vendor);
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  const fields = ["name","gstin","phone","email","address","city","state","stateCode","pincode"];
  const updates: any = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
  const [vendor] = await db.update(vendorsTable).set(updates).where(and(eq(vendorsTable.id, parseInt(req.params.id)), eq(vendorsTable.businessId, businessId!))).returning();
  if (!vendor) return res.status(404).json({ error: "Not found" });
  return res.json(vendor);
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  await db.delete(vendorsTable).where(and(eq(vendorsTable.id, parseInt(req.params.id)), eq(vendorsTable.businessId, businessId!)));
  return res.json({ success: true });
});

export default router;
