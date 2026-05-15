import { Router } from "express";
import { db, usersTable, businessesTable } from "@workspace/db";
import { eq, ilike, or, count } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./auth";
import crypto from "crypto";

const router = Router();

function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "gst_salt_v1").digest("hex");
}

function mapUser(user: any) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    isActive: user.isActive, subscriptionStatus: user.subscriptionStatus,
    subscriptionEnd: user.subscriptionEnd, businessId: user.businessId,
    createdAt: user.createdAt,
  };
}

router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const { search, status, page = "1", limit = "20" } = req.query as any;
  let query = db.select().from(usersTable).$dynamic();
  const conditions: any[] = [];
  if (search) conditions.push(or(ilike(usersTable.name, `%${search}%`), ilike(usersTable.email, `%${search}%`)));
  if (status === "active") conditions.push(eq(usersTable.isActive, true));
  if (status === "inactive") conditions.push(eq(usersTable.isActive, false));
  if (conditions.length > 0) {
    const { and } = await import("drizzle-orm");
    query = query.where(and(...conditions));
  }
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const users = await query.limit(parseInt(limit)).offset(offset);
  const [{ count: total }] = await db.select({ count: count() }).from(usersTable);
  return res.json({ users: users.map(mapUser), total: Number(total) });
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { name, email, password, role, subscriptionStatus, subscriptionEnd } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: "Required fields missing" });
  const [user] = await db.insert(usersTable).values({
    name, email: email.toLowerCase(), passwordHash: hashPassword(password), role,
    isActive: true, subscriptionStatus, subscriptionEnd,
  }).returning();
  return res.status(201).json(mapUser(user));
});

router.get("/admin/stats", requireAuth, requireAdmin, async (_req, res) => {
  const allUsers = await db.select().from(usersTable);
  const activeUsers = allUsers.filter(u => u.isActive && u.role !== "admin").length;
  const inactiveUsers = allUsers.filter(u => !u.isActive).length;
  const expiredSubscriptions = allUsers.filter(u => {
    if (!u.subscriptionEnd) return false;
    return new Date(u.subscriptionEnd) < new Date();
  }).length;
  const businesses = await db.select().from(businessesTable);
  const recentUsers = allUsers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 10);
  return res.json({
    totalUsers: allUsers.filter(u => u.role !== "admin").length,
    activeUsers,
    inactiveUsers,
    expiredSubscriptions,
    totalBusinesses: businesses.length,
    recentUsers: recentUsers.map(mapUser),
  });
});

router.get("/:id", requireAuth, async (req: any, res) => {
  if (req.userRole !== "admin" && req.userId !== parseInt(req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parseInt(req.params.id))).limit(1);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(mapUser(user));
});

router.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { name, email, role, subscriptionStatus, subscriptionEnd } = req.body;
  const updates: any = {};
  if (name) updates.name = name;
  if (email) updates.email = email.toLowerCase();
  if (role) updates.role = role;
  if (subscriptionStatus !== undefined) updates.subscriptionStatus = subscriptionStatus;
  if (subscriptionEnd !== undefined) updates.subscriptionEnd = subscriptionEnd;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, parseInt(req.params.id))).returning();
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(mapUser(user));
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  await db.delete(usersTable).where(eq(usersTable.id, parseInt(req.params.id)));
  return res.json({ success: true });
});

router.patch("/:id/toggle-status", requireAuth, requireAdmin, async (req, res) => {
  const { isActive } = req.body;
  const [user] = await db.update(usersTable).set({ isActive }).where(eq(usersTable.id, parseInt(req.params.id))).returning();
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(mapUser(user));
});

router.post("/:id/reset-password", requireAuth, requireAdmin, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: "newPassword required" });
  await db.update(usersTable).set({ passwordHash: hashPassword(newPassword) }).where(eq(usersTable.id, parseInt(req.params.id)));
  return res.json({ success: true });
});

export default router;
