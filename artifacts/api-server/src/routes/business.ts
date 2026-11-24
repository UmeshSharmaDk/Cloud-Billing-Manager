import { Router } from "express";
import { db, businessesTable, irpCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody } from "../middleware/validate";
import { UpdateBusinessBody, SaveIrpLoginBody } from "../schemas";
import { IRP_SANDBOX, IrpError, irpAuthenticate } from "../lib/irp";
import { saveLogin } from "../lib/irp-store";
import { recordAudit, actorFrom } from "../lib/audit";
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

// GET /business/irp — whether the e-invoice API login is set up. Never returns the secrets.
router.get("/irp", requireAuth, requireBusiness, async (req: Req, res) => {
  const [row] = await db.select().from(irpCredentialsTable).where(eq(irpCredentialsTable.businessId, req.businessId)).limit(1);
  if (!row) return res.json({ configured: false, sandboxUrl: IRP_SANDBOX });
  return res.json({ configured: true, sandboxUrl: IRP_SANDBOX, baseUrl: row.baseUrl, sandbox: row.baseUrl === IRP_SANDBOX, gstin: row.gstin, clientId: row.clientId, username: row.username, updatedAt: row.updatedAt });
});

/**
 * PUT /business/irp — save the e-invoice API login, after logging in with it
 * once, so a typo is caught here rather than on the first invoice.
 */
router.put("/irp", requireAuth, requireBusiness, validateBody(SaveIrpLoginBody), async (req: Req, res) => {
  const [business] = await db.select({ gstin: businessesTable.gstin }).from(businessesTable).where(eq(businessesTable.id, req.businessId)).limit(1);
  if (!business?.gstin) return res.status(400).json({ error: "Add the business GSTIN in Settings first." });
  const login = { ...req.body, baseUrl: (req.body.baseUrl ?? IRP_SANDBOX).replace(/\/+$/, ""), gstin: business.gstin.toUpperCase() };
  try {
    await irpAuthenticate({ ...login, baseUrl: process.env["IRP_BASE_URL"]?.trim() || login.baseUrl });
  } catch (err) {
    return res.status(400).json({ error: `Not saved. ${err instanceof IrpError ? err.message : "The login could not be checked."}` });
  }
  await saveLogin(req.businessId, login);
  await recordAudit({ ...actorFrom(req), action: "business.irp_login_saved", targetType: "business", targetId: req.businessId, businessId: req.businessId, details: { baseUrl: login.baseUrl, username: login.username } });
  return res.json({ configured: true, baseUrl: login.baseUrl, sandbox: login.baseUrl === IRP_SANDBOX, gstin: login.gstin, clientId: login.clientId, username: login.username });
});

router.delete("/irp", requireAuth, requireBusiness, async (req: Req, res) => {
  await db.delete(irpCredentialsTable).where(eq(irpCredentialsTable.businessId, req.businessId));
  await recordAudit({ ...actorFrom(req), action: "business.irp_login_removed", targetType: "business", targetId: req.businessId, businessId: req.businessId, details: {} });
  return res.json({ configured: false });
});

export default router;
