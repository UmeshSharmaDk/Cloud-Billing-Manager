---
name: PDF purchase bill import parsing
description: How GST Pro extracts purchase line items from vendor bill PDFs client-side, and why.
---

GST Pro's purchase-new form imports vendor bill PDFs directly in the browser using `pdfjs-dist`, reconstructing lines from text-item y-positions, then applying regex/heuristics to split each line into description + quantity + rate (+ optional HSN/GST%). No backend endpoint or AI call is used for this.

**Why:** Vendor bill PDFs have no fixed schema, so a rigid column parser (like the old CSV importer) can't work. A pure client-side heuristic avoids adding a server dependency/AI cost for what is fundamentally a "pre-fill, then let the user review/edit" feature — the editable line-item table after import is the real correctness guarantee, not the parser.

**How to apply:** If revisiting this, don't expect the heuristic to be perfect on scanned/image PDFs (no extractable text) — it correctly reports zero items and prompts manual entry in that case. If a future request asks for higher accuracy, consider swapping the heuristic in `artifacts/gst-platform/src/lib/pdf-parser.ts` for an LLM-based extraction call, but keep the human-review step in the form either way.
