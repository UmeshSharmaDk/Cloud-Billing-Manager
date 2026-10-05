import { Router } from "express";
import { db, usersTable, businessesTable } from "@workspace/db";
import { eq, ilike, or, and, count, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "./auth";
import { mapUser } from "../lib/serialise";
import { systemScope } from "../middleware/tenant-scope";
import { hashPassword } from "../lib/password";
import { validatePassword } from "../lib/password-policy";
import { recordAudit, actorFrom } from "../lib/audit";
import { requireStepUp, verifyStepUp, sendStepUpFailure } from "../middleware/step-up";
import { assertNotLastAdmin, assertNotSelf } from "../lib/admin-guards";
import { validateBody, validateQuery, validateParams } from "../middleware/validate";
import type { AuthedRequest, IdParams } from "../lib/http";
import {
  ListUsersQuery, CreateUserBody, UpdateUserBody,
  ToggleStatusBody, ResetPasswordBody, IdParam,
} from "../schemas";

const router = Router();

/**
 * Every route here is already gated by `requireAdmin` and reads across all
 * tenants by design — platform dashboards, user administration. Suspending the
 * policies is therefore explicit and router-wide rather than sprinkled per
 * query, and it means these handlers are trusting `requireAdmin` alone.
 */
// Authenticate first: an unauthenticated request must not take a pooled
// connection and open a policy-free transaction just to be turned away.
router.use(requireAuth, systemScope);

/**
 * Handlers in this router run after `requireAuth`, so
 * the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `user` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = AuthedRequest<any, any, IdParams>;


router.get("/", requireAdmin, validateQuery(ListUsersQuery), async (req: Req, res) => {
  const { search, status, page, limit } = req.validatedQuery;
  const conditions: any[] = [];
  if (search) conditions.push(or(ilike(usersTable.name, `%${search}%`), ilike(usersTable.email, `%${search}%`)));
  if (status === "active") conditions.push(eq(usersTable.isActive, true));
  if (status === "inactive") conditions.push(eq(usersTable.isActive, false));
  conditions.push(isNull(usersTable.deletedAt));
  conditions.push(eq(usersTable.role, "user"));
  if (req.userRole === "admin") conditions.push(eq(usersTable.createdByAdminId, req.user.id));
  const where = and(...conditions);

  const users = await db.select().from(usersTable).where(where)
    .limit(limit).offset((page - 1) * limit);
  // Count the filtered set, not the whole table: the previous total ignored
  // `search` and `status`, so a filtered page reported the wrong page count.
  const [{ count: total }] = await db.select({ count: count() }).from(usersTable).where(where);
  return res.json({ users: users.map(mapUser), total: Number(total) });
});

router.post("/", requireAdmin, validateBody(CreateUserBody), async (req: Req, res) => {
  const { name, email, password, role, subscriptionStatus, subscriptionEnd } = req.body;
  if (!name || !email || !password || !role) return res.status(400).json({ error: "Required fields missing" });

  if (req.userRole === "admin" && role !== "user") {
    return res.status(403).json({ error: "Admins can create user accounts only." });
  }
  if (role !== "user") {
    return res.status(403).json({ error: "Use the superadmin admin-account flow for privileged accounts." });
  }

  const policyFailure = await validatePassword(password);
  if (policyFailure) return res.status(400).json({ error: policyFailure.message });

  const normalisedEmail = String(email).toLowerCase();

  const result = await db.transaction(async (tx) => {
    if (req.userRole === "admin") {
      // Lock the manager row so concurrent requests cannot spend the same
      // remaining slot twice.
      const [manager] = await tx.select({ userLimit: usersTable.userLimit })
        .from(usersTable)
        .where(and(
          eq(usersTable.id, req.user.id),
          eq(usersTable.role, "admin"),
          isNull(usersTable.deletedAt),
        ))
        .for("update");
      if (!manager) return { kind: "manager-missing" as const };

      const [{ count: currentCount }] = await tx.select({ count: count() })
        .from(usersTable)
        .where(and(
          eq(usersTable.createdByAdminId, req.user.id),
          eq(usersTable.role, "user"),
          isNull(usersTable.deletedAt),
        ));
      const current = Number(currentCount);
      if (current >= manager.userLimit) {
        return { kind: "limit" as const, current, limit: manager.userLimit };
      }
    }

    const [taken] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, normalisedEmail)).limit(1);
    if (taken) {
      return { kind: "duplicate" as const };
    }

    const [user] = await tx.insert(usersTable).values({
      name,
      email: normalisedEmail,
      passwordHash: await hashPassword(String(password)),
      role: "user",
      isActive: true,
      subscriptionStatus,
      subscriptionEnd,
      createdByAdminId: req.userRole === "admin" ? req.user.id : null,
    }).returning();
    return { kind: "created" as const, user };
  });

  if (result.kind === "manager-missing") {
    return res.status(403).json({ error: "Administrator account is no longer active." });
  }
  if (result.kind === "limit") {
    return res.status(402).json({
      error: "User limit reached. Request additional capacity for superadmin review before creating another user.",
      code: "user_limit_reached",
      currentUsers: result.current,
      userLimit: result.limit,
      amountInr: 1000,
      currency: "INR",
    });
  }
  if (result.kind === "duplicate") return res.status(409).json({ error: "That email address is already registered" });

  const user = result.user;
  await recordAudit({
    ...actorFrom(req), action: "user.created", targetType: "user", targetId: user.id,
    details: { email: user.email, role: user.role, createdByAdminId: req.userRole === "admin" ? req.user.id : null },
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

router.get("/:id", validateParams(IdParam), async (req: Req, res) => {
  if (req.userRole !== "admin" && req.userRole !== "superadmin" && req.userId !== req.validatedParams.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const [user] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, req.validatedParams.id), isNull(usersTable.deletedAt))).limit(1);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (req.userRole === "admin" && user.createdByAdminId !== req.user.id) {
    return res.status(404).json({ error: "User not found" });
  }
  return res.json(mapUser(user));
});

router.patch("/:id", requireAdmin, validateParams(IdParam), validateBody(UpdateUserBody),
  async (req: Req, res) => {
    const targetId = req.validatedParams.id;
    const { name, email, role, subscriptionStatus, subscriptionEnd } = req.body;

    const [before] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!before || before.deletedAt) return res.status(404).json({ error: "User not found" });
    if (req.userRole === "admin" && before.createdByAdminId !== req.user.id) {
      return res.status(404).json({ error: "User not found" });
    }

    // Confirmation is required to CHANGE a role, not merely to send the field.
    // The admin edit form posts the whole record including the unchanged role,
    // so gating on presence made every save fail — a subscription edit is not
    // a privilege change and must not demand a password.
    if (role && role !== before.role) {
      if (req.userRole !== "superadmin" || role === "admin" || before.role === "superadmin") {
        return res.status(403).json({ error: "Use an administrator invitation to grant admin access." });
      }
      const stepUp = await verifyStepUp(req);
      if (!stepUp.ok) return sendStepUpFailure(res, stepUp);

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
router.delete("/:id", requireAdmin, validateParams(IdParam), async (req: Req, res) => {
  const targetId = req.validatedParams.id;

  const selfGuard = assertNotSelf(req.user.id, targetId);
  if (selfGuard) return res.status(409).json({ error: selfGuard });

  const [before] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
  if (!before || before.deletedAt) return res.status(404).json({ error: "User not found" });
  if (req.userRole === "admin" && before.createdByAdminId !== req.user.id) {
    return res.status(404).json({ error: "User not found" });
  }

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

router.patch("/:id/toggle-status", requireAdmin, validateParams(IdParam), validateBody(ToggleStatusBody), async (req: Req, res) => {
  const targetId = req.validatedParams.id;
  const { isActive } = req.body;

  const [before] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, targetId), isNull(usersTable.deletedAt))).limit(1);
  if (!before) return res.status(404).json({ error: "User not found" });
  if (req.userRole === "admin" && before.createdByAdminId !== req.user.id) {
    return res.status(404).json({ error: "User not found" });
  }
  if (before.role !== "user" && req.userRole !== "superadmin") {
    return res.status(403).json({ error: "Only a superadmin can change an administrator account." });
  }

  if (!isActive) {
    const selfGuard = assertNotSelf(req.user.id, targetId);
    if (selfGuard) return res.status(409).json({ error: selfGuard });
    if (before.role === "admin") {
      const guard = await assertNotLastAdmin(before, "user");
      if (guard) return res.status(409).json({ error: guard });
    }
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
router.post("/:id/reset-password", requireAdmin, validateParams(IdParam),
  validateBody(ResetPasswordBody), requireStepUp, async (req: Req, res) => {
    const targetId = req.validatedParams.id;
    const { newPassword } = req.body;

    const policyFailure = await validatePassword(newPassword);
    if (policyFailure) return res.status(400).json({ error: policyFailure.message });

    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    if (!target || target.deletedAt) return res.status(404).json({ error: "User not found" });
    if (req.userRole === "admin" && target.createdByAdminId !== req.user.id) {
      return res.status(404).json({ error: "User not found" });
    }
    if (target.role !== "user" && req.userRole !== "superadmin") {
      return res.status(403).json({ error: "Only a superadmin can reset an administrator's password." });
    }

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
