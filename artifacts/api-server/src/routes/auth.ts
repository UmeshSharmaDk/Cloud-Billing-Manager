import { Router } from "express";
import { db, usersTable, businessesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { logger } from "../lib/logger";
import { config } from "../lib/config";
import { AUTH_COOKIE, setSessionCookies, clearSessionCookies } from "../lib/cookies";
import {
  hashPassword,
  verifyPassword,
  spendVerificationTime,
} from "../lib/password";
import { validateBody } from "../middleware/validate";
import { LoginBody, RegisterBody, ChangePasswordBody } from "../schemas";
import { validatePassword } from "../lib/password-policy";
import {
  authIpLimiter,
  anyLocked,
  recordFailures,
  clearFailures,
  userKey,
  emailKey,
} from "../middleware/rate-limit";

const router = Router();

const JWT_SECRET = config.jwtSecret;

function generateToken(userId: number, role: string): string {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: number; role: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: number; role: string };
  } catch (err) {
    // An expired token is routine; anything else usually means the signing key
    // changed or the token was tampered with, and a bare `catch {}` hid the
    // difference between "sign in again" and "this deployment is misconfigured".
    if (!(err instanceof jwt.TokenExpiredError)) {
      logger.warn({ err: (err as Error)?.name }, "Rejected a malformed session token");
    }
    return null;
  }
}

const PLAN_EXPIRED_MESSAGE =
  "Plan Expired. Please contact Admin to renew your subscription.";

/**
 * Whether a user's subscription has lapsed. Admins are not subscribers, and a
 * null `subscriptionEnd` means "no end date", so neither expires.
 */
export function isSubscriptionExpired(user: {
  role: string;
  subscriptionEnd: string | null;
}): boolean {
  if (user.role === "admin") return false;
  if (!user.subscriptionEnd) return false;
  const end = new Date(`${user.subscriptionEnd}T23:59:59.999Z`);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < Date.now();
}

/**
 * Authenticate the bearer token and load the current user.
 *
 * The token is proof of identity only. Everything the authorization checks
 * depend on — role, active flag, subscription, business — is read from the
 * database on every request. Previously `role` was trusted straight out of a
 * seven-day-old token, so demoting an admin, deactivating an account for
 * non-payment, or signing out left the holder with full access until the token
 * happened to expire.
 */
/**
 * Read the session token from the `HttpOnly` cookie, falling back to a bearer
 * header for native clients that have no cookie jar.
 */
function readToken(req: any): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  const cookie = req.cookies?.[AUTH_COOKIE];
  return typeof cookie === "string" && cookie.length > 0 ? cookie : null;
}

export async function requireAuth(req: any, res: any, next: any) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .limit(1);

  // The account was removed after the token was issued. `deletedAt` is the
  // soft-delete marker — without this check a deleted user kept full access
  // for as long as their token lived.
  if (!user || user.deletedAt) return res.status(401).json({ error: "Invalid token" });

  if (!user.isActive) {
    return res.status(403).json({ error: PLAN_EXPIRED_MESSAGE });
  }
  if (isSubscriptionExpired(user)) {
    return res.status(403).json({ error: PLAN_EXPIRED_MESSAGE });
  }

  req.user = user;
  req.userId = user.id;
  // Read from the row, not the token.
  req.userRole = user.role;
  next();
}

export function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
}

/**
 * Resolve the caller's tenant and expose it as `req.businessId`.
 *
 * Every tenant-scoped router previously carried its own copy of a
 * `getBusinessId` helper that re-queried the user on each request — a second
 * lookup of the row `requireAuth` had already read. Routes that used it inside
 * a `:id` handler also asserted the result non-null (`businessId!`) without
 * checking, so a user with no business produced a query against a null tenant
 * rather than a clean error. Chain this after `requireAuth` instead.
 */
export function requireBusiness(req: any, res: any, next: any) {
  const businessId = req.user?.businessId ?? null;
  if (!businessId) return res.status(400).json({ error: "No business" });
  req.businessId = businessId;
  next();
}

