import pino from "pino";

/**
 * Development mode is opt-in. The previous check asked whether NODE_ENV was
 * exactly "production", so an unset variable — the case on this project's
 * deployment target — quietly selected the developer transport in production.
 * Inverting it makes the unset case behave as production.
 */
const isDevelopment = process.env.NODE_ENV === "development";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
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
