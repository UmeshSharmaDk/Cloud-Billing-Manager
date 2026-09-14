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
import { anyLocked, recordFailures, userKey } from "./rate-limit";

export interface StepUpResult {
  ok: boolean;
  status?: 401 | 403 | 429;
  body?: { error: string; code?: string };
  /** Seconds until the lockout lifts, for the `Retry-After` header. */
  retryAfter?: number;
}

/**
 * Send a failed step-up result.
 *
 * Every refusal goes through here so the `Retry-After` on a lockout cannot be
 * forgotten at one of the four call sites — which is exactly how the lockout
 * came to be recorded in three places and read in none.
 */
export function sendStepUpFailure(res: Response, result: StepUpResult): Response {
  if (result.retryAfter !== undefined) {
    res.setHeader("Retry-After", String(result.retryAfter));
  }
  return res.status(result.status ?? 403).json(result.body);
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

  // Consulted before anything else. `recordFailures` has always written a
  // `user:<id>` counter here, but nothing ever read it, so this check was the
  // missing half: a stolen session could guess the account's own password at
  // unlimited rate. Checking first also means a locked-out attacker cannot make
  // us spend a 19 MiB Argon2 verification per attempt.
  const lockedUntil = await anyLocked([userKey(user.id)]);
  if (lockedUntil) {
    return {
      ok: false,
      status: 429,
      retryAfter: Math.ceil((lockedUntil.getTime() - Date.now()) / 1000),
      body: { error: "Too many failed attempts. Try again later." },
    };
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
    sendStepUpFailure(res, result);
    return;
  }
  next();
}
