import { Router } from "express";
import { db, usersTable, businessesTable, invoicesTable, purchasesTable, customersTable, vendorsTable, productsTable } from "@workspace/db";
import { eq, ne, and, or, ilike, isNull, count, desc, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./auth";
import { mapUser } from "../lib/serialise";
import { systemScope } from "../middleware/tenant-scope";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import { AdminListUsersQuery, AdminUpdateUserBody, IdParam } from "../schemas";
import { recordAudit, actorFrom } from "../lib/audit";
import { requireStepUp, verifyStepUp } from "../middleware/step-up";
import { assertNotLastAdmin, assertNotSelf } from "../lib/admin-guards";
import type { AuthedRequest, IdParams } from "../lib/http";

const router = Router();

/**
 * Every route here is already gated by `requireAdmin` and reads across all
 * tenants by design — platform dashboards, user administration. Suspending the
 * policies is therefore explicit and router-wide rather than sprinkled per
 * query, and it means these handlers are trusting `requireAdmin` alone.
 */
router.use(systemScope);

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
router.get("/stats", requireAuth, requireAdmin, async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const notAdmin = and(ne(usersTable.role, "admin"), isNull(usersTable.deletedAt));

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
      }).from(usersTable).where(notAdmin),

      db.select({ count: count() }).from(businessesTable),
      db.select({ count: count() }).from(invoicesTable),

      db.select().from(usersTable).where(notAdmin)
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
router.get("/users", requireAuth, requireAdmin, validateQuery(AdminListUsersQuery), async (req: Req, res) => {
  const { search, page, limit } = req.validatedQuery;
  // Filtering, counting and paging happen in SQL. This handler used to read
  // every user row into memory on each request and slice the array, so its
  // cost grew with the size of the platform while `limit` came straight from
  // the query string.
  const where = search
    ? and(isNull(usersTable.deletedAt),
          or(ilike(usersTable.name, `%${search}%`), ilike(usersTable.email, `%${search}%`)))
    : isNull(usersTable.deletedAt);

  const users = await db.select().from(usersTable).where(where)
    .orderBy(desc(usersTable.createdAt))
    .limit(limit).offset((page - 1) * limit);
  const [{ count: total }] = await db.select({ count: count() }).from(usersTable).where(where);
  return res.json({ users: users.map(mapUser), total: Number(total) });
});

// GET /admin/users/:id — get a user with all their business data
router.get("/users/:id", requireAuth, requireAdmin, validateParams(IdParam), async (req: Req, res) => {
  const userId = req.validatedParams.id;
  const [user] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, userId), isNull(usersTable.deletedAt))).limit(1);
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
router.patch("/users/:id", requireAuth, requireAdmin, validateParams(IdParam), validateBody(AdminUpdateUserBody),
  async (req: Req, res) => {
    const targetId = req.validatedParams.id;
    const { isActive, subscriptionStatus, subscriptionEnd, role } = req.body;

    const [before] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!before || before.deletedAt) return res.status(404).json({ error: "User not found" });

    // Confirmation is required to CHANGE a role, not merely to send the field.
    // The admin edit form posts the whole record including the unchanged role,
    // so gating on presence made every save fail — a subscription edit is not
    // a privilege change and must not demand a password.
    if (role && role !== before.role) {
      const stepUp = await verifyStepUp(req);
      if (!stepUp.ok) return res.status(stepUp.status ?? 403).json(stepUp.body);

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
