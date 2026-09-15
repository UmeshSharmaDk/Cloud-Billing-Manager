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

/**
 * Origins allowed to call this API from a browser.
 *
 * Required, with no default. The previous `cors()` call sent
 * `Access-Control-Allow-Origin: *`, which also makes cookie-based auth
 * impossible — browsers refuse to combine credentials with a wildcard.
 * Comma-separated, e.g. "https://app.example.com,https://admin.example.com".
 */
function requiredOrigins(name: string): readonly string[] {
  const raw = process.env[name];
  const origins = (raw ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error(
      `${name} environment variable is required but was not provided. ` +
        `Set it to a comma-separated list of origins allowed to call this API, ` +
        `e.g. "https://app.example.com". Use "http://localhost:25512" for local development.`,
    );
  }

  const invalid = origins.filter((o) => !/^https?:\/\/[^/]+$/.test(o));
  if (invalid.length > 0) {
    throw new Error(
      `${name} contains entries that are not scheme://host origins: ${invalid.join(", ")}. ` +
        `Do not include a path or a trailing slash, and never use "*".`,
    );
  }

  return Object.freeze(origins);
}

/**
 * Development mode is opt-in. Anything other than an explicit
 * NODE_ENV=development is treated as production, so an unset variable fails
 * safe rather than enabling developer conveniences on a live deployment.
 */
const isDevelopment = process.env.NODE_ENV === "development";

/**
 * `SameSite` for the session cookie.
 *
 * "lax" is right when the app and the API share a site. When they are served
 * from different origins — which this project's port mapping allows — the
 * browser will only send the cookie with "none", and "none" requires
 * `Secure`. Hence the pairing below rather than two independent knobs.
 */
function cookieSameSite(): "lax" | "strict" | "none" {
  const raw = (process.env["COOKIE_SAME_SITE"] ?? "lax").toLowerCase();
  if (raw === "lax" || raw === "strict" || raw === "none") return raw;
  throw new Error(
    `COOKIE_SAME_SITE must be one of "lax", "strict" or "none" (got "${raw}").`,
  );
}

const sameSite = cookieSameSite();

if (sameSite === "none" && isDevelopment) {
  // Not fatal, but it will not work: browsers drop SameSite=None without Secure.
  // eslint-disable-next-line no-console
  console.warn(
    'COOKIE_SAME_SITE="none" requires HTTPS. Cookies will be rejected over plain HTTP.',
  );
}

/**
 * Where verification mail is sent from, and how.
 *
 * Registration cannot be non-enumerable without email: the HTTP response has to
 * be identical whether or not the address is taken, so the difference has to
 * travel out of band. That makes a mail transport a hard requirement rather
 * than a nice-to-have, and it is validated here like the signing secret —
 * production refuses to boot without one.
 *
 * Development falls back to writing the message to the log, which is what makes
 * local work and the test suite possible without a mail server. That fallback
 * is explicitly gated on NODE_ENV=development, and `isDevelopment` above treats
 * anything else as production, so it cannot reach a live deployment by omission.
 */
function mailTransport():
  | { kind: "smtp"; url: string; from: string }
  | { kind: "file"; path: string; from: string }
  | { kind: "log"; from: string } {
  const url = process.env["SMTP_URL"]?.trim();
  const outbox = process.env["MAIL_OUTBOX_PATH"]?.trim();
  const from = process.env["MAIL_FROM"]?.trim();

  if (url && outbox) {
    throw new Error(
      "Set either SMTP_URL or MAIL_OUTBOX_PATH, not both — which one wins would " +
        "otherwise decide whether registration mail is delivered or written to disk.",
    );
  }

  // Writes each message to a file instead of sending it. This exists so the
  // integration suite can read a verification link without a mail server, and
  // so it can do that while the server otherwise runs exactly as production
  // does. It is chosen only by setting a path explicitly — never by omission —
  // so no deployment gets it by forgetting to configure something.
  if (outbox) {
    return { kind: "file", path: outbox, from: from ?? "GST Platform <no-reply@localhost>" };
  }

  if (url) {
    if (!from) {
      throw new Error(
        "MAIL_FROM is required when SMTP_URL is set. " +
          'Set it to the address mail is sent from, e.g. "GST Platform <no-reply@example.com>".',
      );
    }
    return { kind: "smtp", url, from };
  }

  if (!isDevelopment) {
    throw new Error(
      "SMTP_URL environment variable is required but was not provided. " +
        "Registration confirms nothing over HTTP — whether an address is already " +
        "registered is settled by email — so the server cannot accept signups " +
        'without a mail transport. Set SMTP_URL (e.g. "smtps://user:pass@smtp.example.com:465") ' +
        "and MAIL_FROM. See F-14 in SECURITY-REVIEW.md.",
    );
  }

  return { kind: "log", from: from ?? "GST Platform <no-reply@localhost>" };
}

/**
 * Base URL the verification link points at — the app the person is using, not
 * this API. Defaults to the first allowed origin, which is correct for the
 * single-origin deployments this project has; set it explicitly otherwise.
 */
function appBaseUrl(origins: readonly string[]): string {
  const raw = process.env["APP_BASE_URL"]?.trim();
  const value = raw && raw !== "" ? raw : origins[0]!;
  if (!/^https?:\/\/[^/]+$/.test(value.replace(/\/$/, ""))) {
    throw new Error(
      `APP_BASE_URL must be a scheme://host URL with no path (got "${value}").`,
    );
  }
  return value.replace(/\/$/, "");
}

export const config = {
  /** Signing key for session tokens. No default — see the note above. */
  jwtSecret: requiredSecret("SESSION_SECRET"),

  isDevelopment,

  /** Browser origins permitted by CORS. */
  allowedOrigins: requiredOrigins("ALLOWED_ORIGINS"),

  cookie: {
    sameSite,
    /** Never send the session cookie over plain HTTP outside local development. */
    secure: !isDevelopment || sameSite === "none",
  },

  /** Mail transport for registration verification. Required in production. */
  mail: mailTransport(),

  /** Where the verification link sends people. */
  appBaseUrl: appBaseUrl(requiredOrigins("ALLOWED_ORIGINS")),
} as const;
