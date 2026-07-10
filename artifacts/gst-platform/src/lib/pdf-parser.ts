import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface ParsedPdfItem {
  description: string;
  quantity: number;
  unitPrice: number;
  hsnCode?: string;
  gstRate?: number;
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

function detectHeader(text: string): ParsedPdfResult["detected"] {
  const detected: ParsedPdfResult["detected"] = {};
  const billMatch = text.match(/(?:invoice|bill)\s*(?:no|number|#)?\s*[:.\-]?\s*([A-Za-z0-9\-\/]+)/i);
  if (billMatch) detected.billNumber = billMatch[1];
  const dateMatch = text.match(/(?:date)\s*[:.\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (dateMatch) {
    const raw = dateMatch[1];
    const iso = raw.match(/^\d{4}-\d{2}-\d{2}$/) ? raw : null;
    if (iso) detected.billDate = iso;
    else {
      const parts = raw.split(/[\/\-.]/);
      if (parts.length === 3) {
        let [d, m, y] = parts;
        if (y.length === 2) y = "20" + y;
        detected.billDate = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
    }
  }
  const vendorMatch = text.match(/(?:from|vendor|supplier|seller)\s*[:.\-]?\s*([A-Za-z0-9 &.,\-]{3,60})/i);
  if (vendorMatch) detected.vendorName = vendorMatch[1].trim();
  return detected;
}

/**
 * Heuristically extracts line items from unstructured invoice/bill PDF text.
 * Looks for lines containing a description followed by 2-4 numeric tokens
 * that resemble: quantity, rate, [gst%], [amount].
 */
function extractLineItems(text: string, products: any[]): { items: ParsedPdfItem[]; warnings: string[] } {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const items: ParsedPdfItem[] = [];
  const warnings: string[] = [];

  const skipPatterns = /^(invoice|bill|date|total|subtotal|amount|gstin|pan|hsn|sac|address|state|place of supply|terms|note|bank|declaration|thank you|page|tax invoice|sr\.?\s*no|description|particulars|qty|rate|discount|cgst|sgst|igst|grand total|balance)/i;

  for (const line of lines) {
    if (skipPatterns.test(line.trim())) continue;
    if (line.length < 4) continue;

    const nums = line.match(NUM_RE);
    if (!nums || nums.length < 2) continue;

    // Description is the text before the first number
    const firstNumIdx = line.search(NUM_RE);
    if (firstNumIdx < 2) continue; // no meaningful description text
    let description = line.slice(0, firstNumIdx).trim();
    description = description.replace(/^\d+[.)]\s*/, ""); // strip leading serial number like "1."
    if (!description || description.length < 2) continue;
    if (/^[\d\s.,\-\/]+$/.test(description)) continue;

    const values = nums.map(parseNum).filter(n => n > 0);
    if (values.length < 2) continue;

    // Try to find an HSN code (4-8 digit integer, no decimal) among tokens
    const hsnToken = nums.find(n => /^\d{4,8}$/.test(n.replace(/,/g, "")));

    // Heuristic: quantity is usually the smallest reasonable integer-ish value (<10000),
    // rate/price is a mid-size value, amount (if present) = qty * rate and is the largest.
    const candidates = values.filter(v => hsnToken ? v !== parseNum(hsnToken) : true);
    if (candidates.length < 2) continue;

    let quantity = candidates[0];
    let unitPrice = candidates[1];

    // If a 3rd or 4th value looks like qty * rate, prefer that consistency check
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
    // Guard against picking amount as quantity (swap if quantity looks like a big amount and unitPrice is tiny fraction)
    if (quantity > 1000 && unitPrice < 10 && candidates.length === 2) {
      [quantity, unitPrice] = [unitPrice, quantity];
    }

    const gstMatch = line.match(/(\d{1,2})\s*%/);
    const gstRate = gstMatch ? parseFloat(gstMatch[1]) : undefined;

    const matched = products.find(p =>
      p.name.toLowerCase().trim() === description.toLowerCase().trim() ||
      description.toLowerCase().includes(p.name.toLowerCase().trim())
    );

    items.push({
      description: matched?.name ?? description,
      quantity,
      unitPrice,
      hsnCode: hsnToken || matched?.hsnCode,
      gstRate: gstRate ?? (matched ? parseFloat(matched.gstRate) : undefined),
    });

    if (!matched) warnings.push(`"${description}" not found in your product catalog — will be added as a new line item`);
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
  const { items, warnings } = extractLineItems(rawText, products);
  return { items, warnings, rawText, detected };
}
