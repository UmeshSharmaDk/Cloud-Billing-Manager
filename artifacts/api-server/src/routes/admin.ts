import { Router } from "express";
import { db, usersTable, businessesTable, auditLogTable, invoicesTable, purchasesTable, customersTable, vendorsTable, productsTable } from "@workspace/db";
import { eq, ne, and, or, ilike, isNull, count, desc, inArray, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./auth";
import { mapUser } from "../lib/serialise";
import { systemScope } from "../middleware/tenant-scope";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import { AdminListUsersQuery, AdminUpdateUserBody, IdParam, LockDateBody, AuditPageQuery, ClientsQuery } from "../schemas";
import { taxInvoice, receivableInvoice, invoiceSign, activePurchase } from "../lib/tax-documents";
import { recordAudit, actorFrom } from "../lib/audit";
import { requireStepUp, verifyStepUp, sendStepUpFailure } from "../middleware/step-up";
import { assertNotLastAdmin, assertNotSelf } from "../lib/admin-guards";
import type { AuthedRequest, IdParams } from "../lib/http";

const router = Router();

/**
 * Every route here is already gated by `requireAdmin` and reads across all
 * tenants by design — platform dashboards, user administration. Suspending the
 * policies is therefore explicit and router-wide rather than sprinkled per
 * query, and it means these handlers are trusting `requireAdmin` alone.
 */
// Authenticate and authorise first: a request that is not an admin must not
// take a pooled connection and open a policy-free transaction.
router.use(requireAuth, requireAdmin, systemScope);

/**
 * Handlers in this router run after `requireAuth`, so
 * the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `user` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = AuthedRequest<any, any, IdParams>;


/**
 * Platform statistics, computed by the database.
 *
 * This read every user and every business into memory on each request and
 * filtered the arrays eight times. The cost grew with the size of the platform
 * — the endpoint got slower exactly as the product succeeded.
 */
router.get("/stats", async (req: Req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const visibleUsers = req.userRole === "admin"
    ? and(eq(usersTable.role, "user"), isNull(usersTable.deletedAt), eq(usersTable.createdByAdminId, req.user.id))
    : and(eq(usersTable.role, "user"), isNull(usersTable.deletedAt));

  const businessIds = req.userRole === "admin"
    ? (await db.select({ businessId: usersTable.businessId }).from(usersTable).where(visibleUsers))
      .map((row) => row.businessId)
      .filter((id): id is number => id !== null)
    : null;
  const businessCountQuery = businessIds
    ? businessIds.length
      ? db.select({ count: count() }).from(businessesTable).where(inArray(businessesTable.id, businessIds))
      : Promise.resolve([{ count: 0 }])
    : db.select({ count: count() }).from(businessesTable);
  const invoiceCountQuery = businessIds
    ? businessIds.length
      ? db.select({ count: count() }).from(invoicesTable).where(inArray(invoicesTable.businessId, businessIds))
      : Promise.resolve([{ count: 0 }])
    : db.select({ count: count() }).from(invoicesTable);

  const [[userAgg], [{ count: totalBusinesses }], [{ count: totalInvoices }], recentUsers] =
    await Promise.all([
      db.select({
        total: count(),
        active: sql<number>`count(*) FILTER (WHERE ${usersTable.isActive})`,
        inactive: sql<number>`count(*) FILTER (WHERE NOT ${usersTable.isActive})`,
        expired: sql<number>`count(*) FILTER (
          WHERE ${usersTable.subscriptionEnd} IS NOT NULL AND ${usersTable.subscriptionEnd} < ${today}
        )`,
        newThisMonth: sql<number>`count(*) FILTER (WHERE ${usersTable.createdAt} >= ${startOfMonth})`,
        monthly: sql<number>`count(*) FILTER (WHERE ${usersTable.subscriptionStatus} = 'monthly')`,
        yearly: sql<number>`count(*) FILTER (WHERE ${usersTable.subscriptionStatus} = 'yearly')`,
        trial: sql<number>`count(*) FILTER (WHERE ${usersTable.subscriptionStatus} = 'trial')`,
        expiredStatus: sql<number>`count(*) FILTER (WHERE ${usersTable.subscriptionStatus} = 'expired')`,
      }).from(usersTable).where(visibleUsers),

      businessCountQuery,
      invoiceCountQuery,

      db.select().from(usersTable).where(visibleUsers)
        .orderBy(desc(usersTable.createdAt)).limit(10),
    ]);

  const activeUsers = Number(userAgg.active);

  return res.json({
    totalUsers: Number(userAgg.total),
    activeUsers,
    inactiveUsers: Number(userAgg.inactive),
    expiredSubscriptions: Number(userAgg.expired),
    totalBusinesses: Number(totalBusinesses),
    totalInvoices: Number(totalInvoices),
    activeSubscriptions: activeUsers,
    newUsersThisMonth: Number(userAgg.newThisMonth),
    monthlyCount: Number(userAgg.monthly),
    yearlyCount: Number(userAgg.yearly),
    trialCount: Number(userAgg.trial),
    expiredCount: Number(userAgg.expiredStatus),
    recentUsers: recentUsers.map(mapUser),
  });
});

// GET /admin/users — list all users with business info
router.get("/users", validateQuery(AdminListUsersQuery), async (req: Req, res) => {
  const { search, page, limit } = req.validatedQuery;
  // Filtering, counting and paging happen in SQL. This handler used to read
  // every user row into memory on each request and slice the array, so its
  // cost grew with the size of the platform while `limit` came straight from
  // the query string.
  const conditions = [isNull(usersTable.deletedAt), eq(usersTable.role, "user")];
  if (req.userRole === "admin") conditions.push(eq(usersTable.createdByAdminId, req.user.id));
  if (search) conditions.push(or(ilike(usersTable.name, `%${search}%`), ilike(usersTable.email, `%${search}%`))!);
  const where = and(...conditions);

  const users = await db.select().from(usersTable).where(where)
    .orderBy(desc(usersTable.createdAt))
    .limit(limit).offset((page - 1) * limit);
  const [{ count: total }] = await db.select({ count: count() }).from(usersTable).where(where);
  return res.json({ users: users.map(mapUser), total: Number(total) });
});

/**
 * GET /admin/clients — the consultant dashboard: every business this admin
 * manages, with the month's sales and purchases, GST, money still owed to it,
 * and when it last invoiced. Four grouped queries, whatever the client count.
 */
router.get("/clients", validateQuery(ClientsQuery), async (req: Req, res) => {
  const month = req.validatedQuery.month ?? new Date().toISOString().slice(0, 7);
  const from = `${month}-01`;
  const to = `${month}-31`; // dates are YYYY-MM-DD text, so this bounds the month
  const visible = req.userRole === "admin"
    ? and(eq(usersTable.role, "user"), isNull(usersTable.deletedAt), eq(usersTable.createdByAdminId, req.user.id))
    : and(eq(usersTable.role, "user"), isNull(usersTable.deletedAt));
  const users = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, isActive: usersTable.isActive, businessId: usersTable.businessId })
    .from(usersTable).where(visible).orderBy(usersTable.name);
  const ids = users.map((u) => u.businessId).filter((id): id is number => id !== null);
  if (!ids.length) return res.json({ month, clients: users.map((u) => ({ ...u, business: null })) });

  const sign = invoiceSign(invoicesTable);
  const [bizRows, sales, purchases, owed] = await Promise.all([
    db.select({ id: businessesTable.id, name: businessesTable.name, gstin: businessesTable.gstin, lockDate: businessesTable.lockDate })
      .from(businessesTable).where(inArray(businessesTable.id, ids)),
    db.select({
      businessId: invoicesTable.businessId,
      sales: sql<string>`coalesce(sum(${sign} * ${invoicesTable.grandTotal}), 0)`,
      outputGst: sql<string>`coalesce(sum(${sign} * ${invoicesTable.totalGst}), 0)`,
      invoices: count(),
    }).from(invoicesTable)
      .where(and(inArray(invoicesTable.businessId, ids), taxInvoice(invoicesTable), sql`${invoicesTable.invoiceDate} BETWEEN ${from} AND ${to}`))
      .groupBy(invoicesTable.businessId),
    db.select({
      businessId: purchasesTable.businessId,
      purchases: sql<string>`coalesce(sum(${purchasesTable.grandTotal}), 0)`,
      inputGst: sql<string>`coalesce(sum(${purchasesTable.totalGst}), 0)`,
    }).from(purchasesTable)
      .where(and(inArray(purchasesTable.businessId, ids), activePurchase(purchasesTable), sql`${purchasesTable.invoiceDate} BETWEEN ${from} AND ${to}`))
      .groupBy(purchasesTable.businessId),
    db.select({
      businessId: invoicesTable.businessId,
      receivable: sql<string>`coalesce(sum(${invoicesTable.grandTotal} - ${invoicesTable.paidAmount}) FILTER (WHERE ${invoicesTable.status} <> 'paid'), 0)`,
      lastInvoiceAt: sql<string | null>`max(${invoicesTable.createdAt})`,
    }).from(invoicesTable)
      .where(and(inArray(invoicesTable.businessId, ids), receivableInvoice(invoicesTable)))
      .groupBy(invoicesTable.businessId),
  ]);
  const by = <T extends { businessId: number }>(rows: T[]) => new Map(rows.map((r) => [r.businessId, r]));
  const s = by(sales), p = by(purchases), o = by(owed);
  const biz = new Map(bizRows.map((b) => [b.id, b]));
  const num = (v: unknown) => Number(v ?? 0);

  return res.json({
    month,
    clients: users.map((u) => {
      const b = u.businessId ? biz.get(u.businessId) : undefined;
      if (!b) return { ...u, business: null };
      const si = s.get(b.id), pi = p.get(b.id), oi = o.get(b.id);
      const outputGst = num(si?.outputGst), inputGst = num(pi?.inputGst);
      return {
        ...u, business: b,
        sales: num(si?.sales), invoices: num(si?.invoices), purchases: num(pi?.purchases),
        outputGst, inputGst, netGst: Math.round((outputGst - inputGst) * 100) / 100,
        receivable: num(oi?.receivable), lastInvoiceAt: oi?.lastInvoiceAt ?? null,
      };
    }),
  });
});

