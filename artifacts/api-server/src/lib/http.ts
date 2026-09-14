/**
 * Request types for authenticated handlers.
 *
 * Every handler was typed `(req: any, res)`, which switched TypeScript off at
 * exactly the point where the security-relevant state lives: `req.user`,
 * `req.businessId`, the validated body and query. A handler that read the wrong
 * field, or forgot the tenant filter, compiled cleanly.
 */

import type { Request } from "express";
import type { User } from "@workspace/db";

/** A request that has been through `requireAuth`. */
export interface AuthedRequest<Body = unknown, Query = unknown, Params = unknown>
  extends Request {
  /** The user row, re-read from the database on this request. */
  user: User;
  userId: number;
  userRole: string;
  body: Body;
  /** Set by `validateQuery` — `req.query` itself is read-only in Express 5. */
  validatedQuery: Query;
  /** Set by `validateParams`. */
  validatedParams: Params;
}

/**
 * A request that has also been through `requireBusiness`, so the caller's
 * tenant is resolved. Handlers that take this cannot forget to scope a query
 * to a business, because there is no other way to obtain the id.
 */
export interface TenantRequest<Body = unknown, Query = unknown, Params = unknown>
  extends AuthedRequest<Body, Query, Params> {
  businessId: number;
}

/** The shape `validateParams(IdParam)` produces. */
export interface IdParams {
  id: number;
}
