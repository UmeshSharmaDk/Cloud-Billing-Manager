/**
 * Deciding whether a supply is intra-state or inter-state.
 *
 * India splits GST by where the supply lands. A supply inside the seller's own
 * state is taxed as CGST + SGST, one crossing a state line as IGST. The total
 * the customer pays is identical, so the mistake is invisible on the invoice
 * total and shows up later, expensively: the customer claims input credit under
 * a head they are not entitled to, GSTR-1 and GSTR-3B are filed wrong, and
 * putting it right needs a credit note and a revised return.
 *
 * It was previously decided like this:
 *
 *     const bizStateCode = business?.stateCode ?? "";
 *     const isInterstate = placeOfSupply ? placeOfSupply.trim() !== bizStateCode.trim() : false;
 *
 * `businesses.state_code` is nullable and registration never sets it, so every
 * newly registered business carried `null` — and `null ?? ""` compares unequal
 * to every real state code. The result was IGST on *every* invoice that named a
 * place of supply, including purely local ones, for every business that had not
 * gone and filled the field in by hand. Nothing prompted them to.
 */

/**
 * State codes issued under GST. The first two digits of a GSTIN are one of
 * these, so the list is what makes a GSTIN safe to read a state code out of.
 *
 * 01-38 are states and union territories; 97 is "Other Territory" and 99 is
 * used for a foreign counterparty. New codes are issued occasionally (38,
 * Ladakh, is recent) — add them here when they are.
 */
const STATE_CODES: ReadonlySet<string> = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, "0")),
  "97",
  "99",
]);

/**
 * Normalise a state code for comparison.
 *
 * Accepts `7` as well as `07`, because both appear in practice and comparing
 * them as raw strings silently makes a local sale look inter-state. Returns
 * `null` for anything that is not a state code, rather than a value that would
 * quietly participate in the comparison.
 */
export function normaliseStateCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const padded = trimmed.padStart(2, "0");
  return STATE_CODES.has(padded) ? padded : null;
}

/**
 * Read the state code out of a GSTIN.
 *
 * A GSTIN is 15 characters and opens with the two-digit code of the state the
 * registration belongs to: `27AAAPA1234A1Z5` is Maharashtra. That makes it an
 * authoritative source rather than a guess, which is why it is worth falling
 * back to — a GST billing product's businesses nearly all have one.
 *
 * Only the length and the leading code are checked. Validating the rest of the
 * format is a different job, and being strict about characters this function
 * does not read would reject GSTINs it could have answered for.
 */
export function stateCodeFromGstin(gstin: unknown): string | null {
  if (typeof gstin !== "string") return null;
  const trimmed = gstin.trim();
  if (trimmed.length !== 15) return null;
  return normaliseStateCode(trimmed.slice(0, 2));
}

/** The seller's state code, preferring the explicit field over the GSTIN. */
export function businessStateCode(business: {
  stateCode?: string | null;
  gstin?: string | null;
} | null | undefined): string | null {
  return normaliseStateCode(business?.stateCode) ?? stateCodeFromGstin(business?.gstin);
}

export type SupplyType =
  | { ok: true; isInterstate: boolean }
  | { ok: false; error: string };

/**
 * Decide the supply type for an invoice.
 *
 * With no place of supply the supply is treated as local, which is the existing
 * behaviour and the right default for a counter sale.
 *
 * With a place of supply and no way to establish the seller's own state, this
 * refuses rather than guessing. Either guess produces an invoice that is wrong
 * in a way the total does not reveal, and a blocked invoice with an actionable
 * message is cheaper than a filed return that has to be amended. This is the
 * same "fail loudly rather than silently falling back" the cross-tenant lookups
 * were fixed to follow.
 */
export function resolveSupplyType(
  business: { stateCode?: string | null; gstin?: string | null } | null | undefined,
  placeOfSupply: string | null | undefined,
): SupplyType {
  const place = normaliseStateCode(placeOfSupply);

  // Absent, or present but not a state code at all. The latter would previously
  // have been compared as a raw string and almost certainly read as inter-state.
  if (place === null) {
    const given = typeof placeOfSupply === "string" ? placeOfSupply.trim() : "";
    if (given !== "") {
      return {
        ok: false,
        error:
          `"${given}" is not a valid GST state code. Use the two-digit code for ` +
          `the place of supply, for example 27 for Maharashtra.`,
      };
    }
    return { ok: true, isInterstate: false };
  }

  const seller = businessStateCode(business);
  if (seller === null) {
    return {
      ok: false,
      error:
        "Set your business state code before issuing an invoice with a place of " +
        "supply. Without it there is no way to tell whether this sale is taxed as " +
        "CGST + SGST or as IGST, and guessing would put the wrong tax on the invoice.",
    };
  }

  return { ok: true, isInterstate: seller !== place };
}

/**
 * Decide the supply type for a purchase.
 *
 * An inward supply is the mirror of an outward one, and the inputs differ. For
 * a sale the seller is us and the destination varies per invoice, so the place
 * of supply has to be stated. For a purchase the supplier is the vendor and the
 * destination is our own place of business, so the comparison is the vendor's
 * state against ours — both of which are already recorded. Nothing new needs to
 * be asked of the user, which is why this takes no place of supply.
 *
 * The vendor's state comes from their state code, then their GSTIN, then the
 * GSTIN copied onto the bill itself — that last one covers a bill recorded
 * before the vendor record was completed.
 *
 * `hasGst` is what keeps this from blocking legitimate bookkeeping. A purchase
 * from an unregistered supplier carries no GST at all, so every split is zero
 * and the question is moot; refusing it would stop a business recording a bill
 * it has actually received. When there *is* tax on the bill the split decides
 * which head the input credit is claimed under, and guessing is the bug this
 * exists to prevent — so that case refuses.
 */
export function resolveInwardSupplyType(
  business: { stateCode?: string | null; gstin?: string | null } | null | undefined,
  vendor: { stateCode?: string | null; gstin?: string | null } | null | undefined,
  billGstin: string | null | undefined,
  hasGst: boolean,
): SupplyType {
  const buyer = businessStateCode(business);
  const supplier = businessStateCode(vendor) ?? stateCodeFromGstin(billGstin);

  if (buyer === null || supplier === null) {
    // No tax to misfile, so nothing to get wrong.
    if (!hasGst) return { ok: true, isInterstate: false };

    return {
      ok: false,
      error:
        buyer === null
          ? "Set your business state code or GSTIN before recording a bill that " +
            "carries GST. Without it there is no way to tell whether the input " +
            "credit is IGST or CGST + SGST."
          : "This vendor has no state code or GSTIN, so the input credit on this " +
            "bill cannot be attributed to IGST or to CGST + SGST. Add the vendor's " +
            "GSTIN and record the bill again.",
    };
  }

  return { ok: true, isInterstate: buyer !== supplier };
}
