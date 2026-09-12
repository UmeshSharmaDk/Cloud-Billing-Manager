/**
 * Step-up authentication for the most destructive admin actions.
 *
 * Resetting someone's password or changing a role is enough to take over an
 * account, and a stolen session was enough to do it. Requiring the
 * administrator's own password re-establishes that a person — not a borrowed
 * cookie — is behind the request.
 */

import type { NextFunction, Request, Response } from "express";
import { verifyPassword } from "../lib/password";
import { recordFailures, userKey } from "./rate-limit";

export interface StepUpResult {
  ok: boolean;
  status?: 401 | 403;
  body?: { error: string; code?: string };
}

/**
 * Check `confirmPassword` in the body: the caller's own password, not the
 * target's. The field is consumed here so it never reaches a handler and
 * cannot be written or logged downstream.
 *
 * Exposed as a plain function as well as middleware because some actions only
 * need confirming conditionally — changing a role does, leaving it alone does
 * not, and that is not known until the target has been loaded.
 */
export async function verifyStepUp(req: Request): Promise<StepUpResult> {
  const user = (req as Request & { user?: { id: number; passwordHash: string } }).user;
  if (!user) {
    return { ok: false, status: 401, body: { error: "Unauthorized" } };
  }

  const body = req.body as Record<string, unknown> | undefined;
  const confirmPassword = body?.["confirmPassword"];

  if (typeof confirmPassword !== "string" || confirmPassword.length === 0) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "Confirm your own password to perform this action.",
        code: "step_up_required",
      },
    };
  }

  const { valid } = await verifyPassword(user.passwordHash, confirmPassword);
  if (body) delete body["confirmPassword"];

  if (!valid) {
    await recordFailures([userKey(user.id)]);
    return { ok: false, status: 403, body: { error: "Password confirmation failed." } };
  }

  return { ok: true };
}

/** Middleware form, for actions that always require confirmation. */
export async function requireStepUp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const result = await verifyStepUp(req);
  if (!result.ok) {
    res.status(result.status ?? 403).json(result.body);
    return;
  }
  next();
}
