import express, { Router, type IRouter } from "express";
import { requireAuth } from "./auth";
import { PdfTextError, pdfText } from "../lib/pdf-text";

const router: IRouter = Router();

/**
 * POST /import/pdf-text, body: the PDF itself (application/pdf, up to 10 MB,
 * the website's import ceiling). Answers `{ text }`. Nothing is stored.
 */
router.post("/pdf-text", requireAuth, express.raw({ type: "application/pdf", limit: "10mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "Send the PDF as the request body, with Content-Type application/pdf." });
  try {
    const text = await pdfText(new Uint8Array(req.body));
    if (!text.trim()) return res.status(422).json({ error: "This PDF is a scan with no text in it. Take a photo of the bill instead." });
    return res.json({ text });
  } catch (err) {
    if (err instanceof PdfTextError) return res.status(422).json({ error: err.message });
    throw err;
  }
});

export default router;
