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

import { dec, toColumn } from "./money";

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
 * Match a document line to a catalog product: by id when the line carries one,
 * otherwise by name. Kept in one place because invoices and purchases matched
 * on subtly different rules — one trimmed the name and the other did not.
 */
export function findLineProduct<T extends CatalogProduct>(
  catalog: T[],
  line: StockLine,
): T | null {
  if (line.productId) {
    const byId = catalog.find((p) => p.id === Number(line.productId));
    if (byId) return byId;
  }
  const name = String(line.description ?? "").trim().toLowerCase();
  if (!name) return null;
  return catalog.find((p) => p.name.trim().toLowerCase() === name) ?? null;
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
  if (!lines || lines.length === 0) return;

  const catalog: CatalogProduct[] = await tx
    .select()
    .from(productsTable)
    .where(eq(productsTable.businessId, businessId));

  for (const [productId, delta] of netByProduct(catalog, lines, direction)) {
    if (delta.isZero()) continue;
    const product = catalog.find((p) => p.id === productId);
    if (!product) continue;
    await tx
      .update(productsTable)
      .set({ stockQuantity: dec(product.stockQuantity).plus(delta).toFixed(3) })
      .where(eq(productsTable.id, productId));
  }
}

/** Re-export so callers writing a stock column use the same rounding. */
export { toColumn };
