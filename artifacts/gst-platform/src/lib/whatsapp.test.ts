/** Run: node src/lib/whatsapp.test.ts */
import assert from "node:assert/strict";
import { reminderLink, waNumber } from "./whatsapp.ts";

assert.equal(waNumber("098765 43210"), "919876543210");
assert.equal(waNumber("+91 98765-43210"), "919876543210");
assert.equal(waNumber("12345"), null);
const inv = { status: "unpaid", grandTotal: 1180, paidAmount: 180, customerName: "Asha", invoiceNumber: "INV-7", invoiceDate: "2026-11-01" };
const url = reminderLink(inv, "9876543210", { name: "Shop", upiId: "shop@okhdfcbank" }, (n) => `Rs ${n}`, (d) => d)!;
assert.ok(url.startsWith("https://wa.me/919876543210?text="));
assert.match(decodeURIComponent(url), /INV-7 dated 2026-11-01 has Rs 1000 due/);
assert.match(decodeURIComponent(url), /shop@okhdfcbank/);
assert.equal(reminderLink({ ...inv, paidAmount: 1180 }, "9876543210", {}, String, String), null);
console.log("whatsapp ok");
