/** Run: node src/lib/gstr2b.test.ts */
import assert from "node:assert/strict";
import { parseGstr2b, reconcile } from "./gstr2b.ts";

const file = { data: { docdata: {
  b2b: [{ ctin: "29AAAAA1111A1Z5", trdnm: "Acme", inv: [
    { inum: "INV/001", dt: "05-11-2026", val: 1180, txval: 1000, igst: 180 },
    { inum: "INV-002", dt: "06-11-2026", val: 590, txval: 500, cgst: 45, sgst: 45 },
    { inum: "X9", dt: "07-11-2026", val: 118, txval: 100, igst: 18 },
  ] }],
  cdnr: [{ ctin: "29AAAAA1111A1Z5", nt: [{ ntnum: "CN1", typ: "C", dt: "08-11-2026", val: 118, igst: 18 }] }],
} } };
const portal = parseGstr2b(file);
assert.equal(portal.length, 4);
assert.equal(portal[3].tax, -18);

const books = [
  { id: 1, vendorName: "Acme", vendorGstin: "29aaaaa1111a1z5", invoiceNumber: "inv 001", invoiceDate: "2026-11-05", totalGst: 180, grandTotal: 1180 },
  { id: 2, vendorName: "Acme", vendorGstin: "29AAAAA1111A1Z5", invoiceNumber: "INV-002", invoiceDate: "2026-11-06", totalGst: 100, grandTotal: 600 },
  { id: 3, vendorName: "Other", vendorGstin: "27BBBBB2222B1Z5", invoiceNumber: "B-1", invoiceDate: "2026-11-09", totalGst: 50, grandTotal: 550 },
];
const rows = reconcile(portal, books);
const kinds = rows.map((r) => r.kind);
assert.deepEqual(kinds, ["matched", "mismatch", "portal_only", "portal_only", "books_only"]);
assert.equal((rows[1] as any).difference, -10);
assert.throws(() => parseGstr2b({ hello: 1 }));
console.log("gstr2b ok");
