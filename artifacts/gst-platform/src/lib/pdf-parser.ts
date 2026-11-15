import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as mammoth from "mammoth";
import { createWorker } from "tesseract.js";
import { spreadsheetBufferToText } from "./spreadsheet-text";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

import { annotateResult, textTooLongError, ImportLimitError, MAX_PDF_PAGES, MAX_EXTRACTED_TEXT_CHARS, type ParsedPdfResult } from "./bill-text";
export * from "./bill-text";


async function openPdf(file: File) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new ImportLimitError(
      `This PDF has ${pdf.numPages} pages; the importer reads at most ${MAX_PDF_PAGES}. Split the file or add the items manually.`,
    );
  }
  return pdf;
}


async function extractPdfText(file: File): Promise<string> {
  const pdf = await openPdf(file);
  const lines: string[] = [];
  let totalChars = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    // Group text items by their y-position to reconstruct lines. A item joins the earliest-created
    // bucket whose y is within 2 of its own; `order` records creation order so that lookup stays O(1)
    // (the keys are integers, so only y-2..y+2 can qualify) instead of scanning every bucket per item.
    const rows = new Map<number, { x: number; str: string }[]>();
    const order = new Map<number, number>();
    for (const item of content.items as any[]) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      let bucket = y;
      let bucketOrder = Infinity;
      for (let d = -2; d <= 2; d++) {
        const o = order.get(y + d);
        if (o !== undefined && o < bucketOrder) { bucket = y + d; bucketOrder = o; }
      }
      if (!rows.has(bucket)) { rows.set(bucket, []); order.set(bucket, order.size); }
      rows.get(bucket)!.push({ x, str: item.str });
    }
    const sortedY = [...rows.keys()].sort((a, b) => b - a);
    for (const y of sortedY) {
      const parts = rows.get(y)!.sort((a, b) => a.x - b.x);
      const line = parts.map(p => p.str).join(" ").replace(/\s+/g, " ").trim();
      totalChars += line.length + 1;
      if (totalChars > MAX_EXTRACTED_TEXT_CHARS) throw textTooLongError();
      lines.push(line);
    }
  }
  return lines.filter(Boolean).join("\n");
}

async function renderPdfPages(file: File): Promise<HTMLCanvasElement[]> {
  const pdf = await openPdf(file);
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

// Served from this origin by the `self-hosted-ocr-assets` plugin in vite.config.ts.
// Without these paths tesseract.js pulls its worker and WebAssembly core from jsDelivr
// and the English model from tessdata.projectnaptha.com, which the page's
// Content-Security-Policy (script-src / connect-src 'self') does not allow.
const OCR_BASE = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}ocr`;

async function extractOcrText(images: Array<File | HTMLCanvasElement>): Promise<string> {
  const worker = await createWorker("eng", undefined, {
    workerPath: `${OCR_BASE}/worker.min.js`,
    corePath: `${OCR_BASE}/core`,
    langPath: `${OCR_BASE}/lang`,
    // Spawn the script directly instead of through a blob: URL wrapper, so worker-src can stay 'self'.
    workerBlobURL: false,
  });
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
  return spreadsheetBufferToText(await file.arrayBuffer());
}

/** Largest file the importer will read. Every parser below loads the whole file into memory. */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

export class ImportFileTooLargeError extends Error {
  constructor(public readonly fileBytes: number) {
    super(`File is ${(fileBytes / (1024 * 1024)).toFixed(1)} MB; the limit is ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)} MB.`);
    this.name = "ImportFileTooLargeError";
  }
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


export async function parsePurchaseBill(file: File, products: any[]): Promise<ParsedPdfResult> {
  // Checked before anything reads the file: File.size comes from the file's metadata, so a
  // large upload is refused without being pulled into memory or handed to a parser.
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new ImportFileTooLargeError(file.size);

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

/** The text of any importable file: PDF (OCR when scanned), image (OCR), Word, spreadsheet or plain text. */
export async function fileToText(file: File): Promise<string> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw new ImportFileTooLargeError(file.size);
  const extension = getExtension(file);
  if (file.type === "application/pdf" || extension === "pdf") {
    const text = await extractPdfText(file);
    return text.trim() ? text : extractOcrText(await renderPdfPages(file));
  }
  if (isImageFile(file)) return extractOcrText([file]);
  if (extension === "docx") return extractWordText(file);
  if (isSpreadsheetFile(file)) return extractSpreadsheetText(file);
  return file.text();
}
