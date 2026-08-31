import { Router } from "express";
import { db, paymentsTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody, validateQuery } from "../middleware/validate";
import { ListPaymentsQuery, CreatePaymentBody } from "../schemas";

const router = Router();

function mapPayment(p: any) {
  return { ...p, amount: parseFloat(p.amount) };
}

router.get("/", requireAuth, requireBusiness, validateQuery(ListPaymentsQuery), async (req: any, res) => {
  const businessId = req.businessId;
  const { type, page, limit } = req.validatedQuery;
  const conditions: any[] = [eq(paymentsTable.businessId, businessId)];
  if (type) conditions.push(eq(paymentsTable.type, type));
  const payments = await db.select().from(paymentsTable).where(and(...conditions))
    .limit(limit).offset((page - 1) * limit)
    .orderBy(desc(paymentsTable.createdAt));
  const [{ count: total }] = await db.select({ count: count() }).from(paymentsTable).where(and(...conditions));
  return res.json({ payments: payments.map(mapPayment), total: Number(total) });
});

router.post("/", requireAuth, requireBusiness, validateBody(CreatePaymentBody), async (req: any, res) => {
  const businessId = req.businessId;
  const { type, amount, date, mode, referenceNumber, invoiceId, customerId, vendorId, notes } = req.body;
  if (!type || !amount || !date || !mode) return res.status(400).json({ error: "Required fields missing" });
  const [payment] = await db.insert(paymentsTable).values({
    businessId, type, amount: amount.toString(), date, mode,
    referenceNumber, invoiceId, customerId, vendorId, notes,
  }).returning();
  return res.status(201).json(mapPayment(payment));
});

export default router;
