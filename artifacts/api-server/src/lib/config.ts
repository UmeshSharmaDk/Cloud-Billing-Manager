/**
 * Startup configuration.
 *
 * Every required environment variable is read and validated here, once, before
 * the server accepts traffic. A missing value fails the boot rather than
 * falling back to a default: a fallback secret committed to the repository is
 * a published secret, and every deployment that forgets to set the real one
 * silently shares it.
 *
 * This mirrors how `lib/db` already guards `DATABASE_URL`.
 */

/** Minimum length for a signing secret. `openssl rand -base64 48` clears it. */
const MIN_SECRET_LENGTH = 32;

function requiredSecret(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(
      `${name} environment variable is required but was not provided. ` +
        `Generate one with: openssl rand -base64 48`,
    );
  }

  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} must be at least ${MIN_SECRET_LENGTH} characters (got ${value.length}). ` +
        `Generate one with: openssl rand -base64 48`,
    );
  }

  return value;
}

export const config = {
  /** Signing key for session tokens. No default — see the note above. */
  jwtSecret: requiredSecret("SESSION_SECRET"),

  /**
   * Development mode is opt-in. Anything other than an explicit
   * NODE_ENV=development is treated as production, so an unset variable
   * fails safe (plain JSON logs) rather than enabling developer conveniences
   * on a live deployment.
   */
  isDevelopment: process.env.NODE_ENV === "development",
} as const;
