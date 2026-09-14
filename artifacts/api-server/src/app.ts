import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { config } from "./lib/config";
import { csrfProtection, issueCsrfCookie } from "./middleware/csrf";

const app: Express = express();

/**
 * The API sits behind the platform's router, so the socket address is always
 * the proxy. Without this the per-IP rate limiter sees one client for the
 * whole world and either locks everyone out at once or nobody at all.
 * One hop — never `true`, which would let a caller forge the chain.
 */
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
/**
 * Security headers. The API serves JSON, not markup, so the CSP is about as
 * tight as one gets: nothing is allowed to load, and nothing may frame it.
 * The frontend is a separate origin with its own policy.
 */
app.use(
  helmet({
    contentSecurityPolicy: {
      // `useDefaults` would merge helmet's browser-app policy in, which allows
      // scripts, styles and fonts. This API returns JSON and nothing else.
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    frameguard: { action: "deny" },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
    // Responses are JSON downloads at worst; the default would add a
    // cross-origin-resource-policy that blocks the frontend's own fetches.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "no-referrer" },
  }),
);

/**
 * An explicit origin allowlist, replacing `cors()` — which sent
 * `Access-Control-Allow-Origin: *` on every route. `credentials: true` is what
 * lets the session cookie travel, and browsers refuse to combine it with a
 * wildcard, so the allowlist is a precondition for cookie auth, not just
 * good hygiene.
 *
 * The origin is matched against the configured list rather than reflected
 * back from the request — reflecting is a wildcard with extra steps.
 */
app.use(
  cors({
    origin: config.allowedOrigins as string[],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    maxAge: 86_400,
  }),
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

// Order matters: a client must be able to obtain a token before it is checked.
app.use(issueCsrfCookie);
app.use(csrfProtection);

app.use("/api", router);

/**
 * Terminal error handler. Registered last, and takes four arguments because
 * that is how Express identifies error middleware.
 *
 * Without this, unhandled rejections fall through to Express's built-in
 * fallback, which serialises `err.stack` into the response body whenever
 * NODE_ENV is not exactly "production" — handing callers absolute file paths,
 * the bundle layout, dependency versions and fragments of SQL. Everything
 * useful is logged server-side instead; the client gets a request id it can
 * quote and nothing else.
 */
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  req.log.error({ err }, "Unhandled error");

  // The response has already started, so the only honest thing left is to cut
  // it off rather than append an error body to a partial payload.
  if (res.headersSent) {
    res.destroy();
    return;
  }

  // Body-parser and friends attach a status to client errors (malformed JSON,
  // payload too large). Trust it only when it is a 4xx; anything else is ours.
  const raw = (err as { status?: unknown; statusCode?: unknown } | null)?.status
    ?? (err as { statusCode?: unknown } | null)?.statusCode;
  const isClientError = typeof raw === "number" && raw >= 400 && raw < 500;

  res.status(isClientError ? raw : 500).json({
    error: isClientError ? "Bad request" : "Internal server error",
    requestId: req.id,
  });
});

export default app;
