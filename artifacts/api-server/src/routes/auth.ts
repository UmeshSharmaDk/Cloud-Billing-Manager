import { Router } from "express";
import crypto from "node:crypto";
import { db, rootDb, runInSystemScope, usersTable, businessesTable, revokedTokensTable, pendingRegistrationsTable, adminInvitationsTable } from "@workspace/db";
import { eq, and, lt, gt, isNull, or, sql } from "drizzle-orm";
import QRCode from "qrcode";
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
import {
  LoginBody, RegisterBody, ChangePasswordBody, VerifyRegistrationBody, AcceptAdminInvitationBody,
  MfaSetupBody, MfaCodeBody, MfaLoginBody,
} from "../schemas";
import { recordAudit, actorFrom } from "../lib/audit";
import { mapUser } from "../lib/serialise";
import { verifyStepUp, sendStepUpFailure } from "../middleware/step-up";
import {
  generateTotpSecret, matchTotp, otpauthUri, generateRecoveryCodes, hashRecoveryCode, looksLikeTotp,
} from "../lib/mfa";
import { validatePassword } from "../lib/password-policy";
import { sendQuietly, verificationMessage, alreadyRegisteredMessage } from "../lib/mailer";
import type { AuthedRequest } from "../lib/http";
import { openTenantScope } from "../middleware/tenant-scope";
import {
  authIpLimiter,
  registerIpLimiter,
  tenantApiLimiter,
  tenantConcurrencyLimiter,
  REGISTER_RECIPIENT_LIMIT,
  reserveAttempt,
  clearFailures,
  consumeBudget,
  userKey,
  mfaKey,
  loginKey,
  registerKey,
} from "../middleware/rate-limit";

const router = Router();

/**
 * Handlers that run after `requireAuth`. The middleware below take a bare
 * request on purpose — they are what attaches `user` in the first place, so
 * they cannot require it to already be there.
 */
type Req = AuthedRequest<any, any, any>;

const JWT_SECRET = config.jwtSecret;

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

interface TokenPayload {
  userId: number;
  role: string;
  v?: number;
  /** This token's own id, so signing out can revoke it alone. */
  jti?: string;
  exp?: number;
  /**
   * Set only on the short-lived token that sits between a correct password and
   * a correct second factor. It names an account but is not a session:
   * `requireAuth` refuses it, and `/auth/mfa/login` accepts nothing else.
   */
  purpose?: "mfa";
}

/** Long enough to open an authenticator app, short enough to be useless later. */
const MFA_TOKEN_TTL_SECONDS = 5 * 60;

function generateMfaToken(userId: number, tokenVersion: number): string {
  return jwt.sign({ userId, v: tokenVersion, purpose: "mfa" }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: MFA_TOKEN_TTL_SECONDS,
  });
}

