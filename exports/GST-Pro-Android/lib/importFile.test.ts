/** Run: node lib/importFile.test.ts (pure parts only; the pickers need a device). */
import assert from "node:assert/strict";
import { annotateResult } from "./bill-text.ts";
import { rowsFromBoxes } from "./ocr-rows.ts";

// OCR hands back a table column by column.
const col = (left: number, cells: string[]) => cells.map((text, i) => ({ text, left, top: 100 + i * 40 + (left % 7), height: 30 }));
const text = rowsFromBoxes([
  ...col(10, ["Sr Description", "1 Steel Rod", "2 Cement Bag"]),
  ...col(300, ["HSN Qty", "7214 10", "2523 5"]),
  ...col(500, ["Rate Amount", "250.00 2500.00", "400.00 2000.00"]),
]);
assert.equal(text.split("\n")[1], "1 Steel Rod 7214 10 250.00 2500.00");
const items = annotateResult(text, [], "image").items;
assert.deepEqual(items.map((i) => [i.description, i.quantity, i.unitPrice]), [["Steel Rod", 10, 250], ["Cement Bag", 5, 400]]);
console.log("importFile ok");
