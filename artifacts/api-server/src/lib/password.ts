/**
 * Password hashing and verification.
 *
 * New passwords are hashed with Argon2id, which generates a unique random salt
 * per password and embeds it in the returned string. Nothing else in the
 * codebase should call a hash function directly.
 *
 * Passwords created before this module existed were stored as a single round of
 * SHA-256 over `password + "gst_salt_v1"` — a fast digest with no work factor
 * and one salt shared by every user, so a single rainbow table recovered the
 * whole table. Those hashes are still accepted on login, but only long enough
 * to re-hash the plaintext with Argon2id and write it back; see
 * `verifyPassword`'s `needsRehash`. Accounts migrate transparently as their
 * owners sign in, with no forced reset.
 */

import crypto from "node:crypto";
import argon2 from "argon2";

/**
 * OWASP Password Storage Cheat Sheet baseline for Argon2id: 19 MiB of memory,
 * 2 iterations, 1 degree of parallelism. `parallelism` is set explicitly
 * because the library's own default is 4.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Upper bound on what we will feed to the KDF. Argon2 has no input-length
 * limit of its own, so without a cap a multi-megabyte "password" becomes a
 * cheap way to burn server memory and CPU.
 */
export const MAX_PASSWORD_BYTES = 1024;

/** Legacy scheme: `sha256(password + LEGACY_SALT)`, hex encoded. */
const LEGACY_SALT = "gst_salt_v1";
const LEGACY_HASH_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * A hash of a value nobody can supply, computed once at startup. Verifying
 * against it on the unknown-account path spends the same work as a real
 * verification, so response time does not distinguish "no such user" from
 * "wrong password".
 */
const decoyHash = argon2.hash(
  crypto.randomBytes(32).toString("hex"),
  ARGON2_OPTIONS,
);

// Never let a rejection here surface as an unhandled rejection; the value is
// only ever consumed inside a try/catch in `spendVerificationTime`.
decoyHash.catch(() => undefined);

function isOverLength(password: string): boolean {
  return Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES;
}

function legacyHash(password: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(password + LEGACY_SALT)
    .digest();
}

export interface PasswordVerification {
  /** Whether the supplied password matches the stored hash. */
  valid: boolean;
  /**
   * True when the password was correct but the stored hash used a superseded
   * algorithm or weaker parameters. Callers must re-hash and persist.
   */
  needsRehash: boolean;
}

/** Hash a new password. Rejects input above {@link MAX_PASSWORD_BYTES}. */
export async function hashPassword(password: string): Promise<string> {
  if (isOverLength(password)) {
    throw new Error(
      `Password exceeds the maximum of ${MAX_PASSWORD_BYTES} bytes.`,
    );
  }
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a password against a stored hash of either scheme, in constant time
 * with respect to the password's contents.
 */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<PasswordVerification> {
  // An over-length password can never have been hashed by this module, so it
  // cannot match. Return rather than throw, so it behaves like a wrong
  // password instead of a server error.
  if (isOverLength(password)) {
    return { valid: false, needsRehash: false };
  }

  if (LEGACY_HASH_PATTERN.test(storedHash)) {
    const stored = Buffer.from(storedHash, "hex");
    const candidate = legacyHash(password);
    // Both buffers are a fixed 32 bytes, so timingSafeEqual cannot throw here.
    const valid = crypto.timingSafeEqual(candidate, stored);
    return { valid, needsRehash: valid };
  }

  try {
    const valid = await argon2.verify(storedHash, password);
    return {
      valid,
      needsRehash: valid && argon2.needsRehash(storedHash, ARGON2_OPTIONS),
    };
  } catch {
    // A malformed or truncated hash is a failed login, not a crash.
    return { valid: false, needsRehash: false };
  }
}

/**
 * Spend roughly the cost of a real verification without one. Call this on the
 * path where no account matched, so an attacker cannot enumerate addresses by
 * timing the login response.
 */
export async function spendVerificationTime(password: string): Promise<void> {
  try {
    await argon2.verify(await decoyHash, password);
  } catch {
    // Nothing to report: the comparison exists only for its duration.
  }
}
