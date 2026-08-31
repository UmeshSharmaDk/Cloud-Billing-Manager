import { Router } from "express";
import { db, usersTable, businessesTable } from "@workspace/db";
import { eq, ilike, or, and, count } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./auth";
import { hashPassword, MAX_PASSWORD_BYTES } from "../lib/password";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import {
  ListUsersQuery, CreateUserBody, UpdateUserBody,
  ToggleStatusBody, ResetPasswordBody, IdParam,
} from "../schemas";

const router = Router();

function mapUser(user: any) {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    isActive: user.isActive, subscriptionStatus: user.subscriptionStatus,
    subscriptionEnd: user.subscriptionEnd, businessId: user.businessId,
    createdAt: user.createdAt,
  };
}

router.get("/", requireAuth, requireAdmin, validateQuery(ListUsersQuery), async (req: any, res) => {
  const { search, status, page, limit } = req.validatedQuery;
  const conditions: any[] = [];
  if (search) conditions.push(or(ilike(usersTable.name, `%${search}%`), ilike(usersTable.email, `%${search}%`)));
  if (status === "active") conditions.push(eq(usersTable.isActive, true));
  if (status === "inactive") conditions.push(eq(usersTable.isActive, false));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const users = await db.select().from(usersTable).where(where)
    .limit(limit).offset((page - 1) * limit);
  // Count the filtered set, not the whole table: the previous total ignored
  // `search` and `status`, so a filtered page reported the wrong page count.
  const [{ count: total }] = await db.select({ count: count() }).from(usersTable).where(where);
  return res.json({ users: users.map(mapUser), total: Number(total) });
});

router.post("/", requireAuth, requireAdmin, validateBody(CreateUserBody), async (req, res) => {
  const { name, email, password, role, subscriptionStatus, subscriptionEnd } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: "Required fields missing" });
  if (Buffer.byteLength(String(password), "utf8") > MAX_PASSWORD_BYTES) {
    return res.status(400).json({ error: `Password must be at most ${MAX_PASSWORD_BYTES} bytes` });
  }
  const [user] = await db.insert(usersTable).values({
    name, email: String(email).toLowerCase(), passwordHash: await hashPassword(String(password)), role,
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

router.get("/:id", requireAuth, validateParams(IdParam), async (req: any, res) => {
  if (req.userRole !== "admin" && req.userId !== req.validatedParams.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.validatedParams.id)).limit(1);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(mapUser(user));
});

router.patch("/:id", requireAuth, requireAdmin, validateParams(IdParam), validateBody(UpdateUserBody), async (req: any, res) => {
  const { name, email, role, subscriptionStatus, subscriptionEnd } = req.body;
  const updates: any = {};
  if (name) updates.name = name;
  if (email) updates.email = email.toLowerCase();
  if (role) updates.role = role;
  if (subscriptionStatus !== undefined) updates.subscriptionStatus = subscriptionStatus;
  if (subscriptionEnd !== undefined) updates.subscriptionEnd = subscriptionEnd;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.validatedParams.id)).returning();
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(mapUser(user));
});

router.delete("/:id", requireAuth, requireAdmin, validateParams(IdParam), async (req: any, res) => {
  await db.delete(usersTable).where(eq(usersTable.id, req.validatedParams.id));
  return res.json({ success: true });
});

router.patch("/:id/toggle-status", requireAuth, requireAdmin, validateParams(IdParam), validateBody(ToggleStatusBody), async (req: any, res) => {
  const { isActive } = req.body;
  const [user] = await db.update(usersTable).set({ isActive }).where(eq(usersTable.id, req.validatedParams.id)).returning();
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(mapUser(user));
});

router.post("/:id/reset-password", requireAuth, requireAdmin, validateParams(IdParam), validateBody(ResetPasswordBody), async (req: any, res) => {
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: "newPassword required" });
  if (Buffer.byteLength(String(newPassword), "utf8") > MAX_PASSWORD_BYTES) {
    return res.status(400).json({ error: `Password must be at most ${MAX_PASSWORD_BYTES} bytes` });
  }
  await db.update(usersTable).set({ passwordHash: await hashPassword(String(newPassword)) }).where(eq(usersTable.id, req.validatedParams.id));
  return res.json({ success: true });
});

export default router;
