import { Router } from "express";
import { db, usersTable, businessesTable } from "@workspace/db";
import { eq, ilike, or, and, count, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./auth";
import { mapUser } from "../lib/serialise";
import { hashPassword } from "../lib/password";
import { validatePassword } from "../lib/password-policy";
import { recordAudit, actorFrom } from "../lib/audit";
import { requireStepUp, verifyStepUp } from "../middleware/step-up";
import { assertNotLastAdmin, assertNotSelf } from "../lib/admin-guards";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import type { AuthedRequest, IdParams } from "../lib/http";
import {
  ListUsersQuery, CreateUserBody, UpdateUserBody,
  ToggleStatusBody, ResetPasswordBody, IdParam,
} from "../schemas";

const router = Router();

/**
 * Handlers in this router run after `requireAuth`, so
 * the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `user` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = AuthedRequest<any, any, IdParams>;


router.get("/", requireAuth, requireAdmin, validateQuery(ListUsersQuery), async (req: Req, res) => {
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

router.post("/", requireAuth, requireAdmin, validateBody(CreateUserBody), async (req: Req, res) => {
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

/**
 * `GET /api/users/admin/stats` used to live here: a second, subtly different
 * copy of `GET /api/admin/stats` with its own bugs (it counted deleted users,
 * and its "inactive" tally included administrators while "active" did not).
 * Two overlapping admin surfaces is one too many — `/api/admin/stats` is the
 * one the admin dashboard calls, and it is now the only one.
 */

router.get("/:id", requireAuth, validateParams(IdParam), async (req: Req, res) => {
  if (req.userRole !== "admin" && req.userId !== req.validatedParams.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const [user] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, req.validatedParams.id), isNull(usersTable.deletedAt))).limit(1);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(mapUser(user));
});

router.patch("/:id", requireAuth, requireAdmin, validateParams(IdParam), validateBody(UpdateUserBody),
  async (req: Req, res) => {
    const targetId = req.validatedParams.id;
    const { name, email, role, subscriptionStatus, subscriptionEnd } = req.body;

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
router.delete("/:id", requireAuth, requireAdmin, validateParams(IdParam), async (req: Req, res) => {
  const targetId = req.validatedParams.id;

  const selfGuard = assertNotSelf(req.user.id, targetId);
  if (selfGuard) return res.status(409).json({ error: selfGuard });

  const [before] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
  if (!before || before.deletedAt) return res.status(404).json({ error: "User not found" });

  const guard = await assertNotLastAdmin(before, "user");
  if (guard) return res.status(409).json({ error: guard });

  await db.update(usersTable)
    .set({ deletedAt: new Date(), isActive: false, tokenVersion: before.tokenVersion + 1 })
    .where(eq(usersTable.id, targetId));

  await recordAudit({
    ...actorFrom(req), action: "user.deleted", targetType: "user", targetId,
    details: { email: before.email, role: before.role },
  });
  return res.json({ success: true });
});

router.patch("/:id/toggle-status", requireAuth, requireAdmin, validateParams(IdParam), validateBody(ToggleStatusBody), async (req: Req, res) => {
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
  validateBody(ResetPasswordBody), requireStepUp, async (req: Req, res) => {
    const targetId = req.validatedParams.id;
    const { newPassword } = req.body;

    const policyFailure = await validatePassword(newPassword);
    if (policyFailure) return res.status(400).json({ error: policyFailure.message });

    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!target || target.deletedAt) return res.status(404).json({ error: "User not found" });

    // Revoke the target's existing sessions as well. Resetting a password
    // while leaving the old sessions live defeats the point of the reset.
    await db.update(usersTable)
      .set({
        passwordHash: await hashPassword(newPassword),
        tokenVersion: target.tokenVersion + 1,
      })
      .where(eq(usersTable.id, targetId));

    await recordAudit({
      ...actorFrom(req), action: "user.password_reset", targetType: "user", targetId,
      details: { email: target.email },
    });
    return res.json({ success: true });
  });

export default router;
