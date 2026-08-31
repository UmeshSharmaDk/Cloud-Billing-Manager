import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
