/**
 * Writing to the audit log.
 *
 * Every privileged mutation records who did what to whom. Two rules:
 * an audit write must never be the reason a legitimate action fails, and it
 * must never contain a credential — not a password, not a hash, not a token.
 *
 * The first rule needs more than a `try`/`catch` to hold. The admin routers run
 * the whole request inside one transaction (`systemScope`), and `db` resolves
 * to it, so a failed INSERT here does not merely throw — it aborts the
 * surrounding transaction. Postgres then refuses every later statement with
 * `25P02` and turns the eventual COMMIT into a ROLLBACK. Catching the error let
 * the handler go on to send `200` while the privileged change it had just made
 * was quietly discarded: the exact inversion of the rule above.
 *
 * So the insert runs inside a savepoint. If it fails, only the savepoint is
 * rolled back, the outer transaction stays usable, and the action commits.
 */

import { db, auditLogTable } from "@workspace/db";
import { logger } from "./logger";

export type AuditAction =
  | "user.created"
  | "user.updated"
  | "user.role_changed"
  | "user.password_reset"
  | "user.deleted"
  | "user.restored"
  | "user.status_changed"
  | "user.subscription_changed";

interface AuditInput {
  actorId: number;
  actorEmail: string;
  action: AuditAction;
  targetType: "user";
  targetId?: number | null;
  details?: Record<string, unknown>;
  sourceIp?: string | null;
}

/** Fields that must never be written to the log, whatever a caller passes. */
const REDACTED_KEYS = new Set([
  "password",
  "newPassword",
  "currentPassword",
  "confirmPassword",
  "passwordHash",
  "token",
  "secret",
]);

function scrub(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    out[key] = REDACTED_KEYS.has(key) ? "[redacted]" : value;
  }
  return out;
}

export async function recordAudit(entry: AuditInput): Promise<void> {
  try {
    // Nested inside the request's transaction this issues SAVEPOINT / ROLLBACK
    // TO SAVEPOINT, which is what contains a failure to this statement. Outside
    // one it is an ordinary transaction and behaves as before.
    await db.transaction(async (tx) => {
      await tx.insert(auditLogTable).values({
        actorId: entry.actorId,
        actorEmail: entry.actorEmail,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        details: scrub(entry.details ?? {}),
        sourceIp: entry.sourceIp ?? null,
      });
    });
  } catch (err) {
    // Losing the record is bad; failing the operator's action because we could
    // not write a log line is worse. Make the gap loud instead.
    logger.error({ err, action: entry.action, targetId: entry.targetId }, "Audit write failed");
  }
}

/** Pull the actor out of a request that has already been through requireAuth. */
export function actorFrom(req: {
  user: { id: number; email: string };
  ip?: string;
}): Pick<AuditInput, "actorId" | "actorEmail" | "sourceIp"> {
  return { actorId: req.user.id, actorEmail: req.user.email, sourceIp: req.ip ?? null };
}
