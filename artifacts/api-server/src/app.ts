import path from "node:path";
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
import { logger, scrubError } from "./lib/logger";
import { config } from "./lib/config";
import { csrfProtection, issueCsrfCookie, requireAllowedOrigin } from "./middleware/csrf";

const app: Express = express();

/**
 * The API sits behind the platform's router, so the socket address is always
 * the proxy. Without this the per-IP rate limiter sees one client for the
 * whole world and either locks everyone out at once or nobody at all.
 * One hop by default (`TRUST_PROXY` sets it) — never `true`, which would let a
 * caller forge the chain.
 */
app.set("trust proxy", config.trustProxyHops);

/**
 * The built web app, when this process also serves it (single-origin hosting
 * such as Hostinger). Registered ahead of the API's JSON-only headers, with the
 * same policy the page's <meta> CSP states plus what a meta tag cannot:
 * frame-ancestors. Hashed assets may be cached; index.html may not.
 */
const webDir = process.env["WEB_DIST_DIR"];
if (webDir) {
  const web = express.Router();
  web.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'"],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: "deny" },
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: false },
      referrerPolicy: { policy: "same-origin" },
    }),
  );
  web.use(
    "/assets",
    express.static(path.join(webDir, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }),
  );
  web.use(express.static(webDir, { index: false, maxAge: "1h" }));
  // Client-side routes: every other GET gets the app shell.
  web.get(/.*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(webDir, "index.html"));
  });
  app.use((req, res, next) => (req.path === "/api" || req.path.startsWith("/api/") ? next() : web(req, res, next)));
}

// Everything here is per-account or per-business data, and some of it is
// financial: no shared cache or browser back/forward cache should keep a copy.
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      // pino-http builds each request's logger with its own serializers, which
      // replace the parent's; without this the scrubbed error serializer is lost
      // for `req.log` and a database error logs its bound parameters again.
      err: scrubError,
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

// Refused before the body is read, so a forged cross-site submission costs
// nothing to reject.
app.use(requireAllowedOrigin);

// JSON only. A cross-site `<form>` can send `application/x-www-form-urlencoded`
// without any CORS preflight, so accepting that encoding made every route
// reachable by a plain HTML form; JSON forces a preflight the allowlist rejects.
app.use(express.json({ limit: "1mb" }));
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
