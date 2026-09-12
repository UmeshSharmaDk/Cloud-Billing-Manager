/**
 * Exact decimal arithmetic for money and tax.
 *
 * Amounts were computed with JavaScript numbers, which are binary floating
 * point and cannot represent decimal currency exactly. That alone produces
 * drift, but the larger error was structural: each line was rounded to two
 * decimals for storage while the invoice totals accumulated the *unrounded*
 * values, so the stored lines did not add up to the stored total.
 *
 *     3 lines at 33.333  ->  stored as 33.33 each, summing to 99.99
 *                            invoice subtotal stored as 100.00
 *
 * One paisa, on a three-line invoice. On a GSTR-1 return the line items and
 * the invoice totals are both filed, and they are expected to reconcile.
 *
 * The rule everywhere below: round at the line, then sum the rounded values.
 * A total is therefore the exact sum of its parts by construction, not by
 * luck.
 */

import Decimal from "decimal.js";

/**
 * 34 significant digits is far more than `numeric(15, 2)` can hold, so no
 * intermediate product loses precision. ROUND_HALF_UP is the convention for
 * Indian tax invoices — 0.005 rounds to 0.01, not to even.
 */
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/** Coerce anything the request or the database hands us into a Decimal. */
export function dec(value: unknown): Decimal {
  if (value instanceof Decimal) return value;
  if (value === null || value === undefined || value === "") return new Decimal(0);
  try {
    const d = new Decimal(String(value));
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/** Round to paise — two decimal places. */
export function paise(value: Decimal | unknown): Decimal {
  return dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Round to whole rupees, for the invoice's final rounded-off value. */
export function rupees(value: Decimal | unknown): Decimal {
  return dec(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

/** Exact sum of already-rounded amounts. */
export function sum(values: Array<Decimal | unknown>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
}

/** Sum one field across rows, exactly. */
export function sumBy<T>(rows: readonly T[], pick: (row: T) => unknown): Decimal {
  return rows.reduce<Decimal>((acc, row) => acc.plus(dec(pick(row))), new Decimal(0));
}

/**
 * String form for a `numeric` column. Postgres parses the decimal text
 * directly, so the value never passes through a float on the way in.
 */
export function toColumn(value: Decimal | unknown): string {
  return paise(value).toFixed(2);
}

/**
 * Number form for a JSON response. Two decimal places always survive this
 * intact, so the API shape is unchanged — the exactness is in how the value
 * was reached, not in how it is serialised.
 */
export function toJson(value: Decimal | unknown): number {
  return paise(value).toNumber();
}

/**
 * Split a GST amount into its central and state halves.
 *
 * Computing each half independently and rounding both can leave
 * `cgst + sgst` a paisa away from the tax actually charged. Rounding one half
 * and taking the remainder as the other makes the two exactly reconstruct the
 * total, which is what the return has to show.
 */
export function splitGst(total: Decimal): { cgst: Decimal; sgst: Decimal } {
  const cgst = paise(total.dividedBy(2));
  return { cgst, sgst: paise(total.minus(cgst)) };
}
