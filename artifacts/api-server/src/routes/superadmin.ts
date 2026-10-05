import { Router } from "express";
import crypto from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import {
  db,
  rootDb,
  usersTable,
  adminInvitationsTable,
  capacityRequestsTable,
} from "@workspace/db";
import { requireAuth, requireAdmin, requireSuperadmin } from "./auth";
import { validateBody, validateParams } from "../middleware/validate";
import {
  CreateAdminInvitationBody,
  CreateCapacityRequestBody,
  IdParam,
  ReviewCapacityRequestBody,
  UpdateAdminLimitBody,
} from "../schemas";
import { recordAudit, actorFrom } from "../lib/audit";
import { verifyStepUp, sendStepUpFailure } from "../middleware/step-up";
import { mapUser } from "../lib/serialise";
import type { AuthedRequest, IdParams } from "../lib/http";
import { mailer, adminInvitationMessage } from "../lib/mailer";
import { config } from "../lib/config";

export const DEFAULT_ADMIN_USER_LIMIT = 15;
export const ADDITIONAL_USER_PRICE_INR = 1000;
const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

const router = Router();
// Authenticate first. Nothing here touches a tenant-scoped table, so the router
// takes no policy-free scope: each handler that writes more than one row uses its
// own transaction, and none holds a request-long connection open while it waits
// on mail. Admins reach the capacity-request routes, so the router admits admins
// and each privileged route adds `requireSuperadmin`.
router.use(requireAuth, requireAdmin);

type Req = AuthedRequest<any, any, IdParams>;
const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

function serializeInvitation(invite: typeof adminInvitationsTable.$inferSelect) {
  return {
    id: invite.id,
    name: invite.name,
    email: invite.email,
    userLimit: invite.userLimit,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  };
}

router.get("/admins", requireSuperadmin, async (_req: Req, res) => {
  const admins = await db.select().from(usersTable)
    .where(and(eq(usersTable.role, "admin"), isNull(usersTable.deletedAt)))
    .orderBy(desc(usersTable.createdAt));

  const result = await Promise.all(admins.map(async (admin) => {
    const [{ count: userCount }] = await db.select({ count: count() })
      .from(usersTable)
      .where(and(
        eq(usersTable.createdByAdminId, admin.id),
        eq(usersTable.role, "user"),
        isNull(usersTable.deletedAt),
      ));
    const currentUsers = Number(userCount);
    return {
      ...mapUser(admin),
      userCount: currentUsers,
      availableSlots: Math.max(0, admin.userLimit - currentUsers),
      additionalUserPriceInr: ADDITIONAL_USER_PRICE_INR,
    };
  }));

  return res.json({
    admins: result,
    defaultUserLimit: DEFAULT_ADMIN_USER_LIMIT,
    additionalUserPriceInr: ADDITIONAL_USER_PRICE_INR,
  });
});

router.post("/admin-invitations", requireSuperadmin, validateBody(CreateAdminInvitationBody), async (req: Req, res) => {
  if (config.mail.kind === "log") {
    return res.status(503).json({ error: "Email delivery is not configured in this environment." });
  }
  const stepUp = await verifyStepUp(req);
  if (!stepUp.ok) return sendStepUpFailure(res, stepUp);

  const { name, email, userLimit } = req.body;
  const normalisedEmail = email.toLowerCase();
  const [taken] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, normalisedEmail)).limit(1);
  if (taken) return res.status(409).json({ error: "That email address is already registered" });

  // An expired, unused invitation no longer reserves the mailbox. The partial
  // unique index prevents two simultaneous active invitations for one address.
  let rawToken = "";
  let invite: typeof adminInvitationsTable.$inferSelect;
  try {
    invite = await rootDb.transaction(async (tx) => {
      await tx.delete(adminInvitationsTable).where(and(
        eq(adminInvitationsTable.email, normalisedEmail),
        isNull(adminInvitationsTable.usedAt),
        lt(adminInvitationsTable.expiresAt, new Date()),
      ));

      rawToken = crypto.randomBytes(32).toString("base64url");
      const [created] = await tx.insert(adminInvitationsTable).values({
        tokenHash: tokenHash(rawToken),
        name,
        email: normalisedEmail,
        userLimit,
        invitedByAdminId: req.user.id,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      }).returning();
      return created;
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      return res.status(409).json({ error: "An active invitation already exists for this email" });
    }
    throw err;
  }

  const link = `${config.appBaseUrl}/accept-admin-invite#token=${encodeURIComponent(rawToken)}`;
  rawToken = "";
  try {
    await mailer.send(adminInvitationMessage(normalisedEmail, link));
  } catch (err) {
    req.log?.error({ error: (err as Error)?.name }, "Could not send administrator invitation");
    await rootDb.delete(adminInvitationsTable).where(eq(adminInvitationsTable.id, invite.id));
    return res.status(502).json({ error: "The invitation email could not be sent. You can try again." });
  }

  await recordAudit({
    ...actorFrom(req),
    action: "admin.invitation_sent",
    targetType: "admin_invitation",
    targetId: invite.id,
    details: { email: invite.email, userLimit: invite.userLimit },
  });

  return res.status(201).json(serializeInvitation(invite));
});

