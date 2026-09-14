import { Router } from "express";
import { db, businessesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody } from "../middleware/validate";
import { UpdateBusinessBody } from "../schemas";
import type { TenantRequest, IdParams } from "../lib/http";

const router = Router();

/**
 * Handlers in this router run after `requireAuth` and `requireBusiness`, so
 * the caller's tenant is resolved and the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `businessId` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = TenantRequest<any, any, IdParams>;


router.get("/", requireAuth, requireBusiness, async (req: Req, res) => {
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, req.businessId)).limit(1);
  if (!business) return res.status(404).json({ error: "Business not found" });
  return res.json(business);
});

router.patch("/", requireAuth, requireBusiness, validateBody(UpdateBusinessBody), async (req: Req, res) => {
  // The schema has already stripped anything not on the allowlist, so the body
  // can be applied as-is.
  const updates = req.body;
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });
  const [business] = await db.update(businessesTable).set(updates).where(eq(businessesTable.id, req.businessId)).returning();
  if (!business) return res.status(404).json({ error: "Business not found" });
  return res.json(business);
});

export default router;
