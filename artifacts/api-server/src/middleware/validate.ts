/**
 * Request validation.
 *
 * Every handler used to destructure `req.body` and hand the values straight to
 * Drizzle. Nothing checked types, ranges or lengths, so `{"email": 123}`
 * reached `email.toLowerCase()` and crashed the request, a negative quantity
 * was accepted onto a tax filing, and `PATCH` bodies wrote whatever keys they
 * carried.
 *
 * Zod object schemas strip unknown keys rather than rejecting them, so
 * attaching one to a route also removes mass assignment: only the fields the
 * schema names survive into the handler.
 */

import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

/**
 * Whether any string in `value` — or any key — contains a NUL character.
 *
 * Postgres text cannot hold one. It reaches the driver as a failed query and
 * comes back as a 500, so every text field on every route was a way to make the
 * server error on demand. Refused here, once, for body, query and params alike.
 */
function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (value === null || typeof value !== "object" || depth > 32) return false;
  if (Array.isArray(value)) return value.some((item) => containsNul(item, depth + 1));
  return Object.entries(value).some(([key, item]) => key.includes("\u0000") || containsNul(item, depth + 1));
}

function respondNul(res: Response): void {
  res.status(400).json({ error: "Invalid request", details: [{ message: "Text may not contain NUL characters" }] });
}

function respondInvalid(res: Response, error: { issues: unknown[] }): void {
  res.status(400).json({
    error: "Invalid request",
    details: error.issues,
  });
}

/** Validate and replace `req.body`. */
export function validateBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (containsNul(req.body)) return respondNul(res);
    const result = schema.safeParse(req.body);
    if (!result.success) return respondInvalid(res, result.error);
    req.body = result.data;
    next();
  };
}

/**
 * Validate the query string and expose the result as `req.validatedQuery`.
 *
 * It cannot be written back to `req.query`: Express 5 defines that as a
 * getter-only property, so assigning to it throws in strict mode. Handlers
 * read the validated, coerced copy instead — which is also what makes the
 * pagination bounds real, since `req.query` values are always strings.
 */
export function validateQuery(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (containsNul(req.query)) return respondNul(res);
    const result = schema.safeParse(req.query);
    if (!result.success) return respondInvalid(res, result.error);
    (req as unknown as { validatedQuery: unknown }).validatedQuery = result.data;
    next();
  };
}

/** Validate `:id`-style route parameters. */
export function validateParams(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (containsNul(req.params)) return respondNul(res);
    const result = schema.safeParse(req.params);
    if (!result.success) return respondInvalid(res, result.error);
    (req as unknown as { validatedParams: unknown }).validatedParams = result.data;
    next();
  };
}
