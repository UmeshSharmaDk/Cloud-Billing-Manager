/**
 * The text half of bill import: turns the text of a purchase bill (from a PDF,
 * OCR, a spreadsheet) into line items. No browser or file APIs, so the Android
 * app runs the same code (exports/GST-Pro-Android/lib/bill-text.ts is a copy;
 * change both together).
 */
export interface ParsedPdfItem {
  description: string;
  quantity: number;
  unitPrice: number;
  hsnCode?: string;
  gstRate?: number;
  unit?: string;
}

export interface ParsedPdfResult {
  items: ParsedPdfItem[];
  warnings: string[];
  rawText: string;
  detected: { billNumber?: string; billDate?: string; vendorName?: string };
  source?: "text-pdf" | "scanned-pdf" | "image" | "word" | "spreadsheet" | "text";
}

/**
 * Hard limits so a single hostile or pathological file cannot burn the tab. They are far above what a
 * real purchase bill needs; hitting one raises an ImportLimitError, which the import page shows as a toast.
 */
export const MAX_PDF_PAGES = 50;
export const MAX_EXTRACTED_TEXT_CHARS = 2_000_000;
/** Rows (non-empty lines) handed to the table / line-item extractors. */
export const MAX_TEXT_ROWS = 20_000;
/** Lines longer than this are not line items; the heuristic skips them instead of scanning them. */
const MAX_HEURISTIC_ROW_CHARS = 5_000;
/** Pair search in the heuristic is O(k^2) in the numbers on a row; only the first k are considered. */
const MAX_PAIR_SEARCH_NUMBERS = 40;

export class ImportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportLimitError";
  }
}

export function textTooLongError(): ImportLimitError {
  return new ImportLimitError(
    `This file contains more than ${MAX_EXTRACTED_TEXT_CHARS.toLocaleString("en-US")} characters of text, which is more than the importer will process. Use a smaller file or add the items manually.`,
  );
}

const NUM_RE = /-?\d[\d,]*\.?\d*/g;

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, "")) || 0;
}

function isPlainInt(tok: string): boolean {
  return /^\d+$/.test(tok);
}

function isDecimalToken(tok: string): boolean {
  // Same language as /^\d[\d,]*\.?\d*$/ but unambiguous: the original let [\d,]* and \d* split a digit run
  // many ways, so a long digit token followed by a non-digit backtracked quadratically.
  return /^\d[\d,]*(?:\.\d*)?$/.test(tok);
}