function generateToken(userId: number, role: string, tokenVersion: number): string {
  // `v` is the account's session generation. Bumping the column invalidates
  // every token already issued, which is the only way to revoke a bearer token
  // held by a client with no cookie jar.
  //
  // `jti` identifies this one session. Ordinary sign-out records it in
  // `revoked_tokens` rather than bumping `v`, so signing out on a phone does
  // not sign the same person out on their laptop.
  return jwt.sign({ userId, role, v: tokenVersion, jti: crypto.randomUUID() }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as TokenPayload;
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

/** Whether this token id has been signed out. */
async function isTokenRevoked(jti: string): Promise<boolean> {
  const [row] = await db
    .select({ jti: revokedTokensTable.jti })
    .from(revokedTokensTable)
    .where(eq(revokedTokensTable.jti, jti))
    .limit(1);
  return Boolean(row);
}

/**
 * Record a token as signed out until it would have expired anyway.
 *
 * Keyed on the token id, so it revokes one session and leaves the account's
 * other devices alone. Storing the expiry is what lets the row be pruned: a
 * revocation stops mattering once the token it names is expired.
 */
async function revokeToken(payload: TokenPayload): Promise<void> {
  if (!payload.jti) return;
  const expiresAt = payload.exp
    ? new Date(payload.exp * 1000)
    : new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);
  try {
    await db
      .insert(revokedTokensTable)
      .values({ jti: payload.jti, expiresAt })
      .onConflictDoNothing();
  } catch (err) {
    // A sign-out that cannot be recorded must still clear the cookie, but the
    // token stays live until it expires — that is worth a loud line.
    logger.error({ err }, "Could not record a token revocation");
  }
}

/**
 * Drop revocations for tokens that have expired on their own.
 *
 * Without this the table would grow by one row per sign-out forever. With it,
 * it holds only the sign-outs of the last seven days.
 */
export async function pruneRevokedTokens(): Promise<number> {
  const deleted = await db
    .delete(revokedTokensTable)
    .where(lt(revokedTokensTable.expiresAt, new Date()))
    .returning({ jti: revokedTokensTable.jti });
  return deleted.length;
}

const PLAN_EXPIRED_MESSAGE =
  "Plan Expired. Please contact Admin to renew your subscription.";

const dayPassed = (day: string | null) => {
  if (!day) return false;
  const end = new Date(`${day}T23:59:59.999Z`);
  return !Number.isNaN(end.getTime()) && end.getTime() < Date.now();
};

/**
 * Plans belong to administrators: the superadmin sets an end date on each
 * admin (`subscriptionEnd` on the admin's row). Once it passes, that admin and
 * every user they created are refused. The superadmin has no plan.
 */
export async function isPlanExpired(user: { role: string; subscriptionEnd: string | null; subscriptionStatus: string | null; createdByAdminId: number | null }): Promise<boolean> {
  if (user.role === "superadmin") return false;
  if (user.role === "admin") return dayPassed(user.subscriptionEnd);
  // Older per-user settings still count if someone set them; the UI no longer offers them.
  if (user.subscriptionStatus === "expired" || dayPassed(user.subscriptionEnd)) return true;
  if (!user.createdByAdminId) return false;
  const [admin] = await db.select({ subscriptionEnd: usersTable.subscriptionEnd })
    .from(usersTable).where(eq(usersTable.id, user.createdByAdminId)).limit(1);
  return dayPassed(admin?.subscriptionEnd ?? null);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- attaches the typed shape
export async function requireAuth(req: any, res: any, next: any) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const payload = verifyToken(token);
  // A half-finished sign-in is not a session.
  if (!payload || payload.purpose) return res.status(401).json({ error: "Invalid token" });

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
  if ((await isPlanExpired(user))) {
    return res.status(403).json({ error: PLAN_EXPIRED_MESSAGE });
  }

  // A token minted before the account's sessions were revoked. Tokens issued
  // before this column existed carry no `v`; treat them as generation 0 so an
  // existing session is not broken by the upgrade itself.
  if ((payload.v ?? 0) !== user.tokenVersion) {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }

  // This exact session was signed out. Clearing the cookie only removed the
  // browser's copy; a token captured beforehand — from the login response body,
  // a proxy log, a shared machine — stayed valid for the rest of its seven days
  // and could simply be replayed as a bearer token.
  if (payload.jti && (await isTokenRevoked(payload.jti))) {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }

  req.user = user;
  req.userId = user.id;
  // Read from the row, not the token.
  req.userRole = user.role;
  next();
}

const isAdminRole = (role: string | undefined) => role === "admin" || role === "superadmin";

/**
 * Administrators must have a second factor before any admin route answers.
 *
 * A password alone could reset any user's password or change a role. The check
 * is on the row, like the role itself, and enabling MFA revokes every session
 * issued before it, so an administrator's session that works here was either
 * opened with a code or minted by the enrolment that verified one.
 *
 * Enrolment itself is under `/auth/mfa`, which only needs `requireAuth`, so an
 * administrator without MFA can always reach it.
 */
const MFA_ENROLMENT_REQUIRED = {
  error: "Set up two-factor authentication to use the admin panel.",
  code: "mfa_enrolment_required",
} as const;

/** Whether this account may use admin powers right now. */
export function hasAdminAccess(user: { role: string; mfaEnabledAt: Date | null } | undefined): boolean {
  return Boolean(user && isAdminRole(user.role) && user.mfaEnabledAt);
}

export function requireAdmin(req: any, res: any, next: any) {
  if (!isAdminRole(req.user?.role)) return res.status(403).json({ error: "Forbidden" });
  if (!req.user.mfaEnabledAt) return res.status(403).json(MFA_ENROLMENT_REQUIRED);
  next();
}

export function requireSuperadmin(req: any, res: any, next: any) {
  if (req.user?.role !== "superadmin") return res.status(403).json({ error: "Forbidden" });
  if (!req.user.mfaEnabledAt) return res.status(403).json(MFA_ENROLMENT_REQUIRED);
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
/**
 * `?asUser=<id>` lets an administrator read one of their users' records
 * (invoices, purchases, reports) through the ordinary routes. Read-only: any
 * other method is refused. An admin reaches only users they created; the
 * superadmin reaches any business user.
 */
async function viewedBusinessId(req: any): Promise<number | { status: number; error: string }> {
  const id = Number(req.query.asUser);
  if (!Number.isInteger(id) || id <= 0) return { status: 400, error: "Invalid asUser" };
  if (req.method !== "GET") return { status: 403, error: "Viewing another user's records is read-only." };
  if (!hasAdminAccess(req.user)) return { status: 403, error: "Forbidden" };
  const [target] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, id), eq(usersTable.role, "user"), isNull(usersTable.deletedAt))).limit(1);
  if (!target || (req.user.role === "admin" && target.createdByAdminId !== req.user.id)) {
    return { status: 404, error: "User not found" };
  }
  if (!target.businessId) return { status: 400, error: "This user has no business yet." };
  return target.businessId;
}

