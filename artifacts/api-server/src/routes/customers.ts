import { Router } from "express";
import { db, customersTable, usersTable } from "@workspace/db";
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
  const conditions: any[] = [eq(customersTable.businessId, businessId)];
  if (search) conditions.push(ilike(customersTable.name, `%${search}%`));
  const customers = await db.select().from(customersTable).where(and(...conditions))
    .limit(parseInt(limit)).offset((parseInt(page) - 1) * parseInt(limit))
    .orderBy(customersTable.name);
  const [{ count: total }] = await db.select({ count: count() }).from(customersTable).where(eq(customersTable.businessId, businessId));
  return res.json({ customers, total: Number(total) });
});

router.post("/", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const { name, gstin, phone, email, address, city, state, stateCode, pincode, creditLimit } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const [customer] = await db.insert(customersTable).values({
    businessId, name, gstin, phone, email, address, city, state, stateCode, pincode,
    creditLimit: creditLimit?.toString(),
  }).returning();
  return res.status(201).json(customer);
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, parseInt(req.params.id)), eq(customersTable.businessId, businessId!))).limit(1);
  if (!customer) return res.status(404).json({ error: "Not found" });
  return res.json(customer);
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  const fields = ["name","gstin","phone","email","address","city","state","stateCode","pincode","creditLimit"];
  const updates: any = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = f === "creditLimit" ? req.body[f]?.toString() : req.body[f];
  }
  const [customer] = await db.update(customersTable).set(updates).where(and(eq(customersTable.id, parseInt(req.params.id)), eq(customersTable.businessId, businessId!))).returning();
  if (!customer) return res.status(404).json({ error: "Not found" });
  return res.json(customer);
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  await db.delete(customersTable).where(and(eq(customersTable.id, parseInt(req.params.id)), eq(customersTable.businessId, businessId!)));
  return res.json({ success: true });
});

export default router;
