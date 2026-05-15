import { Router } from "express";
import { db, paymentsTable, usersTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

async function getBusinessId(userId: number): Promise<number | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.businessId ?? null;
}

function mapPayment(p: any) {
  return { ...p, amount: parseFloat(p.amount) };
}

router.get("/", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const { type, page = "1", limit = "20" } = req.query as any;
  const conditions: any[] = [eq(paymentsTable.businessId, businessId)];
  if (type) conditions.push(eq(paymentsTable.type, type));
  const payments = await db.select().from(paymentsTable).where(and(...conditions))
    .limit(parseInt(limit)).offset((parseInt(page) - 1) * parseInt(limit))
    .orderBy(desc(paymentsTable.createdAt));
  const [{ count: total }] = await db.select({ count: count() }).from(paymentsTable).where(eq(paymentsTable.businessId, businessId));
  return res.json({ payments: payments.map(mapPayment), total: Number(total) });
});

router.post("/", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const { type, amount, date, mode, referenceNumber, invoiceId, customerId, vendorId, notes } = req.body;
  if (!type || !amount || !date || !mode) return res.status(400).json({ error: "Required fields missing" });
  const [payment] = await db.insert(paymentsTable).values({
    businessId, type, amount: amount.toString(), date, mode,
    referenceNumber, invoiceId, customerId, vendorId, notes,
  }).returning();
  return res.status(201).json(mapPayment(payment));
});

export default router;
