/**
 * Password policy.
 *
 * Registration previously checked only that a password was present — the
 * signup form's "Min 8 characters" placeholder was decoration, with no
 * `minLength` on the input and no check on the server. A one-character
 * password was accepted, and the weakest password on the platform sets the
 * platform's real security level.
 *
 * Follows NIST SP 800-63B: favour length over composition rules, screen
 * against known-breached passwords, and do not force rotation.
 */

import crypto from "node:crypto";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * The passwords that turn up first in every credential-stuffing list, plus the
 * shapes this product invites (`gst...`, `invoice...`). Screening is
 * case-insensitive.
 *
 * This is the floor, not the ceiling — `isBreachedPassword` below checks a
 * corpus of hundreds of millions. It exists so the check still bites when that
 * lookup is unavailable.
 */
const COMMON_PASSWORDS = new Set(
  [
    "123456", "123456789", "12345678", "1234567890", "12345", "1234567",
    "password", "password1", "password123", "passw0rd", "p@ssw0rd", "p@ssword",
    "qwerty", "qwerty123", "qwertyuiop", "1q2w3e4r", "1qaz2wsx", "zaq12wsx",
    "abc123", "abcd1234", "a1b2c3d4", "111111", "000000", "121212", "123123",
    "iloveyou", "admin", "admin123", "administrator", "root", "toor",
    "welcome", "welcome1", "welcome123", "letmein", "letmein123",
    "monkey", "dragon", "sunshine", "princess", "football", "baseball",
    "master", "shadow", "superman", "trustno1", "whatever", "starwars",
    "login", "guest", "test", "test123", "testing", "changeme", "secret",
    "default", "temp", "temporary", "pass", "pass123", "mypassword",
    "gst", "gst123", "gstpro", "gstplatform", "gstbilling", "billing",
    "invoice", "invoice123", "accounts", "accounting", "business",
    "india", "india123", "bharat", "namaste", "ganesh", "krishna", "shivam",
    "demo", "demo123", "sample", "example", "company", "office",
    "asdfgh", "asdf1234", "zxcvbnm", "qazwsx", "159753", "147258369",
    "michael", "jennifer", "thomas", "jordan", "hunter", "harley",
    "computer", "internet", "samsung", "google", "facebook", "linkedin",
  ].map((p) => p.toLowerCase()),
);

export interface PolicyFailure {
  message: string;
}

/**
 * Structural checks, done locally and synchronously. Returns null when the
 * password passes.
 */
export function checkPasswordPolicy(password: string): PolicyFailure | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters. A short phrase of a few words is easier to remember and harder to guess than a short jumble.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase().trim())) {
    return { message: "This password is one of the most commonly used. Choose something else." };
  }
  // A single repeated character clears a length check without adding entropy.
  if (new Set(password).size <= 2) {
    return { message: "This password repeats too few characters. Choose something else." };
  }
  return null;
}

/** Disable the network lookup where outbound HTTPS is unavailable or unwanted. */
const breachCheckEnabled = process.env["DISABLE_BREACH_CHECK"] !== "true";

const BREACH_LOOKUP_TIMEOUT_MS = 2500;

/**
 * Check the password against Have I Been Pwned's breach corpus.
 *
 * Uses the k-anonymity range API: only the first five hex characters of the
 * SHA-1 hash leave this process, and the service cannot tell which of the
 * several hundred returned suffixes — if any — was the one asked about. The
 * password itself is never transmitted.
 *
 * Fails open. A password-strength service being unreachable must not take
 * registration down with it; `checkPasswordPolicy` still applies either way.
 */
export async function isBreachedPassword(password: string): Promise<boolean> {
  if (!breachCheckEnabled) return false;

  const sha1 = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(BREACH_LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return false;

    const body = await res.text();
    for (const line of body.split("\n")) {
      const [candidate, countRaw] = line.trim().split(":");
      if (candidate !== suffix) continue;
      // Padding rows are returned with a count of zero and mean "not present".
      return Number(countRaw ?? 0) > 0;
    }
    return false;
  } catch {
    return false;
  }
}

/** Full check: structure first (free), then the breach corpus (a network call). */
export async function validatePassword(password: string): Promise<PolicyFailure | null> {
  const structural = checkPasswordPolicy(password);
  if (structural) return structural;

  if (await isBreachedPassword(password)) {
    return {
      message:
        "This password has appeared in a public data breach and is on every attacker's list. Choose a different one.",
    };
  }
  return null;
}
