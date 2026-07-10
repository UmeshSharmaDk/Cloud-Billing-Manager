import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

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
}

async function extractText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Group text items by their y-position to reconstruct lines
    const rows = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as any[]) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      const bucket = [...rows.keys()].find(k => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(bucket)) rows.set(bucket, []);
      rows.get(bucket)!.push({ x, str: item.str });
    }
    const sortedY = [...rows.keys()].sort((a, b) => b - a);
    for (const y of sortedY) {
      const parts = rows.get(y)!.sort((a, b) => a.x - b.x);
      lines.push(parts.map(p => p.str).join(" ").replace(/\s+/g, " ").trim());
    }
  }
  return lines.filter(Boolean).join("\n");
}

const NUM_RE = /-?\d[\d,]*\.?\d*/g;

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, "")) || 0;
}

function isPlainInt(tok: string): boolean {
  return /^\d+$/.test(tok);
}

function isDecimalToken(tok: string): boolean {
  return /^\d[\d,]*\.?\d*$/.test(tok);
}

function detectHeader(text: string): ParsedPdfResult["detected"] {
  const detected: ParsedPdfResult["detected"] = {};
  const billMatch = text.match(/(?:proforma|invoice|bill|challan)\s*(?:no|number|#)?\s*[:.\-]?\s*([A-Za-z0-9\-\/]+)/i);
  if (billMatch) detected.billNumber = billMatch[1];
  const dateMatch = text.match(/(?:date)\s*[:.\-]?\s*(\d{1,2}[\/\-.][A-Za-z]{3}[\/\-.]\d{2,4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
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
  const vendorMatch = text.match(/(?:for)\s+([A-Za-z0-9 &.,\-]{3,60})\s*\n?\s*Authorised/i) || text.match(/(?:from|vendor|supplier|seller)\s*[:.\-]?\s*([A-Za-z0-9 &.,\-]{3,60})/i);
  if (vendorMatch) detected.vendorName = vendorMatch[1].trim();
  return detected;
}

/**
 * Structured parser tuned to the standard Indian tax-invoice / proforma table layout:
 * Sr.No | Name of Product / Service | HSN / SAC | Qty [unit] | Rate | Taxable Value | GST % | Amount | Total
 * Handles multi-line product names/descriptions (continuation lines with no leading serial number).
 */
function extractTableItems(lines: string[]): { items: ParsedPdfItem[]; warnings: string[] } {
  const items: ParsedPdfItem[] = [];
  const warnings: string[] = [];

  const headerIdx = lines.findIndex(l => /name of product|particulars|description/i.test(l) && /hsn|sac/i.test(l));
  if (headerIdx === -1) return { items, warnings };

  let endIdx = lines.findIndex((l, i) => i > headerIdx && /^total\b/i.test(l.trim()));
  if (endIdx === -1) endIdx = lines.length;

  const rows = lines.slice(headerIdx + 1, endIdx);
  let current: ParsedPdfItem | null = null;

  for (const row of rows) {
    const tokens = row.split(" ").filter(Boolean);
    if (tokens.length === 0) continue;

    if (isPlainInt(tokens[0]) && tokens.length > 1) {
      // Look for the HSN/SAC token: a plain integer of 4-8 digits, appearing after the serial number
      let hsnIdx = -1;
      for (let i = 1; i < tokens.length; i++) {
        if (isPlainInt(tokens[i]) && tokens[i].length >= 4 && tokens[i].length <= 8) { hsnIdx = i; break; }
      }
      if (hsnIdx === -1) {
        // No HSN found on this line — treat as a continuation of the previous item's description
        if (current && !/^\d/.test(tokens[0])) current.description += " " + row;
        continue;
      }

      const description = tokens.slice(1, hsnIdx).join(" ").trim();
      const hsnCode = tokens[hsnIdx];
      const rest = tokens.slice(hsnIdx + 1);
      let ri = 0;
      const nextNum = (): number | null => {
        while (ri < rest.length && !isDecimalToken(rest[ri])) ri++;
        if (ri >= rest.length) return null;
        return parseNum(rest[ri++]);
      };

      const quantity = nextNum();
      // Optional unit token (alphabetic, e.g. "PCS", "NOS", "KG") right after qty
      let unit: string | undefined;
      if (ri < rest.length && /^[A-Za-z]+$/.test(rest[ri])) { unit = rest[ri]; ri++; }
      const rate = nextNum();
      nextNum(); // taxableValue — recomputed by app, skip
      const gstRate = nextNum();
      // remaining tokens (gst amount, total) are recomputed by app — ignored

      if (description && quantity !== null && quantity > 0 && rate !== null && rate > 0) {
        current = { description, quantity, unitPrice: rate, hsnCode, gstRate: gstRate ?? undefined, unit };
        items.push(current);
      } else {
        current = null;
      }
    } else if (current && !/^(total|taxable|add|less|gst payable|certified|for\s)/i.test(row)) {
      // Continuation line for a multi-line product name/description
      current.description += " " + row;
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

    const nums = line.match(NUM_RE);
    if (!nums || nums.length < 2) continue;

    const firstNumIdx = line.search(NUM_RE);
    if (firstNumIdx < 2) continue;
    let description = line.slice(0, firstNumIdx).trim();
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
      for (let qi = 0; qi < candidates.length; qi++) {
        for (let ri = 0; ri < candidates.length; ri++) {
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

    const gstMatch = line.match(/(\d{1,2})\s*%/);
    const gstRate = gstMatch ? parseFloat(gstMatch[1]) : undefined;

    items.push({ description, quantity, unitPrice, hsnCode: hsnToken, gstRate });
  }

  if (items.length === 0) {
    warnings.push("Could not automatically detect line items in this PDF. Please add them manually below, or try a text-based (not scanned/image) PDF.");
  }

  return { items, warnings };
}

export async function parsePdfPurchaseBill(file: File, products: any[]): Promise<ParsedPdfResult> {
  const rawText = await extractText(file);
  if (!rawText.trim()) {
    return {
      items: [],
      warnings: ["No extractable text found — this PDF may be a scanned image. Try a text-based PDF export instead."],
      rawText: "",
      detected: {},
    };
  }
  const detected = detectHeader(rawText);
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);

  let { items, warnings } = extractTableItems(lines);
  if (items.length === 0) {
    ({ items, warnings } = extractLineItemsHeuristic(rawText));
  }

  // Annotate items that already exist in the catalog (by exact name match) so the
  // caller can inform the user that saving will update that product rather than
  // create a new one — matching happens by name, not by manual linking.
  for (const item of items) {
    const matched = products.find(p => p.name.toLowerCase().trim() === item.description.toLowerCase().trim());
    if (matched) {
      warnings.push(`"${item.description}" matches an existing product — its stock, price and GST will be updated on save.`);
    } else {
      warnings.push(`"${item.description}" not found in your product catalog — it will be added as a new product.`);
    }
  }

  return { items, warnings, rawText, detected };
}