router.get("/admin-invitations", requireSuperadmin, async (_req: Req, res) => {
  const invitations = await db.select().from(adminInvitationsTable)
    .where(and(isNull(adminInvitationsTable.usedAt), gt(adminInvitationsTable.expiresAt, new Date())))
    .orderBy(desc(adminInvitationsTable.createdAt));
  return res.json({ invitations: invitations.map(serializeInvitation) });
});

router.patch("/admins/:id/limit", requireSuperadmin, validateParams(IdParam),
  validateBody(UpdateAdminLimitBody), async (req: Req, res) => {
    const targetId = req.validatedParams.id;
    const stepUp = await verifyStepUp(req);
    if (!stepUp.ok) return sendStepUpFailure(res, stepUp);

    const result = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(usersTable)
        .where(and(eq(usersTable.id, targetId), eq(usersTable.role, "admin"), isNull(usersTable.deletedAt)))
        .for("update")
        .limit(1);
      if (!before) return { error: "not-found" as const };

      const [{ count: userCount }] = await tx.select({ count: count() })
        .from(usersTable)
        .where(and(
          eq(usersTable.createdByAdminId, targetId),
          eq(usersTable.role, "user"),
          isNull(usersTable.deletedAt),
        ));
      const currentUsers = Number(userCount);
      if (req.body.userLimit < currentUsers) {
        return { error: "below-usage" as const, currentUsers };
      }

      const [admin] = await tx.update(usersTable)
        .set({ userLimit: req.body.userLimit })
        .where(and(eq(usersTable.id, targetId), eq(usersTable.role, "admin")))
        .returning();
      return { before, admin };
    });
    if ("error" in result) {
      if (result.error === "below-usage") {
        return res.status(409).json({ error: `The limit cannot be lower than current usage (${result.currentUsers}).` });
      }
      return res.status(404).json({ error: "Admin account not found" });
    }

    await recordAudit({
      ...actorFrom(req),
      action: "admin.user_limit_changed",
      targetType: "user",
      targetId,
      details: { before: result.before.userLimit, after: result.admin.userLimit },
    });

    return res.json(mapUser(result.admin));
  });

router.get("/capacity-requests", requireAdmin, async (req: Req, res) => {
  const conditions = req.userRole === "admin"
    ? [eq(capacityRequestsTable.adminId, req.user.id)]
    : [];
  const rows = await db.select().from(capacityRequestsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(capacityRequestsTable.createdAt));
  const adminIds = [...new Set(rows.map((row) => row.adminId))];
  const admins = adminIds.length
    ? await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable).where(inArray(usersTable.id, adminIds))
    : [];
  const adminById = new Map(admins.map((admin) => [admin.id, admin]));
  return res.json({
    requests: rows.map((row) => ({
      id: row.id,
      adminId: row.adminId,
      adminName: adminById.get(row.adminId)?.name ?? "Admin account",
      adminEmail: adminById.get(row.adminId)?.email ?? "",
      additionalUsers: row.additionalUsers,
      amountInr: row.amountInr,
      status: row.status,
      reviewedAt: row.reviewedAt,
      grantedUserLimit: row.grantedUserLimit,
      createdAt: row.createdAt,
    })),
    additionalUserPriceInr: ADDITIONAL_USER_PRICE_INR,
  });
});

