/**
 * Request-scoped tenant context for row-level security.
 *
 * The policies in `rls.ts` read `app.business_id` from the Postgres session.
 * Setting it has to satisfy three things at once:
 *
 *   - it must be set on the *same* connection that runs the query, which with
 *     a pool means pinning one connection for the duration;
 *   - it must not survive into the next request that borrows that connection,
 *     which `SET LOCAL` guarantees by scoping the value to a transaction;
 *   - it must not require every one of the hundred-odd existing `db.` calls to
 *     be rewritten to thread a transaction handle through.
 *
 * The first two are why this opens a transaction. The third is why `db` is a
 * proxy: inside a scope it forwards to that transaction, and outside one it is
 * the ordinary pooled database. Call sites are unchanged and cannot forget.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";

interface Scope {
  tx: any;
  businessId: number | null;
  /**
   * Set when the scope's transaction is over. Async work that outlives the
   * request — a handler still running after the client left, a timer — keeps
   * the scope in its async context, and its queries would otherwise be sent
   * down a connection that has already gone back to the pool and been lent to
   * someone else's request.
   */
  closed: boolean;
}

const storage = new AsyncLocalStorage<Scope>();

/** The tenant the current async context is pinned to, if any. */
export function currentBusinessId(): number | null {
  return storage.getStore()?.businessId ?? null;
}

export function inTenantScope(): boolean {
  return storage.getStore() !== undefined;
}

/**
 * Wrap `db` so queries made inside a scope run on that scope's transaction.
 *
 * Without this, a query issued during a request would take its own connection
 * from the pool — one where `app.business_id` was never set — and the policy,
 * failing closed, would return nothing.
 */
export function createScopedDb<T extends object>(base: T): T {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const store = storage.getStore();
      if (store?.closed) {
        throw new Error("Database used after its request scope ended");
      }
      const actual: any = store?.tx ?? target;
      const value = Reflect.get(actual, prop, actual);
      return typeof value === "function" ? value.bind(actual) : value;
    },
  }) as T;
}

type Runner<T> = () => Promise<T>;

/**
 * Run `fn` with the tenant pinned, inside one transaction.
 *
 * `set_config(..., true)` is `SET LOCAL`: the value is discarded when the
 * transaction ends, so a pooled connection cannot carry one request's tenant
 * into the next.
 */
export async function runInTenantScope<T>(
  base: any,
  businessId: number,
  fn: Runner<T>,
): Promise<T> {
  return base.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT set_config('app.business_id', ${String(businessId)}, true)`,
    );
    const scope: Scope = { tx, businessId, closed: false };
    try {
      return await storage.run(scope, fn);
    } finally {
      scope.closed = true;
    }
  });
}

/**
 * Run `fn` with policies suspended, for the few operations that legitimately
 * span tenants: the platform admin's dashboards, and the authentication path,
 * which has to find a user before any tenant is known.
 *
 * Deliberately awkward to reach for. Anything called here is trusting its own
 * access checks entirely, with no database-level net underneath.
 */
export async function runInSystemScope<T>(base: any, fn: Runner<T>): Promise<T> {
  return base.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`);
    const scope: Scope = { tx, businessId: null, closed: false };
    try {
      return await storage.run(scope, fn);
    } finally {
      scope.closed = true;
    }
  });
}
