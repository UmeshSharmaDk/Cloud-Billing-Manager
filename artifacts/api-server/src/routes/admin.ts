import { Router } from "express";
import { db, usersTable, businessesTable, invoicesTable, purchasesTable, customersTable, vendorsTable, productsTable } from "@workspace/db";
import { eq, ne, and, or, ilike, isNull, count, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./auth";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import { AdminListUsersQuery, AdminUpdateUserBody, IdParam } from "../schemas";
import { recordAudit, actorFrom } from "../lib/audit";
import { requireStepUp, verifyStepUp } from "../middleware/step-up";
import { assertNotLastAdmin, assertNotSelf } from "../lib/admin-guards";

const router = Router();

function mapUser(u: any) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    isActive: u.isActive, subscriptionStatus: u.subscriptionStatus,
    subscriptionEnd: u.subscriptionEnd, businessId: u.businessId,
    createdAt: u.createdAt,
  };
}

router.get("/stats", requireAuth, requireAdmin, async (_req, res) => {
  const allUsers = await db.select().from(usersTable).where(isNull(usersTable.deletedAt));
  const businesses = await db.select().from(businessesTable);
  const [{ count: totalInvoices }] = await db.select({ count: count() }).from(invoicesTable);
  const nonAdmins = allUsers.filter(u => u.role !== "admin");
  const activeUsers = nonAdmins.filter(u => u.isActive).length;
  const inactiveUsers = nonAdmins.filter(u => !u.isActive).length;
  const expiredSubscriptions = nonAdmins.filter(u => {
    if (!u.subscriptionEnd) return false;
    return new Date(u.subscriptionEnd) < new Date();
  }).length;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const newUsersThisMonth = nonAdmins.filter(u => new Date(u.createdAt) >= startOfMonth).length;

  const monthlyCount = nonAdmins.filter(u => u.subscriptionStatus === "monthly").length;
  const yearlyCount = nonAdmins.filter(u => u.subscriptionStatus === "yearly").length;
  const trialCount = nonAdmins.filter(u => u.subscriptionStatus === "trial").length;
  const expiredCount = nonAdmins.filter(u => u.subscriptionStatus === "expired").length;

  const recentUsers = [...nonAdmins]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map(mapUser);

  return res.json({
    totalUsers: nonAdmins.length,
    activeUsers,
    inactiveUsers,
    expiredSubscriptions,
    totalBusinesses: businesses.length,
    totalInvoices: Number(totalInvoices),
    activeSubscriptions: activeUsers,
    newUsersThisMonth,
    monthlyCount, yearlyCount, trialCount, expiredCount,
    recentUsers,
  });
});

// GET /admin/users — list all users with business info
router.get("/users", requireAuth, requireAdmin, validateQuery(AdminListUsersQuery), async (req: any, res) => {
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
router.get("/users/:id", requireAuth, requireAdmin, validateParams(IdParam), async (req: any, res) => {
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
  async (req: any, res) => {
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