function detectHeader(text: string): ParsedPdfResult["detected"] {
  const detected: ParsedPdfResult["detected"] = {};
  // Collapse every whitespace run to a single character (a newline if the run held one, else a space)
  // and keep the whitespace gaps below bounded. Adjacent unbounded `\s*` quantifiers made the old
  // patterns backtrack polynomially on a long run of spaces ("invoice" + 5,000 spaces + "!" took ~40 s).
  const flat = text.replace(/\s+/g, run => (run.includes("\n") ? "\n" : " "));
  const billMatch = flat.match(/(?:proforma|invoice|bill|challan)\s{0,3}(?:no|number|#)?\s{0,3}[:.\-]?\s{0,3}([A-Za-z0-9\-\/]+)/i);
  if (billMatch) detected.billNumber = billMatch[1];
  const dateMatch = flat.match(/(?:date)\s{0,3}[:.\-]?\s{0,3}(\d{1,2}[\/\-.][A-Za-z]{3}[\/\-.]\d{2,4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (dateMatch) {
    const raw = dateMatch[1];
    const iso = raw.match(/^\d{4}-\d{2}-\d{2}$/) ? raw : null;
    if (iso) {
      detected.billDate = iso;
    } else {
      const monthMap: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
      const monthMatch = raw.match(/^(\d{1,2})[\/\-.]([A-Za-z]{3})[\/\-.](\d{2,4})$/);
      if (monthMatch) {
        let [, d, mon, y] = monthMatch;
        if (y.length === 2) y = "20" + y;
        const m = monthMap[mon.toLowerCase()];
        if (m) detected.billDate = `${y}-${m}-${d.padStart(2, "0")}`;
      } else {
        const parts = raw.split(/[\/\-.]/);
        if (parts.length === 3) {
          let [d, m, y] = parts;
          if (y.length === 2) y = "20" + y;
          detected.billDate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
        }
      }
    }
  }
  const vendorMatch =
    (/authorised/i.test(flat) ? flat.match(/for\s{1,3}([A-Za-z0-9 &.,\-]{3,60})\s{0,3}Authorised/i) : null) ||
    flat.match(/(?:from|vendor|supplier|seller)\s{0,3}[:.\-]?\s{0,3}([A-Za-z0-9 &.,\-]{3,60})/i);
  if (vendorMatch) detected.vendorName = vendorMatch[1].trim();
  return detected;
}

const CURRENCY_TOKEN_RE = /^(rs\.?|inr|₹|usd|\$)$/i;
const SKIP_ROW_RE = /^(total|sub\s*total|grand\s*total|taxable|add\b|less\b|discount|gst payable|gst on reverse|invoice value|amount chargeable|amount in words|terms\b|bank\b|certified|e\s*&\s*o\.?e\.?|for\s+[a-z]|authorised|authorized|declaration|thank you|remark|received|balance|previous|current\s*balance|hsn\s*$|common seal|signatory)/i;

/**
 * Determines whether a token looks like an HSN/SAC code: a plain 3-8 digit integer.
 */
function isHsnToken(tok: string): boolean {
  return isPlainInt(tok) && tok.length >= 3 && tok.length <= 8;
}

/**
 * Structured parser tuned to the standard Indian tax-invoice / proforma table layout, generalized
 * to tolerate varying column orders/sets seen across real-world invoice templates:
 * Sr.No | Item/Product/Description | HSN/SAC | Qty [Unit] | Rate | [Taxable Value] | [Discount] | GST% | [GST Amt] | [Total/Amount]
 * GST% may appear as a plain decimal in a "Tax %"/"GST Rate" column, or embedded with a literal "%" sign anywhere in the row.
 * Handles multi-line product names/descriptions (continuation lines with no leading serial number),
 * and item rows without a leading serial number (some templates group items under a shared heading).
 */
function extractTableItems(lines: string[]): { items: ParsedPdfItem[]; warnings: string[] } {
  const items: ParsedPdfItem[] = [];
  const warnings: string[] = [];

  const headerIdx = lines.findIndex(l => /name of product|particulars|description|item/i.test(l) && /hsn|sac/i.test(l));
  if (headerIdx === -1) return { items, warnings };

  let endIdx = lines.findIndex((l, i) => i > headerIdx && /^total\b/i.test(l.trim()));
  if (endIdx === -1) endIdx = lines.length;

  const rows = lines.slice(headerIdx + 1, endIdx);
  let current: ParsedPdfItem | null = null;

  for (const rawRow of rows) {
    const cleanedRow = rawRow.replace(new RegExp(`\\b${CURRENCY_TOKEN_RE.source.replace(/^\^|\$$/g, "")}\\b`, "gi"), " ").replace(/\s+/g, " ").trim();
    const tokens = /[,;\t|]/.test(cleanedRow)
      ? cleanedRow.split(/[,;\t|]/).map(token => token.trim()).filter(Boolean)
      : cleanedRow.split(" ").filter(Boolean);
    if (tokens.length === 0) continue;

    // A serial number (1-3 digit plain int) may lead the row; skip it when looking for the HSN token.
    const hasLeadingSerial = isPlainInt(tokens[0]) && tokens[0].length <= 3;
    const startIdx = hasLeadingSerial ? 1 : 0;

    let hsnIdx = -1;
    for (let i = startIdx; i < tokens.length; i++) {
      if (isHsnToken(tokens[i])) { hsnIdx = i; break; }
    }

    if (hsnIdx === -1) {
      // No HSN found on this line — treat as a continuation of the previous item's description,
      // unless it looks like a totals/summary/footer row.
      if (current && !SKIP_ROW_RE.test(cleanedRow) && !/^\d/.test(tokens[0])) {
        current.description += " " + cleanedRow;
      }
      continue;
    }

    const description = tokens.slice(startIdx, hsnIdx).join(" ").trim();
    const hsnCode = tokens[hsnIdx];
    const rest = tokens.slice(hsnIdx + 1);

    // GST % may be written with an explicit "%" sign anywhere in the row (e.g. "18%", "(5%)").
    const percentMatch = cleanedRow.match(/\(?(\d{1,2}(?:\.\d+)?)\s*%\)?/);

    let ri = 0;
    const nextNum = (): number | null => {
      while (ri < rest.length && (!isDecimalToken(rest[ri]) || rest[ri].includes("%"))) ri++;
      if (ri >= rest.length) return null;
      return parseNum(rest[ri++]);
    };

    const quantity = nextNum();
    // Optional unit token (alphabetic, e.g. "PCS", "NOS", "KG", "Dozens") right after qty
    let unit: string | undefined;
    if (ri < rest.length && /^[A-Za-z]+$/.test(rest[ri])) { unit = rest[ri]; ri++; }
    const rate = nextNum();

    // Remaining decimal tokens (amount, discount, taxable value, gst amount, total) vary by template.
    // If no explicit "%" was found, fall back to picking the first small (0, 30] value among the
    // trailing numbers as the GST rate — GST slabs are always <= 28%, unlike amounts/totals.
    const trailing: number[] = [];
    let n: number | null;
    while ((n = nextNum()) !== null) trailing.push(n);

    let gstRate: number | undefined = percentMatch ? parseFloat(percentMatch[1]) : undefined;
    if (gstRate === undefined) {
      const candidate = trailing.find(v => v > 0 && v <= 30);
      if (candidate !== undefined) gstRate = candidate;
    }

    if (description && quantity !== null && quantity > 0 && rate !== null && rate > 0) {
      current = { description, quantity, unitPrice: rate, hsnCode, gstRate, unit };
      items.push(current);
    } else {
      current = null;
    }
  }

  // Clean up descriptions (collapse extra whitespace)
  for (const it of items) it.description = it.description.replace(/\s+/g, " ").trim();

  if (items.length === 0) {
    warnings.push("Found an item table but couldn't parse its rows — please add line items manually.");
  }

  return { items, warnings };
}

/**
 * Fallback heuristic for unstructured invoice/bill PDFs that don't match the
 * standard table layout. Looks for lines containing a description followed by
 * 2-4 numeric tokens resembling: quantity, rate, [gst%], [amount].
 */
function extractLineItemsHeuristic(text: string): { items: ParsedPdfItem[]; warnings: string[] } {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const items: ParsedPdfItem[] = [];
  const warnings: string[] = [];

  const skipPatterns = /^(invoice|bill|date|total|subtotal|amount|gstin|pan|hsn|sac|address|state|place of supply|terms|note|bank|declaration|thank you|page|tax invoice|sr\.?\s*no|description|particulars|qty|rate|discount|cgst|sgst|igst|grand total|balance)/i;

  for (const line of lines) {
    if (skipPatterns.test(line.trim())) continue;
    if (line.length < 4) continue;

    if (line.length > MAX_HEURISTIC_ROW_CHARS) continue;

    // OCR and spreadsheets often include a leading serial number before the description.
    const row = line.replace(/^\s*\d{1,3}[.)-]?\s+/, "").trim();

    const nums = row.match(NUM_RE);
    if (!nums || nums.length < 2) continue;

    const firstNumIdx = row.search(NUM_RE);
    if (firstNumIdx < 2) continue;
    let description = row.slice(0, firstNumIdx).trim();
    description = description.replace(/^\d+[.)]\s*/, "");
    if (!description || description.length < 2) continue;
    if (/^[\d\s.,\-\/]+$/.test(description)) continue;

    const values = nums.map(parseNum).filter(n => n > 0);
    if (values.length < 2) continue;

    const hsnToken = nums.find(n => /^\d{4,8}$/.test(n.replace(/,/g, "")));

    const candidates = values.filter(v => hsnToken ? v !== parseNum(hsnToken) : true);
    if (candidates.length < 2) continue;

    let quantity = candidates[0];
    let unitPrice = candidates[1];

    if (candidates.length >= 3) {
      const amount = candidates[candidates.length - 1];
      const searched = Math.min(candidates.length, MAX_PAIR_SEARCH_NUMBERS);
      for (let qi = 0; qi < searched; qi++) {
        for (let ri = 0; ri < searched; ri++) {
          if (qi === ri) continue;
          const q = candidates[qi], r = candidates[ri];
          if (Math.abs(q * r - amount) < 1) { quantity = q; unitPrice = r; break; }
        }
      }
    }

    if (quantity <= 0 || unitPrice <= 0 || quantity > 100000) continue;
    if (quantity > 1000 && unitPrice < 10 && candidates.length === 2) {
      [quantity, unitPrice] = [unitPrice, quantity];
    }

    const gstMatch = row.match(/(\d{1,2})\s*%/);
    const gstRate = gstMatch ? parseFloat(gstMatch[1]) : undefined;

    items.push({ description, quantity, unitPrice, hsnCode: hsnToken, gstRate });
  }

  if (items.length === 0) {
    warnings.push("Could not automatically detect line items in this file. Please review the source or add the items manually below.");
  }

  return { items, warnings };
}

export function annotateResult(
  rawText: string,
  products: any[],
  source: ParsedPdfResult["source"],
  initialWarnings: string[] = [],
): ParsedPdfResult {
  if (rawText.length > MAX_EXTRACTED_TEXT_CHARS) throw textTooLongError();
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length > MAX_TEXT_ROWS) {
    throw new ImportLimitError(
      `This file has ${lines.length.toLocaleString("en-US")} rows of text; the importer reads at most ${MAX_TEXT_ROWS.toLocaleString("en-US")}. Use a smaller file or add the items manually.`,
    );
  }
  const warnings = [...initialWarnings];
  const detected = detectHeader(rawText);

  let { items, warnings: tableWarnings } = extractTableItems(lines);
  warnings.push(...tableWarnings);
  if (items.length === 0) {
    const heuristic = extractLineItemsHeuristic(rawText);
    items = heuristic.items;
    warnings.push(...heuristic.warnings);
  }

  // Annotate items that already exist in the catalog so the caller can inform
  // the user whether saving will update or create a product.
  for (const item of items) {
    const matched = products.find(p => p.name.toLowerCase().trim() === item.description.toLowerCase().trim());
    if (matched) {
      warnings.push(`"${item.description}" matches an existing product — its stock, price and GST will be updated on save.`);
    } else {
      warnings.push(`"${item.description}" not found in your product catalog — it will be added as a new product.`);
    }
  }

  return { items, warnings, rawText, detected, source };
}