/** A business user this admin may manage: their own, or any for the superadmin. */
async function managedUser(req: Req) {
  const conditions = [eq(usersTable.id, req.validatedParams.id), eq(usersTable.role, "user"), isNull(usersTable.deletedAt)];
  if (req.userRole === "admin") conditions.push(eq(usersTable.createdByAdminId, req.user.id));
  const [user] = await db.select().from(usersTable).where(and(...conditions)).limit(1);
  return user ?? null;
}

// PATCH /admin/users/:id/lock-date — freeze (or unfreeze) the user's books up to a day.
router.patch("/users/:id/lock-date", validateParams(IdParam), validateBody(LockDateBody), async (req: Req, res) => {
  const user = await managedUser(req);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.businessId) return res.status(400).json({ error: "This user has no business yet." });
  const [before] = await db.select({ lockDate: businessesTable.lockDate }).from(businessesTable).where(eq(businessesTable.id, user.businessId)).limit(1);
  const [biz] = await db.update(businessesTable).set({ lockDate: req.body.lockDate })
    .where(eq(businessesTable.id, user.businessId)).returning();
  await recordAudit({
    ...actorFrom(req), action: "business.lock_date_changed", targetType: "business", targetId: biz.id,
    businessId: biz.id, details: { before: before?.lockDate ?? null, after: biz.lockDate },
  });
  return res.json({ lockDate: biz.lockDate });
});