export async function requireBusiness(req: any, res: any, next: any) {
  let businessId = req.user?.businessId ?? null;
  if (req.query?.asUser !== undefined) {
    const viewed = await viewedBusinessId(req);
    if (typeof viewed !== "number") return res.status(viewed.status).json({ error: viewed.error });
    businessId = viewed;
  }
  if (!businessId) return res.status(400).json({ error: "No business" });
  req.businessId = businessId;
  // Before the scope is opened, so a rejected request never takes a pooled
  // connection: the limiter exists to protect them.
  tenantApiLimiter(req, res, (err?: unknown) => {
    if (err) return next(err);
    tenantConcurrencyLimiter(req, res, (err2?: unknown) => {
      if (err2) return next(err2);
      // Resolving the tenant and pinning it to the database session are the same
      // decision, so they happen in the same place. No route opts in, and none can
      // forget to.
      openTenantScope(req, res, next, businessId);
    });
  });
}

router.post("/login", authIpLimiter, validateBody(LoginBody), async (req: Req, res) => {
  const { email, password } = req.body;
  const normalisedEmail = email.toLowerCase();

  // Scoped to this source address as well as the account: see `loginKey`. A
  // lock keyed on the email alone lets anyone lock anyone out.
  const attemptKey = loginKey(normalisedEmail, req.ip);

  // The attempt is counted before anything is checked, so a burst of parallel
  // guesses cannot all pass the lock test before the first failure is written,
  // and a locked-out attacker cannot even make us hash a candidate password. A
  // success clears the count below.
  const locked = await reserveAttempt([attemptKey]);
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
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const { valid, needsRehash } = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    // Not `userKey`: that one guards step-up and change-password, and a failed
    // login is by definition made by someone who is not the account's owner.
    return res.status(401).json({ error: "Invalid credentials" });
  }

  await clearFailures([attemptKey, userKey(user.id)]);

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

  if (!user.isActive || (await isPlanExpired(user))) {
    return res.status(403).json({ error: PLAN_EXPIRED_MESSAGE });
  }

  // The password was right, but it is only half of this account's credential.
  // No session and no cookie: the caller gets a token good for one thing, five
  // minutes, which is to present a code to `/auth/mfa/login`.
  if (user.mfaEnabledAt) {
    return res.json({ mfaRequired: true, mfaToken: generateMfaToken(user.id, user.tokenVersion) });
  }

  const token = generateToken(user.id, user.role, user.tokenVersion);
  setSessionCookies(res, token);
  return res.json({ token, user: mapUser(user) });
});

/**
 * Spend a second-factor code: an authenticator code, or one recovery code.
 *
 * Both are spent by a conditional UPDATE, so two requests carrying the same
 * code cannot both succeed. An authenticator code is refused unless its step is
 * later than the last one accepted, which also refuses a code seen over a
 * shoulder and replayed within its 30 seconds.
 */