router.post("/login", authIpLimiter, validateBody(LoginBody), async (req: any, res) => {
  const { email, password } = req.body;
  const normalisedEmail = email.toLowerCase();

  // Checked before any work is done, so a locked-out attacker cannot even make
  // us hash a candidate password.
  const locked = await anyLocked([emailKey(normalisedEmail)]);
  if (locked) {
    const retryAfter = Math.ceil((locked.getTime() - Date.now()) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "Too many failed attempts. Try again later.",
    });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalisedEmail)).limit(1);
  if (!user || user.deletedAt) {
    // Spend the same work as a real verification so the response time does not
    // reveal whether the address has an account.
    await spendVerificationTime(password);
    await recordFailures([emailKey(normalisedEmail)]);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const { valid, needsRehash } = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    await recordFailures([emailKey(normalisedEmail), userKey(user.id)]);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  await clearFailures([emailKey(normalisedEmail), userKey(user.id)]);

  // The password was correct but is still stored under the superseded SHA-256
  // scheme (or weaker Argon2 parameters). This is the only moment we hold the
  // plaintext, so upgrade the stored hash now. A failure here must not block a
  // legitimate login — the next sign-in will try again.
  if (needsRehash) {
    try {
      await db.update(usersTable)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(usersTable.id, user.id));
    } catch (err) {
      req.log?.error({ err, userId: user.id }, "Failed to upgrade password hash");
    }
  }

  if (!user.isActive || isSubscriptionExpired(user)) {
    return res.status(403).json({ error: PLAN_EXPIRED_MESSAGE });
  }

  const token = generateToken(user.id, user.role);
  setSessionCookies(res, token);
  return res.json({
    token,
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      isActive: user.isActive, subscriptionStatus: user.subscriptionStatus,
      subscriptionEnd: user.subscriptionEnd, businessId: user.businessId,
      createdAt: user.createdAt,
    }
  });
});

router.post("/register", authIpLimiter, validateBody(RegisterBody), async (req: any, res) => {
  const { name, email, password, businessName, gstin } = req.body;
  const normalisedEmail = email.toLowerCase();

  const policyFailure = await validatePassword(password);
  if (policyFailure) return res.status(400).json({ error: policyFailure.message });

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, normalisedEmail)).limit(1);
  if (existing.length > 0) {
    // Charge this against the lockout counters. The response still reveals
    // that the address is taken — closing that needs an email round trip this
    // product has no provider for (see F-14 in SECURITY-REVIEW.md) — but bulk
    // enumeration now runs into the same backoff as password guessing.
    await recordFailures([emailKey(normalisedEmail)]);
    return res.status(400).json({ error: "Email already registered" });
  }

  const [user] = await db.insert(usersTable).values({
    name, email: normalisedEmail, passwordHash: await hashPassword(password),
    role: "user", isActive: true, subscriptionStatus: "trial",
    subscriptionEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
  }).returning();

  const [business] = await db.insert(businessesTable).values({
    userId: user.id, name: businessName, gstin: gstin ?? null, invoicePrefix: "INV",
  }).returning();

  await db.update(usersTable).set({ businessId: business.id }).where(eq(usersTable.id, user.id));

  const token = generateToken(user.id, user.role);
  setSessionCookies(res, token);
  return res.status(201).json({
    token,
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      isActive: user.isActive, subscriptionStatus: user.subscriptionStatus,
      subscriptionEnd: user.subscriptionEnd, businessId: business.id,
      createdAt: user.createdAt,
    }
  });
});

router.get("/me", requireAuth, async (req: any, res) => {
  const user = req.user;
  return res.json({
    id: user.id, name: user.name, email: user.email, role: user.role,
    isActive: user.isActive, subscriptionStatus: user.subscriptionStatus,
    subscriptionEnd: user.subscriptionEnd, businessId: user.businessId,
    createdAt: user.createdAt,
  });
});

/**
 * Clear the session cookie. This was a stub that returned `{ success: true }`
 * without touching any state — the client deleted its own copy of the token
 * and the server kept honouring it.
 *
 * A bearer token issued to a native client still cannot be revoked from here;
 * that needs the `tokenVersion` column noted in the report, and is not part of
 * this change.
 */
/**
 * Change your own password.
 *
 * There was no way to do this: the only route to a new password was asking an
 * administrator to reset it, which meant a third party chose and knew it.
 */
router.post(
  "/change-password",
  requireAuth,
  validateBody(ChangePasswordBody),
  async (req: any, res) => {
    const { currentPassword, newPassword } = req.body;

    const { valid } = await verifyPassword(req.user.passwordHash, currentPassword);
    if (!valid) {
      await recordFailures([userKey(req.user.id)]);
      return res.status(403).json({ error: "Current password is incorrect" });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: "New password must differ from the current one" });
    }

    const policyFailure = await validatePassword(newPassword);
    if (policyFailure) return res.status(400).json({ error: policyFailure.message });

    await db
      .update(usersTable)
      .set({ passwordHash: await hashPassword(newPassword) })
      .where(eq(usersTable.id, req.user.id));

    await clearFailures([userKey(req.user.id)]);

    // Re-issue the session so the cookie is not one minted under the old
    // credential. A bearer token held elsewhere still outlives this.
    setSessionCookies(res, generateToken(req.user.id, req.user.role));

    return res.json({ success: true });
  },
);

router.post("/logout", (_req, res) => {
  clearSessionCookies(res);
  return res.json({ success: true });
});

export default router;
