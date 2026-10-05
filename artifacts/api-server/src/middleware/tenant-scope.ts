/**
 * Pins each request to its tenant for the duration, so the row-level security
 * policies have something to match against.
 *
 * Three ordering details matter, and getting any of them wrong fails silently:
 *
 *   1. `next()` runs *inside* the async context, after `set_config`. Calling it
 *      outside would leave handlers running with no scope, where the proxied
 *      `db` falls back to the pool — a connection with no `app.business_id` —
 *      and a fail-closed policy returns nothing. The symptom would be an empty
 *      app, not an error.
 *
 *   2. The transaction is held until the handler tries to answer, because
 *      queries keep arriving until then. It is committed on the way out, or
 *      rolled back if the handler produced a 5xx, so a request that blew up
 *      half-way does not leave its partial writes behind.
 *
 *   3. **The answer is sent only after the transaction has settled.** The
 *      handler's first write is held back, the transaction commits, and only
 *      then does the response go out. This used to be the other way round — the
 *      commit waited for the response to be written — and that had two
 *      consequences:
 *
 *        - A client that acted on the response at once could arrive before the
 *          row was durable. It read as a `404` for something it had just been
 *          told it created (about one in 150 create-then-use sequences), and it
 *          was the cause of the registration link that named a row which did
 *          not exist yet. Anything that escapes the request — an email, a
 *          credential, a redirect — is safe to send only once what it refers to
 *          is committed.
 *
 *        - A transaction that failed *at* COMMIT — a deferred constraint, a
 *          serialisation failure — had already told the client it succeeded. The
 *          write was gone and nobody was told. Now the failure is still ahead of
 *          the response, so the client gets a `500`.
 *
 *      It also stops a slow client from holding a database connection: the
 *      connection is released at commit, not when the last byte has been read.
 */

import type { NextFunction, Request, Response } from "express";
import { rootDb, runInTenantScope, runInSystemScope } from "@workspace/db";

/** Thrown to make the transaction roll back; never surfaces to the client. */
class RollbackOnServerError extends Error {
  constructor() {
    super("Rolling back: the handler returned a server error");
  }
}

/**
 * How long a request whose client has gone may keep its transaction open while
 * the handler finishes. A handler normally answers into the void and is done in
 * milliseconds; this only exists so that one which never answers cannot pin a
 * pooled connection for ever.
 */
const ABANDONED_HANDLER_GRACE_MS = 30_000;

/**
 * Holds a handler's response back until the request's transaction has settled.
 *
 * Wraps `res.write` and `res.end` and queues whatever the handler sends. Nothing
 * reaches the client — not even the status line or headers — until `release()`.
 * This assumes responses are produced with `res.json` and friends, which end in
 * a single `res.end`; a handler that streamed a large body through `res.write`
 * would have it buffered here until the commit.
 */
class ResponseGate {
  private queued: Array<() => unknown> = [];
  private released = false;
  private started = false;
  private ended = false;
  statusAtStart = 200;
  private readonly sendEnd: (...args: unknown[]) => unknown;
  private signalStarted!: () => void;

  /** Settles the first time the handler tries to send anything. */
  readonly responseStarted: Promise<void> = new Promise((resolve) => {
    this.signalStarted = resolve;
  });

  /** Settles if the client left and the handler still has not answered. */
  readonly abandoned: Promise<void>;

  constructor(private readonly res: Response) {
    const write = res.write.bind(res) as (...args: unknown[]) => unknown;
    const end = res.end.bind(res) as (...args: unknown[]) => unknown;
    this.sendEnd = end;

    (res as any).write = (...args: unknown[]) => {
      if (this.released) return write(...args);
      // Nothing is accepted after the handler has ended the response.
      if (this.ended) return true;
      this.queued.push(() => write(...args));
      this.start();
      return true;
    };
    (res as any).end = (...args: unknown[]) => {
      if (this.released) return end(...args);
      // A second `end` — an error handler reacting to a throw after the handler
      // had already answered — must not append to or replace the first answer.
      if (this.ended) return res;
      this.ended = true;
      this.queued.push(() => end(...args));
      this.start();
      return res;
    };

    this.abandoned = new Promise((resolve) => {
      res.once("close", () => {
        if (this.started || res.writableEnded) return;
        setTimeout(resolve, ABANDONED_HANDLER_GRACE_MS).unref();
      });
    });
  }

