/**
 * Resolving a foreign key that arrived in a request body.
 *
 * A body field naming another row — `invoiceId`, `customerId`, `vendorId` — is
 * attacker-controlled. Zod checks that it is a positive integer; it cannot
 * check that the row belongs to the caller. Storing it unchecked writes a
 * reference across a tenant boundary: nothing has leaked at the moment of the
 * write, but the row now points at another business's record, and any join or
 * detail view that later resolves it turns that into a live cross-tenant read.
 *
 * Row-level security does not catch this. The insert targets the caller's own
 * tenant and satisfies the policy; it is the *value* of the column that points
 * elsewhere, and no policy on this table looks at it.
 *
 * F-05 was four unscoped lookups out of roughly forty. This exists so the same
 * check is not hand-written a fifth, sixth and seventh time.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";

/** Any tenant-scoped table: one with an `id` and a `businessId`. */
interface TenantTable {
  id: any;
  businessId: any;
}

export type RefResult = { ok: true; id: number | null } | { ok: false; error: string };

/**
 * Resolve an optional reference against the caller's tenant.
 *
 * An absent value is fine and resolves to `null`. A present one must name a row
 * in this tenant, or the request is refused — the same "fail loudly rather than
 * silently falling back" the unscoped lookups were fixed to follow, because a
 * silent `null` here would quietly drop a link the caller asked for.
 */
export async function resolveTenantRef(
  table: TenantTable,
  value: unknown,
  businessId: number,
  label: string,
): Promise<RefResult> {
  if (value === undefined || value === null || value === "") return { ok: true, id: null };

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return { ok: false, error: `Invalid ${label}` };
  }

  const [row] = await db
    .select({ id: table.id })
    .from(table as any)
    .where(and(eq(table.id, numeric), eq(table.businessId, businessId)))
    .limit(1);

  return row ? { ok: true, id: row.id } : { ok: false, error: `Unknown ${label}` };
}

/**
 * Resolve several references at once, stopping at the first that fails.
 *
 * Returns the resolved ids keyed as they were passed in, so a caller can spread
 * them straight into an insert.
 */
export async function resolveTenantRefs(
  businessId: number,
  refs: Record<string, { table: TenantTable; value: unknown; label: string }>,
): Promise<{ ok: true; ids: Record<string, number | null> } | { ok: false; error: string }> {
  const ids: Record<string, number | null> = {};
  for (const [key, { table, value, label }] of Object.entries(refs)) {
    const result = await resolveTenantRef(table, value, businessId, label);
    if (!result.ok) return result;
    ids[key] = result.id;
  }
  return { ok: true, ids };
}
