/**
 * Pins each request to its tenant for the duration, so the row-level security
 * policies have something to match against.
 *
 * Two ordering details matter, and getting either wrong fails silently:
 *
 *   1. `next()` runs *inside* the async context, after `set_config`. Calling it
 *      outside would leave handlers running with no scope, where the proxied
 *      `db` falls back to the pool — a connection with no `app.business_id` —
 *      and a fail-closed policy returns nothing. The symptom would be an empty
 *      app, not an error.
 *
 *   2. The transaction is held until the response is written, because queries
 *      keep arriving until then. It is committed on the way out, or rolled back
 *      if the handler produced a 5xx, so a request that blew up half-way does
 *      not leave its partial writes behind.
 */

import type { NextFunction, Request, Response } from "express";
import { rootDb, runInTenantScope, runInSystemScope } from "@workspace/db";

/** Thrown to make the transaction roll back; never surfaces to the client. */
class RollbackOnServerError extends Error {
  constructor() {
    super("Rolling back: the handler returned a server error");
  }
}

/**
 * Resolves when the response has been written, or rejects when it was a 5xx so
 * the surrounding transaction rolls back rather than committing a half-done
 * request.
 */
function responseSettled(res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = () => {
      if (res.statusCode >= 500) reject(new RollbackOnServerError());
      else resolve();
    };
    res.once("finish", settle);
    res.once("close", settle);
  });
}

function handleScopeFailure(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // A deliberate rollback, already reported to the client by the error handler.
  if (err instanceof RollbackOnServerError) return;
  if (!res.headersSent) return next(err);
  (req as Request & { log?: { error: Function } }).log?.error(
    { err },
    "Tenant scope failed after the response was sent",
  );
}

/** Run the rest of the request pinned to one tenant. */
export function openTenantScope(
  req: Request,
  res: Response,
  next: NextFunction,
  businessId: number,
): void {
  const settled = responseSettled(res);
  void runInTenantScope(rootDb, businessId, async () => {
    next();
    await settled;
  }).catch((err) => handleScopeFailure(err, req, res, next));
}

/**
 * Run the rest of the request with the policies suspended.
 *
 * For the handful of operations that legitimately span tenants: the platform
 * admin's dashboards, and registration, which creates a business before any
 * tenant exists to scope to. Everything reached this way is trusting its own
 * authorization checks with no database-level net underneath, which is why it
 * is applied per-router rather than being available by default.
 */
export function systemScope(req: Request, res: Response, next: NextFunction): void {
  const settled = responseSettled(res);
  void runInSystemScope(rootDb, async () => {
    next();
    await settled;
  }).catch((err) => handleScopeFailure(err, req, res, next));
}
