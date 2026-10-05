import pino from "pino";

/**
 * Development mode is opt-in. The previous check asked whether NODE_ENV was
 * exactly "production", so an unset variable — the case on this project's
 * deployment target — quietly selected the developer transport in production.
 * Inverting it makes the unset case behave as production.
 */
const isDevelopment = process.env.NODE_ENV === "development";

/**
 * Fields a database error carries that hold the data being written. Drizzle
 * puts the bound parameters in the error's message and stack
 * ("Failed query: … params: a@b.com,$argon2id$…") and in `query`/`params`, and
 * Postgres puts the offending row in `detail` ("Key (email)=(a@b.com) already
 * exists"). Logged as-is, a failed insert wrote emails, password hashes and
 * invoice contents into the log stream.
 */
const SENSITIVE_ERROR_FIELDS = ["query", "params", "detail", "where", "parameters"];

function scrubText(text: unknown): unknown {
  return typeof text === "string" ? text.replace(/\nparams:[\s\S]*$/m, "\nparams: [redacted]") : text;
}

export function scrubError(err: any, depth = 0): any {
  const serialised: any = pino.stdSerializers.err(err);
  if (!serialised || typeof serialised !== "object") return serialised;
  serialised.message = scrubText(serialised.message);
  serialised.stack = scrubText(serialised.stack);
  for (const field of SENSITIVE_ERROR_FIELDS) delete serialised[field];
  if (err?.cause && depth < 3) serialised.cause = scrubError(err.cause, depth + 1);
  return serialised;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  serializers: { err: scrubError },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isDevelopment
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});
