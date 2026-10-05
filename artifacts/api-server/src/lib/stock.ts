/**
 * Moving stock, reversibly.
 *
 * Stock was only ever moved one way. Raising an invoice deducted it, recording
 * a bill added it, and nothing else touched it — so editing a document left the
 * original movement in place and deleting one left it behind entirely. Create
 * an invoice for 10 and delete it and the 10 units were simply gone; edit a
 * purchase and its quantities were added a second time. Both drift permanently,
 * and the low-stock reports drift with them.
 *
 * The fix is to treat a document's effect on stock as something that can be
 * undone: every edit reverses what the document previously did and applies what
 * it does now, and every delete reverses it. That only works if a movement and
 * its reversal are exactly equal and opposite, which is why nothing here clamps.
 *
 * **Stock may go negative, and that is deliberate.** The old sale path pinned it
 * at zero, which quietly discarded the fact that more was sold than was held:
 * selling 10 from a stock of 5 left 0, so reversing the sale would have invented
 * 5 units. Letting it read -5 keeps the arithmetic exact and says something true
 * — that five units are owed. A floor is a display decision, not a storage one.
 */

import { and, inArray, sql } from "drizzle-orm";
import { dec, toColumn } from "./money";
import { isCreditNoteType, isProformaType } from "./tax-documents";

export interface StockLine {
  productId?: number | null;
  description?: string | null;
  quantity?: unknown;
}

interface CatalogProduct {
  id: number;
  name: string;
  stockQuantity: string;
}

/** Stock leaves on a sale and arrives on a purchase. */
export const STOCK_OUT = -1;
export const STOCK_IN = 1;

/**
 * Which way an invoice moves stock, by its type.
 *
 * Every invoice used to deduct stock. A proforma is a quotation, not a supply —
 * reports already ignore it — so raising one took goods out of stock for a sale
 * that never happened. A credit note is goods coming back, so it took them out a
 * second time instead of returning them.
 */
export function stockDirectionFor(type: string | null | undefined): number {
  if (isProformaType(type)) return 0;
  if (isCreditNoteType(type)) return STOCK_IN;
  return STOCK_OUT;
}

/**
 * Match a document line to a catalog product: by id when the line carries one,
 * otherwise by name. Kept in one place because invoices and purchases matched
 * on subtly different rules — one trimmed the name and the other did not.
 */
export function findLineProduct<T extends CatalogProduct>(
  catalog: T[],
  line: StockLine,
): T | null {
  // A line that already says which product it is — or says it is none — is not
  // matched again by name. Re-matching against *today's* catalog meant a name that
  // belonged to nothing when the invoice was raised could belong to a product
  // created later, so cancelling credited stock that was never deducted; and
  // renaming a product made the reversal miss it. Only lines written before the
  // id was stored (`undefined`) still fall back to the name.
  if (line.productId === null) return null;
  if (line.productId !== undefined) {
    return catalog.find((p) => p.id === Number(line.productId)) ?? null;
  }
  const name = String(line.description ?? "").trim().toLowerCase();
  if (!name) return null;
  return catalog.find((p) => p.name.trim().toLowerCase() === name) ?? null;
}

/**
 * Record, on each line, which catalog product it is — or `null` if it is none.
 * Stored with the document, so a later edit, cancel or rename reverses exactly
 * what this one moved. An id the caller supplied that is not in this business's
 * catalog is replaced rather than kept: it would otherwise sit in the document
 * naming another tenant's product.
 */
export async function resolveLineProducts<L extends StockLine>(
  tx: any,
  productsTable: any,
  eq: (a: any, b: any) => any,
  businessId: number,
  lines: L[],
): Promise<Array<L & { productId: number | null }>> {
  const catalog: CatalogProduct[] = await tx
    .select()
    .from(productsTable)
    .where(eq(productsTable.businessId, businessId));
  return lines.map((line) => {
    const byId = line.productId
      ? catalog.find((p) => p.id === Number(line.productId))
      : undefined;
    const product = byId ?? findLineProduct(catalog, { ...line, productId: undefined });
    return { ...line, productId: product?.id ?? null };
  });
}

/**
 * Net quantity per product for a set of lines, so a document naming the same
 * product on two lines moves it once.
 */
function netByProduct(catalog: CatalogProduct[], lines: StockLine[], direction: number) {
  const deltas = new Map<number, ReturnType<typeof dec>>();
  for (const line of lines) {
    const qty = dec(line.quantity ?? 0);
    if (qty.isZero()) continue;
    const product = findLineProduct(catalog, line);
    if (!product) continue;
    const previous = deltas.get(product.id) ?? dec(0);
    deltas.set(product.id, previous.plus(qty.times(direction)));
  }
  return deltas;
}

/**
 * Apply one or more movements as a single pass.
 *
 * An edit reverses what a document did and applies what it does now. Done as
 * two separate passes, each sorted on its own, the combined order in which rows
 * were locked was not sorted: a document whose old and new products differ took
 * locks out of order against another document touching the same products, and
 * Postgres aborted one of them as a deadlock. Netting every movement into one
 * map, locking the affected rows in ascending id order up front, and writing in
 * that same order means two documents can only ever wait for each other, never
 * in a cycle. It also writes each product once.
 */
export async function applyStockChanges(
  tx: any,
  productsTable: any,
  eq: (a: any, b: any) => any,
  businessId: number,
  changes: Array<{ lines: StockLine[]; direction: number }>,
): Promise<void> {
  const active = changes.filter((c) => c.lines && c.lines.length > 0 && c.direction !== 0);
  if (active.length === 0) return;

  const catalog: CatalogProduct[] = await tx
    .select()
    .from(productsTable)
    .where(eq(productsTable.businessId, businessId));

  const total = new Map<number, ReturnType<typeof dec>>();
  for (const { lines, direction } of active) {
    for (const [id, delta] of netByProduct(catalog, lines, direction)) {
      total.set(id, (total.get(id) ?? dec(0)).plus(delta));
    }
  }
  const deltas = [...total].filter(([, d]) => !d.isZero()).sort(([a], [b]) => a - b);
  if (deltas.length === 0) return;

  await tx
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.businessId, businessId), inArray(productsTable.id, deltas.map(([id]) => id))))
    .orderBy(productsTable.id)
    .for("update");

  for (const [productId, delta] of deltas) {
    // The addition happens in the database. This used to write back
    // `catalogValue + delta`, where the catalog value had been read moments
    // earlier without a lock: two concurrent invoices for one product both
    // started from the same quantity and the last write won, so goods were sold
    // twice and stock fell once.
    await tx
      .update(productsTable)
      .set({ stockQuantity: sql`${productsTable.stockQuantity} + ${delta.toFixed(3)}::numeric` })
      .where(and(eq(productsTable.id, productId), eq(productsTable.businessId, businessId)));
  }
}

/**
 * Apply a document's effect on stock.
 *
 * Pass `STOCK_OUT` for a sale and `STOCK_IN` for a purchase; pass the opposite
 * to undo one. Runs on the caller's transaction so the movement commits or rolls
 * back with the document that caused it.
 */
export async function applyStockMovement(
  tx: any,
  productsTable: any,
  eq: (a: any, b: any) => any,
  businessId: number,
  lines: StockLine[],
  direction: number,
): Promise<void> {
  await applyStockChanges(tx, productsTable, eq, businessId, [{ lines, direction }]);
}

/** Re-export so callers writing a stock column use the same rounding. */
export { toColumn };
