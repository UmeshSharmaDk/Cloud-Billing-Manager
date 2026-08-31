import { Router } from "express";
import { db, vendorsTable } from "@workspace/db";
import { eq, ilike, and, count } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import { ListPartiesQuery, CreateVendorBody, UpdateVendorBody, IdParam } from "../schemas";

const router = Router();

router.get("/", requireAuth, requireBusiness, validateQuery(ListPartiesQuery), async (req: any, res) => {
  const businessId = req.businessId;
  const { search, page, limit } = req.validatedQuery;
  const conditions: any[] = [eq(vendorsTable.businessId, businessId)];
  if (search) conditions.push(ilike(vendorsTable.name, `%${search}%`));
  const vendors = await db.select().from(vendorsTable).where(and(...conditions))
    .limit(limit).offset((page - 1) * limit)
    .orderBy(vendorsTable.name);
  const [{ count: total }] = await db.select({ count: count() }).from(vendorsTable).where(and(...conditions));
  return res.json({ vendors, total: Number(total) });
});

router.post("/", requireAuth, requireBusiness, validateBody(CreateVendorBody), async (req: any, res) => {
  const businessId = req.businessId;
  const { name, gstin, phone, email, address, city, state, stateCode, pincode } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const [vendor] = await db.insert(vendorsTable).values({
    businessId, name, gstin, phone, email, address, city, state, stateCode, pincode,
  }).returning();
  return res.status(201).json(vendor);
});

router.get("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: any, res) => {
  const businessId = req.businessId;
  const [vendor] = await db.select().from(vendorsTable).where(and(eq(vendorsTable.id, req.validatedParams.id), eq(vendorsTable.businessId, businessId))).limit(1);
  if (!vendor) return res.status(404).json({ error: "Not found" });
  return res.json(vendor);
});

router.patch("/:id", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdateVendorBody), async (req: any, res) => {
  const businessId = req.businessId;
  const fields = ["name","gstin","phone","email","address","city","state","stateCode","pincode"];
  const updates: any = {};
  for (const f of fields) if (req.body[f] !== undefined) updates[f] = req.body[f];
  const [vendor] = await db.update(vendorsTable).set(updates).where(and(eq(vendorsTable.id, req.validatedParams.id), eq(vendorsTable.businessId, businessId))).returning();
  if (!vendor) return res.status(404).json({ error: "Not found" });
  return res.json(vendor);
});

router.delete("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: any, res) => {
  const businessId = req.businessId;
  await db.delete(vendorsTable).where(and(eq(vendorsTable.id, req.validatedParams.id), eq(vendorsTable.businessId, businessId)));
  return res.json({ success: true });
});

export default router;