router.post("/capacity-requests", requireAdmin, validateBody(CreateCapacityRequestBody),
  async (req: Req, res) => {
    if (req.userRole !== "admin") {
      return res.status(403).json({ error: "Only tenant administrators can request user capacity." });
    }

    let failure: "not-at-limit" | "already-pending" | null = null;
    let created: typeof capacityRequestsTable.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      const [admin] = await tx.select({ userLimit: usersTable.userLimit })
        .from(usersTable)
        .where(and(
          eq(usersTable.id, req.user.id),
          eq(usersTable.role, "admin"),
          isNull(usersTable.deletedAt),
        ))
        .for("update");
      if (!admin) {
        failure = "not-at-limit";
        return;
      }

      const [{ count: userCount }] = await tx.select({ count: count() })
        .from(usersTable)
        .where(and(
          eq(usersTable.createdByAdminId, req.user.id),
          eq(usersTable.role, "user"),
          isNull(usersTable.deletedAt),
        ));
      if (Number(userCount) < admin.userLimit) {
        failure = "not-at-limit";
        return;
      }

      const [pending] = await tx.select({ id: capacityRequestsTable.id })
        .from(capacityRequestsTable)
        .where(and(
          eq(capacityRequestsTable.adminId, req.user.id),
          eq(capacityRequestsTable.status, "pending"),
        ))
        .limit(1);
      if (pending) {
        failure = "already-pending";
        return;
      }

      [created] = await tx.insert(capacityRequestsTable).values({
        adminId: req.user.id,
        additionalUsers: req.body.additionalUsers,
        amountInr: req.body.additionalUsers * ADDITIONAL_USER_PRICE_INR,
      }).returning();
    });

    if (failure === "not-at-limit") {
      return res.status(409).json({ error: "A capacity request is available when your current user limit is reached." });
    }
    if (failure === "already-pending" || !created) {
      return res.status(409).json({ error: "You already have a pending capacity request." });
    }

    await recordAudit({
      ...actorFrom(req),
      action: "capacity_request.created",
      targetType: "capacity_request",
      targetId: created.id,
      details: { additionalUsers: created.additionalUsers, amountInr: created.amountInr },
    });

    return res.status(201).json({
      id: created.id,
      adminId: req.user.id,
      adminName: req.user.name,
      adminEmail: req.user.email,
      additionalUsers: created.additionalUsers,
      amountInr: created.amountInr,
      status: created.status,
      reviewedAt: created.reviewedAt,
      grantedUserLimit: created.grantedUserLimit,
      createdAt: created.createdAt,
    });
  });

router.patch("/capacity-requests/:id/review", requireSuperadmin, validateParams(IdParam),
  validateBody(ReviewCapacityRequestBody), async (req: Req, res) => {
    const stepUp = await verifyStepUp(req);
    if (!stepUp.ok) return sendStepUpFailure(res, stepUp);

    const review = await db.transaction(async (tx) => {
      const [request] = await tx.select().from(capacityRequestsTable)
        .where(and(
          eq(capacityRequestsTable.id, req.validatedParams.id),
          eq(capacityRequestsTable.status, "pending"),
        ))
        .for("update");
      if (!request) return { error: "not-found" as const };

      const [admin] = await tx.select().from(usersTable)
        .where(and(eq(usersTable.id, request.adminId), eq(usersTable.role, "admin"), isNull(usersTable.deletedAt)))
        .for("update");
      if (!admin) return { error: "not-found" as const };

      const reviewedAt = new Date();
      if (req.body.decision === "decline") {
        const [updated] = await tx.update(capacityRequestsTable).set({
          status: "declined",
          reviewedByAdminId: req.user.id,
          reviewedAt,
        }).where(eq(capacityRequestsTable.id, request.id)).returning();
        return { request: updated, admin };
      }

      const requestedLimit = req.body.userLimit;
      const minimumLimit = admin.userLimit + request.additionalUsers;
      if (requestedLimit === undefined || requestedLimit < minimumLimit) {
        return { error: "limit-too-low" as const, minimumLimit };
      }

      const [updatedAdmin] = await tx.update(usersTable).set({ userLimit: requestedLimit })
        .where(eq(usersTable.id, admin.id)).returning();
      const [updatedRequest] = await tx.update(capacityRequestsTable).set({
        status: "approved",
        reviewedByAdminId: req.user.id,
        reviewedAt,
        grantedUserLimit: updatedAdmin.userLimit,
      }).where(eq(capacityRequestsTable.id, request.id)).returning();
      return { request: updatedRequest, admin: updatedAdmin };
    });

    if ("error" in review) {
      if (review.error === "limit-too-low") {
        return res.status(409).json({
          error: `The new limit must be at least ${review.minimumLimit} to cover this request.`,
        });
      }
      return res.status(404).json({ error: "Pending capacity request not found." });
    }

    await recordAudit({
      ...actorFrom(req),
      action: req.body.decision === "approve" ? "capacity_request.approved" : "capacity_request.declined",
      targetType: "capacity_request",
      targetId: review.request.id,
      details: {
        adminId: review.request.adminId,
        decision: req.body.decision,
        grantedUserLimit: review.request.grantedUserLimit,
      },
    });
    if (req.body.decision === "approve") {
      await recordAudit({
        ...actorFrom(req),
        action: "admin.user_limit_changed",
        targetType: "user",
        targetId: review.admin.id,
        details: { after: review.admin.userLimit, capacityRequestId: review.request.id },
      });
    }

    return res.json({
      id: review.request.id,
      adminId: review.admin.id,
      adminName: review.admin.name,
      adminEmail: review.admin.email,
      additionalUsers: review.request.additionalUsers,
      amountInr: review.request.amountInr,
      status: review.request.status,
      reviewedAt: review.request.reviewedAt,
      grantedUserLimit: review.request.grantedUserLimit,
      createdAt: review.request.createdAt,
    });
  });

export default router;