async function spendMfaCode(
  user: { id: number; mfaSecret: string | null },
  rawCode: string,
  { allowRecovery }: { allowRecovery: boolean },
): Promise<"totp" | "recovery" | null> {
  const code = rawCode.trim();
  if (looksLikeTotp(code)) {
    if (!user.mfaSecret) return null;
    const step = matchTotp(user.mfaSecret, code);
    if (step === null) return null;
    const [row] = await db.update(usersTable)
      .set({ mfaLastStep: step })
      .where(and(
        eq(usersTable.id, user.id),
        or(isNull(usersTable.mfaLastStep), lt(usersTable.mfaLastStep, step)),
      ))
      .returning({ id: usersTable.id });
    return row ? "totp" : null;
  }
  if (!allowRecovery) return null;
  const hash = hashRecoveryCode(code);
  const [row] = await db.update(usersTable)
    .set({ mfaRecoveryCodes: sql`array_remove(${usersTable.mfaRecoveryCodes}, ${hash})` })
    .where(and(eq(usersTable.id, user.id), sql`${hash} = ANY(${usersTable.mfaRecoveryCodes})`))
    .returning({ id: usersTable.id });
  return row ? "recovery" : null;
}

const MFA_SIGN_IN_EXPIRED = { error: "Your sign-in has expired. Please sign in again." } as const;

/**
 * The second half of signing in to an account with MFA.
 *
 * Guesses are counted against `mfaKey`, which a correct password never clears;
 * see `rate-limit.ts`. Everything the password step checked is checked again,
 * because up to five minutes have passed and the account may have changed.
 */
router.post("/mfa/login", authIpLimiter, validateBody(MfaLoginBody), async (req: Req, res) => {
  const payload = verifyToken(req.body.mfaToken);
  if (!payload || payload.purpose !== "mfa") return res.status(401).json(MFA_SIGN_IN_EXPIRED);

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId)).limit(1);
  if (!user || user.deletedAt || !user.mfaEnabledAt || (payload.v ?? 0) !== user.tokenVersion) {
    return res.status(401).json(MFA_SIGN_IN_EXPIRED);
  }
  if (!user.isActive || (await isPlanExpired(user))) {
    return res.status(403).json({ error: PLAN_EXPIRED_MESSAGE });
  }

  const lockedUntil = await reserveAttempt([mfaKey(user.id)]);
  if (lockedUntil) {
    res.setHeader("Retry-After", String(Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)));
    return res.status(429).json({ error: "Too many failed attempts. Try again later." });
  }

  const spent = await spendMfaCode(user, req.body.code, { allowRecovery: true });
  if (!spent) return res.status(401).json({ error: "That code is not valid." });
  await clearFailures([mfaKey(user.id)]);

  if (spent === "recovery") {
    await recordAudit({
      actorId: user.id, actorEmail: user.email, action: "user.mfa_recovery_code_used",
      targetType: "user", targetId: user.id, sourceIp: req.ip,
      details: { remaining: Math.max(0, (user.mfaRecoveryCodes?.length ?? 1) - 1) },
    });
  }

  const token = generateToken(user.id, user.role, user.tokenVersion);
  setSessionCookies(res, token);
  return res.json({ token, user: mapUser(user) });
});

/** Only administrators enrol: they are who `requireAdmin` asks it of. */
function requireAdminRole(req: any, res: any, next: any) {
  if (!isAdminRole(req.user?.role)) return res.status(403).json({ error: "Forbidden" });
  next();
}

/**
 * Start enrolment: a new secret, shown once.
 *
 * Needs the account's password, not just its session. Otherwise a stolen
 * session could enrol the thief's authenticator and lock the owner out. The
 * secret does not count until `/mfa/enable` confirms a code from it.
 */
router.post("/mfa/setup", requireAuth, requireAdminRole, validateBody(MfaSetupBody), async (req: Req, res) => {
  if (req.user.mfaEnabledAt) {
    return res.status(409).json({ error: "Two-factor authentication is already on for this account." });
  }
  const stepUp = await verifyStepUp(req);
  if (!stepUp.ok) return sendStepUpFailure(res, stepUp);

  const secret = generateTotpSecret();
  await db.update(usersTable)
    .set({ mfaSecret: secret, mfaLastStep: null })
    .where(and(eq(usersTable.id, req.user.id), isNull(usersTable.mfaEnabledAt)));

  const uri = otpauthUri(secret, req.user.email);
  return res.json({ secret, otpauthUri: uri, qrCodeDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) });
});

/**
 * Finish enrolment with a code from the new authenticator.
 *
 * Every other session this account holds is revoked: they were opened with a
 * password alone. This device gets a fresh session, and the recovery codes are
 * returned here and never again.
 */
