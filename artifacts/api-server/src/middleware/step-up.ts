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

/**
 * Requires `confirmPassword` in the body: the caller's own password, not the
 * target's. The field is consumed here so it never reaches a handler and
 * cannot be written or logged downstream.
 */
export async function requireStepUp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = (req as Request & { user?: { id: number; passwordHash: string } }).user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  const confirmPassword = body?.["confirmPassword"];

  if (typeof confirmPassword !== "string" || confirmPassword.length === 0) {
    res.status(403).json({
      error: "Confirm your own password to perform this action.",
      code: "step_up_required",
    });
    return;
  }

  const { valid } = await verifyPassword(user.passwordHash, confirmPassword);
  if (!valid) {
    await recordFailures([userKey(user.id)]);
    res.status(403).json({ error: "Password confirmation failed." });
    return;
  }

  if (body) delete body["confirmPassword"];
  next();
}
