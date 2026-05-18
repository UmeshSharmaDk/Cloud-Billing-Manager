import { Router } from "express";
import { db, usersTable, businessesTable, invoicesTable, purchasesTable, customersTable, vendorsTable, productsTable } from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./auth";

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
  const allUsers = await db.select().from(usersTable);
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
router.get("/users", requireAuth, requireAdmin, async (req: any, res) => {
  const { search, page = "1", limit = "50" } = req.query as any;
  const allUsers = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  const filtered = search
    ? allUsers.filter(u => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
    : allUsers;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const paged = filtered.slice(offset, offset + parseInt(limit));
  return res.json({ users: paged.map(mapUser), total: filtered.length });
});

// GET /admin/users/:id — get a user with all their business data
router.get("/users/:id", requireAuth, requireAdmin, async (req: any, res) => {
  const userId = parseInt(req.params.id);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
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
router.patch("/users/:id", requireAuth, requireAdmin, async (req: any, res) => {
  const { isActive, subscriptionStatus, subscriptionEnd, role } = req.body;
  const updates: any = {};
  if (isActive !== undefined) updates.isActive = isActive;
  if (subscriptionStatus !== undefined) updates.subscriptionStatus = subscriptionStatus;
  if (subscriptionEnd !== undefined) updates.subscriptionEnd = subscriptionEnd || null;
  if (role !== undefined) updates.role = role;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, parseInt(req.params.id))).returning();
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(mapUser(user));
});

export default router;