router.post("/mfa/enable", requireAuth, requireAdminRole, validateBody(MfaCodeBody), async (req: Req, res) => {
  if (req.user.mfaEnabledAt) {
    return res.status(409).json({ error: "Two-factor authentication is already on for this account." });
  }
  if (!req.user.mfaSecret) {
    return res.status(400).json({ error: "Start setup first." });
  }

  const lockedUntil = await reserveAttempt([mfaKey(req.user.id)]);
  if (lockedUntil) {
    res.setHeader("Retry-After", String(Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)));
    return res.status(429).json({ error: "Too many failed attempts. Try again later." });
  }

  const step = matchTotp(req.user.mfaSecret, req.body.code);
  if (step === null) return res.status(400).json({ error: "That code is not valid. Check the time on your phone and try again." });

  const recoveryCodes = generateRecoveryCodes();
  // Conditional on the secret this request checked the code against, so a
  // second `/mfa/setup` racing this one cannot enable a secret nobody verified.
  const [updated] = await db.update(usersTable)
    .set({
      mfaEnabledAt: new Date(),
      mfaLastStep: step,
      mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode),
      tokenVersion: req.user.tokenVersion + 1,
    })
    .where(and(
      eq(usersTable.id, req.user.id),
      isNull(usersTable.mfaEnabledAt),
      eq(usersTable.mfaSecret, req.user.mfaSecret),
    ))
    .returning();
  if (!updated) return res.status(409).json({ error: "Setup changed while this was in progress. Start again." });
  await clearFailures([mfaKey(req.user.id)]);

  await recordAudit({
    ...actorFrom(req), action: "user.mfa_enabled", targetType: "user", targetId: req.user.id,
  });

  const token = generateToken(updated.id, updated.role, updated.tokenVersion);
  setSessionCookies(res, token);
  return res.json({ recoveryCodes, token });
});

/**
 * Replace the recovery codes. Takes an authenticator code, not a recovery
 * code: whoever holds one leftover code should not be able to mint ten more.
 */
router.post("/mfa/recovery-codes", requireAuth, requireAdminRole, validateBody(MfaCodeBody), async (req: Req, res) => {
  if (!req.user.mfaEnabledAt) {
    return res.status(400).json({ error: "Two-factor authentication is not on for this account." });
  }
  const lockedUntil = await reserveAttempt([mfaKey(req.user.id)]);
  if (lockedUntil) {
    res.setHeader("Retry-After", String(Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)));
    return res.status(429).json({ error: "Too many failed attempts. Try again later." });
  }
  const spent = await spendMfaCode(req.user, req.body.code, { allowRecovery: false });
  if (!spent) return res.status(400).json({ error: "That code is not valid." });
  await clearFailures([mfaKey(req.user.id)]);

  const recoveryCodes = generateRecoveryCodes();
  await db.update(usersTable)
    .set({ mfaRecoveryCodes: recoveryCodes.map(hashRecoveryCode) })
    .where(eq(usersTable.id, req.user.id));
  await recordAudit({
    ...actorFrom(req), action: "user.mfa_recovery_codes_regenerated", targetType: "user", targetId: req.user.id,
  });
  return res.json({ recoveryCodes });
});

/** How long a verification link stays usable. */
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Tokens are stored hashed; only the emailed copy is usable. */
const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * The one response registration ever gives.
 *
 * Built once and returned from every path — taken address, free address, even a
 * mail failure — because the moment two paths differ in status, body or shape,
 * the endpoint is an oracle again.
 */
const REGISTRATION_ACCEPTED = {
  message:
    "If that address can be registered, we have sent it a link to finish setting up the account.",
} as const;

