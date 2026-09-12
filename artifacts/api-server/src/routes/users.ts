import { Router } from "express";
import { db, usersTable, businessesTable } from "@workspace/db";
import { eq, ilike, or, and, count, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./auth";
import { hashPassword } from "../lib/password";
import { validatePassword } from "../lib/password-policy";
import { recordAudit, actorFrom } from "../lib/audit";
import { requireStepUp } from "../middleware/step-up";
import { assertNotLastAdmin, assertNotSelf } from "../lib/admin-guards";
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
  conditions.push(isNull(usersTable.deletedAt));
  const where = and(...conditions);

  const users = await db.select().from(usersTable).where(where)
    .limit(limit).offset((page - 1) * limit);
  // Count the filtered set, not the whole table: the previous total ignored
  // `search` and `status`, so a filtered page reported the wrong page count.
  const [{ count: total }] = await db.select({ count: count() }).from(usersTable).where(where);
  return res.json({ users: users.map(mapUser), total: Number(total) });
});

router.post("/", requireAuth, requireAdmin, validateBody(CreateUserBody), async (req: any, res) => {
  const { name, email, password, role, subscriptionStatus, subscriptionEnd } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: "Required fields missing" });
  const policyFailure = await validatePassword(password);
  if (policyFailure) return res.status(400).json({ error: policyFailure.message });
  const [user] = await db.insert(usersTable).values({
    name, email: String(email).toLowerCase(), passwordHash: await hashPassword(String(password)), role,
    isActive: true, subscriptionStatus, subscriptionEnd,
  }).returning();
  await recordAudit({
    ...actorFrom(req), action: "user.created", targetType: "user", targetId: user.id,
    details: { email: user.email, role: user.role },
  });
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
  const [user] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, req.validatedParams.id), isNull(usersTable.deletedAt))).limit(1);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(mapUser(user));
});

router.patch("/:id", requireAuth, requireAdmin, validateParams(IdParam), validateBody(UpdateUserBody),
  async (req: any, res, next) => {
    // A role change can hand out or take away platform administration, so it
    // needs the caller's own password. Renames and subscription edits do not.
    if (req.body.role === undefined) return next();
    return requireStepUp(req, res, next);
  },
  async (req: any, res) => {
    const targetId = req.validatedParams.id;
    const { name, email, role, subscriptionStatus, subscriptionEnd } = req.body;

    const [before] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!before || before.deletedAt) return res.status(404).json({ error: "User not found" });

    if (role && role !== before.role) {
      const guard = await assertNotLastAdmin(before, role);
      if (guard) return res.status(409).json({ error: guard });
    }

    const updates: any = {};
    if (name) updates.name = name;
    if (email) updates.email = email.toLowerCase();
    if (role) updates.role = role;
    if (subscriptionStatus !== undefined) updates.subscriptionStatus = subscriptionStatus;
    if (subscriptionEnd !== undefined) updates.subscriptionEnd = subscriptionEnd;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });

    const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, targetId)).returning();
    if (!user) return res.status(404).json({ error: "User not found" });

    await recordAudit({
      ...actorFrom(req),
      action: role && role !== before.role ? "user.role_changed" : "user.updated",
      targetType: "user", targetId,
      details: { before: { role: before.role, email: before.email }, after: { role: user.role, email: user.email } },
    });
    return res.json(mapUser(user));
  });

/**
 * Soft-delete a user. The row and every business record attached to it stay
 * in place; a hard DELETE removed only the user and orphaned the rest.
 */
router.delete("/:id", requireAuth, requireAdmin, validateParams(IdParam), async (req: any, res) => {
  const targetId = req.validatedParams.id;

  const selfGuard = assertNotSelf(req.user.id, targetId);
  if (selfGuard) return res.status(409).json({ error: selfGuard });

  const [before] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
  if (!before || before.deletedAt) return res.status(404).json({ error: "User not found" });

  const guard = await assertNotLastAdmin(before, "user");
  if (guard) return res.status(409).json({ error: guard });

  await db.update(usersTable)
    .set({ deletedAt: new Date(), isActive: false })
    .where(eq(usersTable.id, targetId));

  await recordAudit({
    ...actorFrom(req), action: "user.deleted", targetType: "user", targetId,
    details: { email: before.email, role: before.role },
  });
  return res.json({ success: true });
});

router.patch("/:id/toggle-status", requireAuth, requireAdmin, validateParams(IdParam), validateBody(ToggleStatusBody), async (req: any, res) => {
  const targetId = req.validatedParams.id;
  const { isActive } = req.body;

  if (!isActive) {
    const selfGuard = assertNotSelf(req.user.id, targetId);
    if (selfGuard) return res.status(409).json({ error: selfGuard });
  }

  const [user] = await db.update(usersTable).set({ isActive })
    .where(and(eq(usersTable.id, targetId), isNull(usersTable.deletedAt))).returning();
  if (!user) return res.status(404).json({ error: "User not found" });

  await recordAudit({
    ...actorFrom(req), action: "user.status_changed", targetType: "user", targetId,
    details: { isActive },
  });
  return res.json(mapUser(user));
});

/**
 * Reset another user's password. The most dangerous action an administrator
 * can take — it yields their account — so it needs the administrator's own
 * password, and it is recorded.
 */
router.post("/:id/reset-password", requireAuth, requireAdmin, validateParams(IdParam),
  validateBody(ResetPasswordBody), requireStepUp, async (req: any, res) => {
    const targetId = req.validatedParams.id;
    const { newPassword } = req.body;

    const policyFailure = await validatePassword(newPassword);
    if (policyFailure) return res.status(400).json({ error: policyFailure.message });

    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!target || target.deletedAt) return res.status(404).json({ error: "User not found" });

    await db.update(usersTable)
      .set({ passwordHash: await hashPassword(newPassword) })
      .where(eq(usersTable.id, targetId));

    await recordAudit({
      ...actorFrom(req), action: "user.password_reset", targetType: "user", targetId,
      details: { email: target.email },
    });
    return res.json({ success: true });
  });

export default router;
