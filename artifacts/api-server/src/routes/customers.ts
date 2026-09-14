import { Router } from "express";
import { db, customersTable } from "@workspace/db";
import { eq, ilike, and, count } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import { ListPartiesQuery, CreateCustomerBody, UpdateCustomerBody, IdParam } from "../schemas";
import type { TenantRequest, IdParams } from "../lib/http";

const router = Router();

/**
 * Handlers in this router run after `requireAuth` and `requireBusiness`, so
 * the caller's tenant is resolved and the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `businessId` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = TenantRequest<any, any, IdParams>;


router.get("/", requireAuth, requireBusiness, validateQuery(ListPartiesQuery), async (req: Req, res) => {
  const businessId = req.businessId;
  const { search, page, limit } = req.validatedQuery;
  const conditions: any[] = [eq(customersTable.businessId, businessId)];
  if (search) conditions.push(ilike(customersTable.name, `%${search}%`));
  const customers = await db.select().from(customersTable).where(and(...conditions))
    .limit(limit).offset((page - 1) * limit)
    .orderBy(customersTable.name);
  const [{ count: total }] = await db.select({ count: count() }).from(customersTable).where(and(...conditions));
  return res.json({ customers, total: Number(total) });
});

router.post("/", requireAuth, requireBusiness, validateBody(CreateCustomerBody), async (req: Req, res) => {
  const businessId = req.businessId;
  const { name, gstin, phone, email, address, city, state, stateCode, pincode, creditLimit } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const [customer] = await db.insert(customersTable).values({
    businessId, name, gstin, phone, email, address, city, state, stateCode, pincode,
    creditLimit: creditLimit?.toString(),
  }).returning();
  return res.status(201).json(customer);
});

router.get("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: Req, res) => {
  const businessId = req.businessId;
  const [customer] = await db.select().from(customersTable).where(and(eq(customersTable.id, req.validatedParams.id), eq(customersTable.businessId, businessId))).limit(1);
  if (!customer) return res.status(404).json({ error: "Not found" });
  return res.json(customer);
});

router.patch("/:id", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdateCustomerBody), async (req: Req, res) => {
  const businessId = req.businessId;
  const fields = ["name","gstin","phone","email","address","city","state","stateCode","pincode","creditLimit"];
  const updates: any = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = f === "creditLimit" ? req.body[f]?.toString() : req.body[f];
  }
  const [customer] = await db.update(customersTable).set(updates).where(and(eq(customersTable.id, req.validatedParams.id), eq(customersTable.businessId, businessId))).returning();
  if (!customer) return res.status(404).json({ error: "Not found" });
  return res.json(customer);
});

router.delete("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: Req, res) => {
  const businessId = req.businessId;
  await db.delete(customersTable).where(and(eq(customersTable.id, req.validatedParams.id), eq(customersTable.businessId, businessId)));
  return res.json({ success: true });
});

export default router;
