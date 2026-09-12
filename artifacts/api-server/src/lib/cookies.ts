/**
 * Session and CSRF cookies.
 *
 * The session token used to be handed to the browser and kept in
 * `localStorage`, where any script on the origin could read it — so a single
 * XSS anywhere in the app, or in any dependency, yielded a seven-day
 * credential. It is now issued as an `HttpOnly` cookie, which script cannot
 * read at all.
 *
 * The token is still returned in the login response body, because the shared
 * API client also serves native clients that have no cookie jar. Accepting
 * both does not weaken the browser case: script cannot read an `HttpOnly`
 * cookie, so it has nothing to put in an `Authorization` header.
 *
 * Cookies bring CSRF into scope, which `middleware/csrf.ts` handles.
 */

import crypto from "node:crypto";
import type { Response } from "express";
import { config } from "./config";

/** Session token. Never readable by script. */
export const AUTH_COOKIE = "gst_session";

/**
 * CSRF token. Deliberately readable by script: the browser copies it into the
 * `X-CSRF-Token` header, and the server checks the two match. A cross-site
 * attacker can cause the cookie to be *sent* but cannot read it to build the
 * matching header.
 */
export const CSRF_COOKIE = "gst_csrf";

export const CSRF_HEADER = "x-csrf-token";

/** Matches the `expiresIn: "7d"` on the token itself. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function baseOptions() {
  return {
    sameSite: config.cookie.sameSite,
    secure: config.cookie.secure,
    path: "/",
    maxAge: MAX_AGE_MS,
  } as const;
}

export function newCsrfToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Issue the session cookie.
 *
 * The CSRF cookie is deliberately not set here: `middleware/csrf.ts` is its
 * single writer and has already put one on this response if the client lacked
 * it. Setting it in both places emitted two `Set-Cookie` headers for the same
 * name — last-one-wins, so harmless, but confusing to anyone reading a trace.
 */
export function setSessionCookies(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, { ...baseOptions(), httpOnly: true });
}

/**
 * Clear both cookies. The attributes must match the ones they were set with
 * or the browser keeps the originals.
 */
export function clearSessionCookies(res: Response): void {
  const { sameSite, secure, path } = baseOptions();
  res.clearCookie(AUTH_COOKIE, { sameSite, secure, path, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { sameSite, secure, path, httpOnly: false });
}
