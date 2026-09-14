/**
 * CSRF protection for cookie-authenticated requests.
 *
 * Moving the session token into a cookie (see `lib/cookies.ts`) closes the
 * XSS-exfiltration problem but opens the one cookies always have: the browser
 * attaches them to cross-site requests automatically. This is the standard
 * double-submit defence — the server issues a random token in a
 * script-readable cookie, and the client echoes it in a header. A cross-site
 * attacker can cause the cookie to be sent but, blocked by the same-origin
 * policy, cannot read it to build the matching header.
 */

import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AUTH_COOKIE, CSRF_COOKIE, CSRF_HEADER, newCsrfToken } from "../lib/cookies";
import { config } from "../lib/config";

/** Methods that must not change state, and so need no token. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Make sure every client holds a CSRF token before it needs one.
 *
 * Without this, a visitor arriving with a session cookie but no CSRF cookie —
 * after a deploy, or a cleared cookie — would have every write rejected with
 * no way to recover but to sign out.
 */
export function issueCsrfCookie(req: Request, res: Response, next: NextFunction): void {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (!cookies?.[CSRF_COOKIE]) {
    res.cookie(CSRF_COOKIE, newCsrfToken(), {
      sameSite: config.cookie.sameSite,
      secure: config.cookie.secure,
      path: "/",
      httpOnly: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
  next();
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();

  // A bearer token is never attached automatically by a browser, so a request
  // carrying one cannot have been forged cross-site. Native clients and
  // server-to-server callers land here.
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return next();

  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;

  // No session cookie means nothing to ride on — an unauthenticated POST such
  // as login or register. Those are still protected once a session exists.
  if (!cookies?.[AUTH_COOKIE]) return next();

  const cookieToken = cookies[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  if (
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string" ||
    cookieToken.length === 0 ||
    !constantTimeEquals(cookieToken, headerToken)
  ) {
    res.status(403).json({
      error: "Invalid or missing CSRF token. Reload the page and try again.",
    });
    return;
  }

  next();
}