  /** Whether the handler has tried to answer. */
  get hasResponse(): boolean {
    return this.started;
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    // The status the handler chose is the one the rollback decision was made on.
    // A later `res.status(...)` — an error handler reacting to a throw after the
    // handler had already answered — must not change what the client is told.
    this.statusAtStart = this.res.statusCode;
    this.signalStarted();
  }

  /** The transaction settled: send what the handler produced. */
  release(): void {
    this.released = true;
    if (this.started) this.res.statusCode = this.statusAtStart;
    for (const op of this.queued.splice(0)) op();
  }

  /** Whether the answer the handler produced is a server error. */
  get isServerError(): boolean {
    return this.started && this.statusAtStart >= 500;
  }

  /**
   * The transaction failed *after* the handler produced its answer, so that
   * answer is untrue. Replace it, and drop anything set alongside it — a session
   * cookie for a login that never committed, say.
   */
  fail(requestId: unknown): void {
    this.released = true;
    this.queued.length = 0;
    const { res } = this;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const body = JSON.stringify({ error: "Internal server error", requestId });
    res.removeHeader("Set-Cookie");
    res.removeHeader("ETag");
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body));
    this.sendEnd(body);
  }
}

/**
 * Run the rest of the request inside a scope and send its response only once
 * the scope's transaction has committed (or rolled back).
 */
function runScoped(
  req: Request,
  res: Response,
  next: NextFunction,
  run: (fn: () => Promise<void>) => Promise<void>,
): void {
  const gate = new ResponseGate(res);
  let handlerStarted = false;

  void run(async () => {
    handlerStarted = true;
    next();
    // The transaction stays open for as long as the handler is working, and
    // ends when it first tries to answer — or, if the client left and the
    // handler never does, after the grace period.
    await Promise.race([gate.responseStarted, gate.abandoned]);
    // Decided on the status at the moment the handler answered, not whatever
    // `res.statusCode` has since become.
    if (!gate.hasResponse || gate.isServerError) throw new RollbackOnServerError();
  }).then(
    // Committed. Now, and not before, the client hears about it.
    () => gate.release(),
    (err: unknown) => {
      // A deliberate rollback; the handler's own error response goes out as is.
      if (err instanceof RollbackOnServerError) return gate.release();

      // The transaction never started — the database was already unreachable —
      // so no handler ran. Nothing is held back; let the error handler answer.
      if (!handlerStarted) {
        gate.release();
        return next(err);
      }

      // The handler ran and answered, and then the transaction could not
      // commit. Its answer describes writes that do not exist.
      (req as Request & { log?: { error: Function } }).log?.error(
        { err },
        "Transaction failed after the handler had answered; replacing the response",
      );
      gate.fail((req as Request & { id?: unknown }).id);
    },
  );
}

/** Run the rest of the request pinned to one tenant. */
export function openTenantScope(
  req: Request,
  res: Response,
  next: NextFunction,
  businessId: number,
): void {
  runScoped(req, res, next, (fn) => runInTenantScope(rootDb, businessId, fn));
}

/**
 * Run the rest of the request with the policies suspended.
 *
 * For the handful of operations that legitimately span tenants: the platform
 * admin's dashboards, and registration, which creates a business before any
 * tenant exists to scope to. Everything reached this way is trusting its own
 * authorization checks with no database-level net underneath, which is why it
 * is applied per-router rather than being available by default.
 */
export function systemScope(req: Request, res: Response, next: NextFunction): void {
  runScoped(req, res, next, (fn) => runInSystemScope(rootDb, fn));
}
