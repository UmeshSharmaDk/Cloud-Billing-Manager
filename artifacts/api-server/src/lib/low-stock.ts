/**
 * What counts as low stock.
 *
 * It was three different things. `/api/products?lowStock=true` used
 * `stock <= threshold` with no COALESCE, so every product whose threshold was
 * never set — which is every product created from a purchase bill — dropped out
 * silently, because `0 <= NULL` is NULL rather than true. The dashboard used
 * `stock < COALESCE(threshold, 5)` and the stock report used `?? 5` in
 * JavaScript. So the badge said twelve items needed reordering, the list the
 * user opened to act on them showed three, and nothing explained the gap.
 *
 * One definition, in both the forms the callers need: at or below the reorder
 * point, with an unset point meaning five. `<=` because the threshold *is* the
 * reorder point — reaching it is the signal, not passing it.
 */

import { sql } from "drizzle-orm";

/** Used when a product has no threshold of its own. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

interface ProductColumns {
  stockQuantity: unknown;
  lowStockThreshold: unknown;
}

/** SQL form, for filtering and counting in the database. */
export function lowStockSql(products: ProductColumns) {
  return sql`${products.stockQuantity} <= COALESCE(${products.lowStockThreshold}, ${DEFAULT_LOW_STOCK_THRESHOLD})`;
}

/** The same rule for rows already in memory. */
export function isLowStock(product: {
  stockQuantity: number | string;
  lowStockThreshold?: number | string | null;
}): boolean {
  const threshold =
    product.lowStockThreshold === null || product.lowStockThreshold === undefined
      ? DEFAULT_LOW_STOCK_THRESHOLD
      : Number(product.lowStockThreshold);
  return Number(product.stockQuantity) <= threshold;
}
