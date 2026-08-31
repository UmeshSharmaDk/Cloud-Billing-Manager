import { Router } from "express";
import { db, usersTable, businessesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { config } from "../lib/config";
import {
  hashPassword,
  verifyPassword,
  spendVerificationTime,
  MAX_PASSWORD_BYTES,
} from "../lib/password";

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

export function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });
  req.userId = payload.userId;
  req.userRole = payload.role;
  next();
}

export function requireAdmin(req: any, res: any, next: any) {
  if (req.userRole !== "admin") return res.status(403).json({ error: "Forbidden" });
  next();
}

router.post("/login", async (req: any, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, String(email).toLowerCase())).limit(1);
  if (!user) {
    // Spend the same work as a real verification so the response time does not
    // reveal whether the address has an account.
    await spendVerificationTime(String(password));
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const { valid, needsRehash } = await verifyPassword(user.passwordHash, String(password));
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  // The password was correct but is still stored under the superseded SHA-256
  // scheme (or weaker Argon2 parameters). This is the only moment we hold the
  // plaintext, so upgrade the stored hash now. A failure here must not block a
  // legitimate login — the next sign-in will try again.
  if (needsRehash) {
    try {
      await db.update(usersTable)
        .set({ passwordHash: await hashPassword(String(password)) })
        .where(eq(usersTable.id, user.id));
    } catch (err) {
      req.log?.error({ err, userId: user.id }, "Failed to upgrade password hash");
    }
  }

  if (!user.isActive) return res.status(403).json({ error: "Plan Expired. Please contact Admin to renew your subscription." });

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

router.post("/register", async (req, res) => {
  const { name, email, password, businessName, gstin } = req.body;
  if (!name || !email || !password || !businessName) {
    return res.status(400).json({ error: "name, email, password, businessName required" });
  }
  if (Buffer.byteLength(String(password), "utf8") > MAX_PASSWORD_BYTES) {
    return res.status(400).json({ error: `Password must be at most ${MAX_PASSWORD_BYTES} bytes` });
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, String(email).toLowerCase())).limit(1);
  if (existing.length > 0) return res.status(400).json({ error: "Email already registered" });

  const [user] = await db.insert(usersTable).values({
    name, email: String(email).toLowerCase(), passwordHash: await hashPassword(String(password)),
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
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId)).limit(1);
  if (!user) return res.status(404).json({ error: "User not found" });
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