/**
 * Registration.
 *
 * This used to answer `400 "Email already registered"` for a taken address and
 * `201` with a session for a free one, which let anyone test an address for an
 * account at the cost of one request. It now answers `202` with the same body
 * either way and settles the difference by email: a link for an address that is
 * free, and a "someone tried to register you" note for one that is not.
 *
 * The cost is that signing up no longer signs you in — it cannot, because a
 * session in the response would be exactly the difference we are removing.
 *
 * Both paths do the same work, in the same order, including a database write.
 * Skipping the write when the address is taken would replace the oracle we
 * closed with a faster one: a few milliseconds of missing latency is as good an
 * answer as a 400, given enough samples. The taken path therefore performs the
 * same insert and removes it again in the same transaction.
 *
 * No password is taken here. It used to be, and whoever submitted the form chose
 * it: submit a victim's address with a password you know, and when they opened
 * the link the account they were signed in to had a password you held too. The
 * password is now chosen by whoever opens the link — see `/verify-registration`.
 *
 * Nothing here may depend on whether the address is taken — that includes what
 * this route charges. It used to charge the *login* lockout when the address
 * existed, so a run of registrations followed by one login told you whether the
 * account was real (429 versus 401). The recipient budget below is charged on
 * every request and is a separate counter that login never reads.
 *
 * There is deliberately no `systemScope` here. It would hold a pooled
 * connection for the whole request — across the breach lookup, the hash and the
 * mail send — and the insert below needs a second one, so a burst of
 * registrations could each hold one connection while waiting for another and
 * starve every authenticated request. `users` and `pending_registrations`
 * carry no tenant policy, so nothing here needs a scope.
 */
router.post("/register", registerIpLimiter, validateBody(RegisterBody), async (req: Req, res) => {
  const { name, email, businessName, gstin } = req.body;
  const normalisedEmail = email.toLowerCase();

  // Bounds how much mail one address can be sent from this endpoint, and so
  // stops it being used to spam or phish a third party. Charged before the
  // lookup and for every request, so a taken address and a free one are
  // indistinguishable — the count says nothing about whether an account exists.
  const withinBudget = await consumeBudget(registerKey(normalisedEmail), REGISTER_RECIPIENT_LIMIT);
  if (!withinBudget) {
    return res.status(429).json({ error: "Too many registration attempts for this address. Try again later." });
  }

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.email, normalisedEmail)).limit(1);

  const token = crypto.randomBytes(32).toString("base64url");
  const pendingRow = {
    tokenHash: hashToken(token),
    email: normalisedEmail,
    name,
    businessName,
    gstin: gstin ?? null,
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
  };

  // Written on `rootDb`, which commits on its own connection before anything
  // below runs.
  //
  // An email is not a response: it leaves the process the moment it is sent, and
  // the person it names can act on it at once. A link that names a row which is
  // not yet durable fails as "that link is invalid or has expired" for a link
  // that was valid. Scoped routes now commit before they respond too (see
  // `middleware/tenant-scope.ts`), but nothing that sends mail should depend on
  // which middleware happens to wrap it, and this route has no scope at all.
  //
  // Both branches run the same shape: insert a row that is already expired, then
  // one more write, in one transaction. The free address arms the row by giving
  // it its real expiry; the taken one deletes it. Same statements, same round
  // trips, same commit — so how long the request takes says nothing about which
  // branch ran, and a row that fails to arm is left expired rather than usable.
  await rootDb.transaction(async (tx) => {
    const [row] = await tx.insert(pendingRegistrationsTable)
      .values({ ...pendingRow, expiresAt: new Date(0) })
      .returning({ id: pendingRegistrationsTable.id });
    if (existing) {
      await tx.delete(pendingRegistrationsTable).where(eq(pendingRegistrationsTable.id, row.id));
    } else {
      await tx.update(pendingRegistrationsTable)
        .set({ expiresAt: pendingRow.expiresAt })
        .where(eq(pendingRegistrationsTable.id, row.id));
    }
  });

  if (existing) {
    await sendQuietly(alreadyRegisteredMessage(normalisedEmail));
    return res.status(202).json(REGISTRATION_ACCEPTED);
  }

  // In the fragment, which browsers never send to a server: a query string ends
  // up in access logs, proxy logs and the Referer of anything the page loads,
  // and the token is a credential until it is used.
  const link = `${config.appBaseUrl}/verify#token=${encodeURIComponent(token)}`;
  await sendQuietly(verificationMessage(normalisedEmail, link));
  return res.status(202).json(REGISTRATION_ACCEPTED);
});

/**
 * Finish a registration by proving control of the mailbox.
 *
 * The account is created here rather than at submission, which is what stops
 * someone reserving an address they do not own: until this runs, a pending row
 * is just an intention. Several may exist for one address; the first to arrive
 * wins and the rest are deleted with it.
 */