// GET /admin/users/:id/audit — the user's audit trail: changes to their books and to their account.
router.get("/users/:id/audit", validateParams(IdParam), validateQuery(AuditPageQuery), async (req: Req, res) => {
  const user = await managedUser(req);
  if (!user) return res.status(404).json({ error: "User not found" });
  const { page, limit } = req.validatedQuery;
  const where = or(
    user.businessId ? eq(auditLogTable.businessId, user.businessId) : sql`false`,
    and(eq(auditLogTable.targetType, "user"), eq(auditLogTable.targetId, user.id)),
  );
  const entries = await db.select({
    id: auditLogTable.id, actorEmail: auditLogTable.actorEmail, action: auditLogTable.action,
    targetType: auditLogTable.targetType, targetId: auditLogTable.targetId, details: auditLogTable.details,
    createdAt: auditLogTable.createdAt,
  }).from(auditLogTable).where(where).orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
    .limit(limit).offset((page - 1) * limit);
  const [{ count: total }] = await db.select({ count: count() }).from(auditLogTable).where(where);
  return res.json({ entries, total: Number(total) });
});

// GET /admin/users/:id — get a user with all their business data
router.get("/users/:id", validateParams(IdParam), async (req: Req, res) => {
  const userId = req.validatedParams.id;
  const conditions = [eq(usersTable.id, userId), eq(usersTable.role, "user"), isNull(usersTable.deletedAt)];
  if (req.userRole === "admin") conditions.push(eq(usersTable.createdByAdminId, req.user.id));
  const [user] = await db.select().from(usersTable).where(and(...conditions)).limit(1);
  if (!user) return res.status(404).json({ error: "User not found" });

  let business = null;
  let invoiceCount = 0, purchaseCount = 0, customerCount = 0, vendorCount = 0, productCount = 0;

  if (user.businessId) {
    const [biz] = await db.select().from(businessesTable).where(eq(businessesTable.id, user.businessId)).limit(1);
    business = biz || null;
    const [{ count: ic }] = await db.select({ count: count() }).from(invoicesTable).where(eq(invoicesTable.businessId, user.businessId));
    const [{ count: pc }] = await db.select({ count: count() }).from(purchasesTable).where(eq(purchasesTable.businessId, user.businessId));
    const [{ count: cc }] = await db.select({ count: count() }).from(customersTable).where(eq(customersTable.businessId, user.businessId));
    const [{ count: vc }] = await db.select({ count: count() }).from(vendorsTable).where(eq(vendorsTable.businessId, user.businessId));
    const [{ count: prc }] = await db.select({ count: count() }).from(productsTable).where(eq(productsTable.businessId, user.businessId));
    invoiceCount = Number(ic);
    purchaseCount = Number(pc);
    customerCount = Number(cc);
    vendorCount = Number(vc);
    productCount = Number(prc);
  }

  return res.json({
    ...mapUser(user),
    business,
    stats: { invoiceCount, purchaseCount, customerCount, vendorCount, productCount },
  });
});

