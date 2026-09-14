---
name: PDF purchase bill import parsing
description: How GST Pro extracts purchase line items from vendor bill PDFs client-side, and why.
---

GST Pro's purchase-new form imports vendor bill files directly in the browser. Text PDFs use `pdfjs-dist`; scanned PDFs and images use Tesseract OCR; Word and spreadsheet files are converted to text/table rows before the same regex/heuristics split lines into description + quantity + rate (+ optional HSN/GST%). No backend endpoint or AI call is used for this.

**Why:** Vendor bill PDFs have no fixed schema, so a rigid column parser (like the old CSV importer) can't work. A pure client-side heuristic avoids adding a server dependency/AI cost for what is fundamentally a "pre-fill, then let the user review/edit" feature — the editable line-item table after import is the real correctness guarantee, not the parser.

**How to apply:** OCR and document conversion are best-effort and can misread invoice columns, so keep the editable human-review step in the form. If a future request asks for higher accuracy, consider replacing or augmenting the heuristics with an LLM-based extraction call, but retain manual review.
