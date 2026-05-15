import { Router } from "express";
import { db, businessesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

router.get("/", requireAuth, async (req: any, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
  if (!user?.businessId) return res.status(404).json({ error: "Business not found" });
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, user.businessId)).limit(1);
  if (!business) return res.status(404).json({ error: "Business not found" });
  return res.json(business);
});

router.patch("/", requireAuth, async (req: any, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
  if (!user?.businessId) return res.status(404).json({ error: "Business not found" });
  const fields = ["name","gstin","pan","address","city","state","stateCode","pincode","phone","email","website","invoicePrefix","bankName","bankAccount","bankIfsc","bankBranch","termsConditions"];
  const updates: any = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const [business] = await db.update(businessesTable).set(updates).where(eq(businessesTable.id, user.businessId)).returning();
  return res.json(business);
});

export default router;
