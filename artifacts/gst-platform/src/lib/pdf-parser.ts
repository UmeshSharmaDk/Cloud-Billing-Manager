import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as mammoth from "mammoth";
import { createWorker } from "tesseract.js";
import * as XLSX from "xlsx";

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
  source?: "text-pdf" | "scanned-pdf" | "image" | "word" | "spreadsheet" | "text";
}

async function extractPdfText(file: File): Promise<string> {
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

async function renderPdfPages(file: File): Promise<HTMLCanvasElement[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const canvases: HTMLCanvasElement[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, Math.max(1.5, 1800 / baseViewport.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) continue;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    canvases.push(canvas);
  }

  return canvases;
}

async function extractOcrText(images: Array<File | HTMLCanvasElement>): Promise<string> {
  const worker = await createWorker("eng");
  try {
    const pages: string[] = [];
    for (const image of images) {
      const result = await worker.recognize(image);
      if (result.data.text.trim()) pages.push(result.data.text.trim());
    }
    return pages.join("\n");
  } finally {
    await worker.terminate();
  }
}

async function extractWordText(file: File): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

async function extractSpreadsheetText(file: File): Promise<string> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  return workbook.SheetNames
    .map(name => {
      const sheet = workbook.Sheets[name];
      return XLSX.utils.sheet_to_csv(sheet, { FS: "\t", blankrows: false });
    })
    .filter(Boolean)
    .join("\n");
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

    const gstMatch = row.match(/(\d{1,2})\s*%/);
    const gstRate = gstMatch ? parseFloat(gstMatch[1]) : undefined;

    items.push({ description, quantity, unitPrice, hsnCode: hsnToken, gstRate });
  }

  if (items.length === 0) {
    warnings.push("Could not automatically detect line items in this file. Please review the source or add the items manually below.");
  }

  return { items, warnings };
}

function getExtension(file: File): string {
  return file.name.toLowerCase().split(".").pop() || "";
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif"].includes(getExtension(file));
}

function isWordFile(file: File): boolean {
  return ["doc", "docx"].includes(getExtension(file)) ||
    file.type === "application/msword" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isSpreadsheetFile(file: File): boolean {
  return ["xls", "xlsx", "xlsm", "csv"].includes(getExtension(file)) ||
    file.type.includes("spreadsheet") ||
    file.type === "application/vnd.ms-excel" ||
    file.type === "text/csv";
}

function annotateResult(
  rawText: string,
  products: any[],
  source: ParsedPdfResult["source"],
  initialWarnings: string[] = [],
): ParsedPdfResult {
  const warnings = [...initialWarnings];
  const detected = detectHeader(rawText);
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);

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

export async function parsePurchaseBill(file: File, products: any[]): Promise<ParsedPdfResult> {
  const extension = getExtension(file);

  if (file.type === "application/pdf" || extension === "pdf") {
    const text = await extractPdfText(file);
    if (text.trim()) return annotateResult(text, products, "text-pdf");

    const scannedPages = await renderPdfPages(file);
    if (scannedPages.length === 0) {
      return {
        items: [],
        warnings: ["This PDF could not be rendered for OCR. Please try another file or add the items manually below."],
        rawText: "",
        detected: {},
        source: "scanned-pdf",
      };
    }
    const ocrText = await extractOcrText(scannedPages);
    if (!ocrText.trim()) {
      return {
        items: [],
        warnings: ["No text could be recognised in this scanned PDF. Please check the image quality or add the items manually below."],
        rawText: "",
        detected: {},
        source: "scanned-pdf",
      };
    }
    return annotateResult(ocrText, products, "scanned-pdf", [
      "This scanned PDF was read with OCR. Please review every extracted field before saving.",
    ]);
  }

  if (isImageFile(file)) {
    const text = await extractOcrText([file]);
    if (!text.trim()) {
      return {
        items: [],
        warnings: ["No text could be recognised in this image. Please use a clearer image or add the items manually below."],
        rawText: "",
        detected: {},
        source: "image",
      };
    }
    return annotateResult(text, products, "image", [
      "This image was read with OCR. Please review every extracted field before saving.",
    ]);
  }

  if (isWordFile(file)) {
    if (extension === "doc") {
      return {
        items: [],
        warnings: ["Legacy .doc files are not supported yet. Save the document as .docx or PDF and import it again."],
        rawText: "",
        detected: {},
        source: "word",
      };
    }
    const text = await extractWordText(file);
    return annotateResult(text, products, "word", [
      "This Word document was converted to text. Please review the extracted fields before saving.",
    ]);
  }

  if (isSpreadsheetFile(file)) {
    const text = await extractSpreadsheetText(file);
    return annotateResult(text, products, "spreadsheet", [
      "Spreadsheet rows were converted into bill line items. Please review the extracted fields before saving.",
    ]);
  }

  if (file.type === "text/plain" || extension === "txt") {
    return annotateResult(await file.text(), products, "text");
  }

  throw new Error("Unsupported file type");
}

// Kept as a compatibility alias for any existing callers.
export const parsePdfPurchaseBill = parsePurchaseBill;
