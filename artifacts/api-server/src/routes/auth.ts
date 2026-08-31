import { Router } from "express";
import { db, usersTable, businessesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { config } from "../lib/config";
import {
  hashPassword,
  verifyPassword,
  spendVerificationTime,
} from "../lib/password";
import { validateBody } from "../middleware/validate";
import { LoginBody, RegisterBody } from "../schemas";
import {
  authIpLimiter,
  anyLocked,
  recordFailures,
  clearFailures,
  ipKey,
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
  } catch {
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
export async function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const payload = verifyToken(auth.slice(7));
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId))
    .limit(1);

  // The account was deleted after the token was issued.
  if (!user) return res.status(401).json({ error: "Invalid token" });

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
  const sourceIp = req.ip ?? "unknown";

  // Both the address and the source are checked before any work is done, so a
  // locked-out attacker cannot even make us hash a candidate password.
  const locked = await anyLocked([ipKey(sourceIp), emailKey(normalisedEmail)]);
  if (locked) {
    const retryAfter = Math.ceil((locked.getTime() - Date.now()) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "Too many failed attempts. Try again later.",
    });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalisedEmail)).limit(1);
  if (!user) {
    // Spend the same work as a real verification so the response time does not
    // reveal whether the address has an account.
    await spendVerificationTime(password);
    await recordFailures([ipKey(sourceIp), emailKey(normalisedEmail)]);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const { valid, needsRehash } = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    await recordFailures([ipKey(sourceIp), emailKey(normalisedEmail), userKey(user.id)]);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  await clearFailures([ipKey(sourceIp), emailKey(normalisedEmail), userKey(user.id)]);

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

router.post("/register", authIpLimiter, validateBody(RegisterBody), async (req, res) => {
  const { name, email, password, businessName, gstin } = req.body;
  const normalisedEmail = email.toLowerCase();

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, normalisedEmail)).limit(1);
  if (existing.length > 0) return res.status(400).json({ error: "Email already registered" });

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

router.post("/logout", (_req, res) => {
  return res.json({ success: true });
});

export default router;
