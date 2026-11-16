/**
 * Time-based one-time passwords (RFC 6238) and recovery codes for
 * administrator accounts.
 *
 * TOTP is HMAC-SHA1 over a 30-second counter, truncated to six digits. That is
 * a few lines on top of `node:crypto`, so there is no library here: the
 * algorithm is fixed by every authenticator app in existence and will not
 * change under us. `test/totp.test.ts` checks it against the RFC's vectors.
 *
 * The shared secret is stored as-is in `users.mfa_secret`. Encrypting it with
 * a key the same server holds protects only against someone who can read the
 * table but not the environment, and costs a lockout for every administrator
 * the day that key is lost or rotated. The second factor exists to stop a
 * stolen or guessed *password*; someone who can read the users table already
 * has every invoice the platform holds. It never leaves the server except
 * once, at enrolment, and `mapUser` does not expose it.
 */

import crypto from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;
/** Steps either side of now that still count, for clock drift. */
const DRIFT_STEPS = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 as authenticator apps expect it. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/** The code for one 30-second step. `digits` is only varied by the RFC test. */
export function totpAt(secret: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const currentStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / STEP_SECONDS);

/**
 * The step a code belongs to, or null if it matches none in the drift window.
 *
 * Returning the step rather than a boolean is what lets the caller refuse a
 * replay: a code is spent once its step has been recorded as the last used.
 * Every candidate is compared in constant time, and all of them are compared,
 * so how long this takes says nothing about which one matched.
 */
export function matchTotp(secret: string, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentStep(nowMs);
  let matched: number | null = null;
  for (let step = now - DRIFT_STEPS; step <= now + DRIFT_STEPS; step++) {
    const expected = Buffer.from(totpAt(secret, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(code)) && matched === null) matched = step;
  }
  return matched;
}

export function otpauthUri(secret: string, accountEmail: string): string {
  const issuer = "Billing Pilot";
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;

/** No 0/O or 1/I, so a code read off paper is typed back correctly. */
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * `XXXXX-XXXXX`: 50 bits each, far beyond guessing under the lockout. Stored
 * as SHA-256 hashes. A slow hash adds nothing to a random 50-bit value, and
 * a fast one lets a code be found with one indexed array lookup.
 */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = crypto.randomBytes(10);
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b & 31]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

/** Case, spaces and the dash do not matter when a code is typed back. */
export function hashRecoveryCode(code: string): string {
  const normalised = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return crypto.createHash("sha256").update(normalised).digest("hex");
}

export const looksLikeTotp = (code: string) => /^\d{6}$/.test(code.trim());