router.post("/verify-registration", authIpLimiter, validateBody(VerifyRegistrationBody), async (req: Req, res) => {
  const { token, password } = req.body;

  // `rootDb` throughout: `pending_registrations` carries no tenant policy, and
  // this route deliberately does not run inside the request-scoped transaction.
  const [pending] = await rootDb.select().from(pendingRegistrationsTable)
    .where(and(
      eq(pendingRegistrationsTable.tokenHash, hashToken(token)),
      gt(pendingRegistrationsTable.expiresAt, new Date()),
    ))
    .limit(1);

  // One message for "no such token", "already used" and "expired": a caller
  // holding a token learns whether it works, and nothing else.
  if (!pending) {
    return res.status(400).json({ error: "That link is invalid or has expired. Please register again." });
  }

  // The password is chosen here, by whoever holds the link — which is the
  // person who controls the mailbox. Checked after the token so garbage tokens
  // cost nothing, and before the token is spent so a refused password can be
  // corrected and retried on the same link.
  const policyFailure = await validatePassword(password);
  if (policyFailure) return res.status(400).json({ error: policyFailure.message });
  const passwordHash = await hashPassword(password);

  // Its own system scope, opened here rather than as route middleware.
  //
  // The account must be committed before its session exists, because the caller
  // uses that session on its very next request. Opening the scope here means the
  // transaction commits when this callback returns, before the session is even
  // created — independent of when any surrounding middleware commits. It still
  // needs to be a *system* scope rather than a bare transaction, because
  // `businesses` carries a tenant policy and there is no tenant yet to scope to —
  // the row being inserted is what creates one.
  const created = await runInSystemScope(rootDb, async () => {
    const tx = db;
    // Re-checked inside the transaction: two links for the same address could
    // be redeemed at once, and the unique index is on the token, not the email.
    const [taken] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, pending.email)).limit(1);
    if (taken) return null;

    const [user] = await tx.insert(usersTable).values({
      name: pending.name, email: pending.email, passwordHash,
      role: "user", isActive: true, subscriptionStatus: "trial",
      subscriptionEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    }).returning();

    const [business] = await tx.insert(businessesTable).values({
      userId: user.id, name: pending.businessName, gstin: pending.gstin, invoicePrefix: "INV",
    }).returning();

    const [linked] = await tx.update(usersTable).set({ businessId: business.id })
      .where(eq(usersTable.id, user.id)).returning();

    // Every pending registration for this address is spent, not just this one.
    await tx.delete(pendingRegistrationsTable).where(eq(pendingRegistrationsTable.email, pending.email));

    return { user: linked, business };
  });

  if (!created) {
    return res.status(409).json({ error: "That address has already been registered. Please sign in." });
  }

  const session = generateToken(created.user.id, created.user.role, created.user.tokenVersion);
  setSessionCookies(res, session);
  return res.status(201).json({
    token: session,
    user: mapUser(created.user),
  });
});

/**
 * An administrator invited by a superadmin chooses their own password. The
 * invite token is hashed at rest, checked for expiry, then locked and consumed
 * in the same transaction that creates the account.
 */
router.post("/accept-admin-invite", authIpLimiter, validateBody(AcceptAdminInvitationBody),
  async (req: Req, res) => {
    const rawToken = String(req.body.token);
    const hashedToken = hashToken(rawToken);
    const [pending] = await rootDb.select().from(adminInvitationsTable)
      .where(and(
        eq(adminInvitationsTable.tokenHash, hashedToken),
        isNull(adminInvitationsTable.usedAt),
        gt(adminInvitationsTable.expiresAt, new Date()),
      ))
      .limit(1);
    if (!pending) {
      return res.status(400).json({ error: "That invitation is invalid or has expired." });
    }

    const policyFailure = await validatePassword(String(req.body.password));
    if (policyFailure) return res.status(400).json({ error: policyFailure.message });
    const passwordHash = await hashPassword(String(req.body.password));

    const admin = await rootDb.transaction(async (tx) => {
      const [locked] = await tx.select().from(adminInvitationsTable)
        .where(and(
          eq(adminInvitationsTable.id, pending.id),
          eq(adminInvitationsTable.tokenHash, hashedToken),
          isNull(adminInvitationsTable.usedAt),
          gt(adminInvitationsTable.expiresAt, new Date()),
        ))
        .for("update")
        .limit(1);
      if (!locked) return null;

      const [existing] = await tx.select({ id: usersTable.id }).from(usersTable)
        .where(eq(usersTable.email, locked.email)).limit(1);
      if (existing) return null;

      const [created] = await tx.insert(usersTable).values({
        name: locked.name,
        email: locked.email,
        passwordHash,
        role: "admin",
        isActive: true,
        userLimit: locked.userLimit,
      }).returning();
      await tx.update(adminInvitationsTable).set({ usedAt: new Date() })
        .where(eq(adminInvitationsTable.id, locked.id));
      return created;
    });

    if (!admin) {
      return res.status(400).json({ error: "That invitation is invalid or has expired." });
    }

    await recordAudit({
      actorId: admin.id, actorEmail: admin.email, action: "admin.created",
      targetType: "user", targetId: admin.id, sourceIp: req.ip,
      details: { invitationId: pending.id, invitedByAdminId: pending.invitedByAdminId, userLimit: admin.userLimit },
    });

    const session = generateToken(admin.id, admin.role, admin.tokenVersion);
    setSessionCookies(res, session);
    return res.status(201).json({
      token: session,
      user: mapUser(admin),
    });
  });

