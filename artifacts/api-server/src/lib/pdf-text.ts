import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** The website's importer limits (artifacts/gst-platform/src/lib/bill-text.ts). */
const MAX_PDF_PAGES = 50;
const MAX_CHARS = 2_000_000;

export class PdfTextError extends Error {}

/**
 * The text of a PDF, one line per printed row, for the Android app: it has no
 * PDF reader of its own, so it sends the file here and runs the same bill and
 * statement parsers on the text. Rows are rebuilt the way the website does it
 * (lib/pdf-parser.ts): pieces within 2 units of the same height share a line,
 * read left to right. A scanned PDF has no text and comes back empty.
 */
export async function pdfText(data: Uint8Array): Promise<string> {
  // No fonts from disk or the network: the file is untrusted.
  const task = getDocument({ data, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  let pdf;
  try {
    pdf = await task.promise;
  } catch {
    await task.destroy();
    throw new PdfTextError("That file could not be read as a PDF.");
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new PdfTextError(`This PDF has ${pdf.numPages} pages; the importer reads at most ${MAX_PDF_PAGES}.`);
    const lines: string[] = [];
    let chars = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      const rows = new Map<number, { x: number; str: string }[]>();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        // Map keeps insertion order, so the first bucket within reach is the earliest made.
        const bucket = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
        if (!rows.has(bucket)) rows.set(bucket, []);
        rows.get(bucket)!.push({ x: item.transform[4], str: item.str });
      }
      for (const y of [...rows.keys()].sort((a, b) => b - a)) {
        const line = rows.get(y)!.sort((a, b) => a.x - b.x).map((part) => part.str).join(" ").replace(/\s+/g, " ").trim();
        chars += line.length + 1;
        if (chars > MAX_CHARS) throw new PdfTextError("This PDF holds more text than the importer will process.");
        if (line) lines.push(line);
      }
    }
    return lines.join("\n");
  } finally {
    await task.destroy();
  }
}