// PATCH /admin/users/:id — update user subscription/status
router.patch("/users/:id", validateParams(IdParam), validateBody(AdminUpdateUserBody),
  async (req: Req, res) => {
    const targetId = req.validatedParams.id;
    const { isActive, subscriptionStatus, subscriptionEnd, role } = req.body;

    const [before] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!before || before.deletedAt) return res.status(404).json({ error: "User not found" });
    if (before.role !== "user" || (req.userRole === "admin" && before.createdByAdminId !== req.user.id)) {
      return res.status(404).json({ error: "User not found" });
    }

    // Confirmation is required to CHANGE a role, not merely to send the field.
    // The admin edit form posts the whole record including the unchanged role,
    // so gating on presence made every save fail — a subscription edit is not
    // a privilege change and must not demand a password.
    if (role && role !== before.role) {
      if (req.userRole !== "superadmin" || role === "admin") {
        return res.status(403).json({ error: "Use an administrator invitation to grant admin access." });
      }
      const stepUp = await verifyStepUp(req);
      if (!stepUp.ok) return sendStepUpFailure(res, stepUp);

      const guard = await assertNotLastAdmin(before, role);
      if (guard) return res.status(409).json({ error: guard });
    }
    if (isActive === false) {
      const selfGuard = assertNotSelf(req.user.id, targetId);
      if (selfGuard) return res.status(409).json({ error: selfGuard });
      const guard = await assertNotLastAdmin(before, "user");
      if (guard) return res.status(409).json({ error: guard });
    }

    const updates: any = {};
    if (isActive !== undefined) updates.isActive = isActive;
    if (subscriptionStatus !== undefined) updates.subscriptionStatus = subscriptionStatus;
    if (subscriptionEnd !== undefined) updates.subscriptionEnd = subscriptionEnd || null;
    if (role !== undefined) updates.role = role;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });

    const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, targetId)).returning();
    if (!user) return res.status(404).json({ error: "User not found" });

    await recordAudit({
      ...actorFrom(req),
      action: role && role !== before.role ? "user.role_changed" : "user.subscription_changed",
      targetType: "user", targetId,
      details: {
        before: { role: before.role, isActive: before.isActive, subscriptionStatus: before.subscriptionStatus },
        after: { role: user.role, isActive: user.isActive, subscriptionStatus: user.subscriptionStatus },
      },
    });
    return res.json(mapUser(user));
  });

export default router;