/** Drop pending registrations whose links have expired. */
export async function prunePendingRegistrations(): Promise<number> {
  const deleted = await db.delete(pendingRegistrationsTable)
    .where(lt(pendingRegistrationsTable.expiresAt, new Date()))
    .returning({ id: pendingRegistrationsTable.id });
  return deleted.length;
}

router.get("/me", requireAuth, async (req: Req, res) => res.json(mapUser(req.user)));

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
  async (req: Req, res) => {
    const { currentPassword, newPassword } = req.body;

    // Same guard as step-up and for the same reason: this endpoint verifies a
    // password behind a session, so a stolen session could otherwise guess the
    // account's own password at unlimited rate, each attempt costing a 19 MiB
    // Argon2 hash. The `user:<id>` counter below has always been written here;
    // this is the read that makes it mean something.
    // The attempt is counted before the password is checked, so guesses sent in
    // parallel cannot all pass the lock test before any failure is recorded.
    const lockedUntil = await reserveAttempt([userKey(req.user.id)]);
    if (lockedUntil) {
      res.setHeader("Retry-After", String(Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)));
      return res.status(429).json({ error: "Too many failed attempts. Try again later." });
    }

    const { valid } = await verifyPassword(req.user.passwordHash, currentPassword);
    if (!valid) {
      return res.status(403).json({ error: "Current password is incorrect" });
    }
    await clearFailures([userKey(req.user.id)]);

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: "New password must differ from the current one" });
    }

    const policyFailure = await validatePassword(newPassword);
    if (policyFailure) return res.status(400).json({ error: policyFailure.message });

    // Bumping tokenVersion revokes every session issued under the old password
    // — including bearer tokens on other devices, which is the point of a
    // password change.
    const [updated] = await db
      .update(usersTable)
      .set({
        passwordHash: await hashPassword(newPassword),
        tokenVersion: req.user.tokenVersion + 1,
      })
      .where(eq(usersTable.id, req.user.id))
      .returning();

    await clearFailures([userKey(req.user.id)]);

    // Re-issue this device's session at the new generation, so the person who
    // just changed their password is not signed out by their own action.
    setSessionCookies(res, generateToken(updated.id, updated.role, updated.tokenVersion));

    return res.json({ success: true });
  },
);

/**
 * Sign out this device.
 *
 * Authenticated on purpose: it used to take a bare request and only clear
 * cookies, which left the token itself valid for the rest of its seven days.
 * Anyone holding a copy could replay it after the user had signed out.
 */
router.post("/logout", requireAuth, async (req: Req, res) => {
  const token = readToken(req);
  const payload = token ? verifyToken(token) : null;
  if (payload) await revokeToken(payload);
  clearSessionCookies(res);
  return res.json({ success: true });
});

/**
 * Sign out on every device.
 *
 * Ordinary logout ends the session on the device that asked, which is what
 * people expect. This revokes them all — the thing to reach for when a laptop
 * goes missing, and the only way to invalidate a bearer token already issued.
 */
router.post("/logout-all", requireAuth, async (req: Req, res) => {
  await db
    .update(usersTable)
    .set({ tokenVersion: req.user.tokenVersion + 1 })
    .where(eq(usersTable.id, req.user.id));
  clearSessionCookies(res);
  return res.json({ success: true });
});

export default router;
