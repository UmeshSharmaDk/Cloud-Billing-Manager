/** Run: node src/lib/bank-statement.test.ts */
import { parseStatementText, parseBankDate } from "./bank-statement.ts";
import assert from "node:assert/strict";

assert.equal(parseBankDate("05/11/2026"), "2026-11-05");
assert.equal(parseBankDate("5-Nov-26"), "2026-11-05");
assert.equal(parseBankDate("05 Nov 2026 UPI"), "2026-11-05");
assert.equal(parseBankDate("Opening"), null);

// Excel export, as the sheet reader flattens it (tab separated).
const sheet = [
  "Account statement",
  "Date\tNarration\tChq./Ref.No.\tWithdrawal Amt.\tDeposit Amt.\tClosing Balance",
  "01/11/26\tNEFT ASHA INV-0007\tN123\t\t1,180.00\t11,180.00",
  "02/11/26\tRTGS STEEL CO\tR9\t2,360.00\t\t8,820.00",
].join("\n");
assert.deepEqual(parseStatementText(sheet), [
  { date: "2026-11-01", description: "NEFT ASHA INV-0007", amount: 1180, reference: "N123" },
  { date: "2026-11-02", description: "RTGS STEEL CO", amount: -2360, reference: "R9" },
]);

// PDF text: direction comes from the balance.
const pdf = [
  "Opening Balance 10,000.00",
  "01-11-2026 UPI/ASHA/INV-0007 1,180.00 11,180.00",
  "02-11-2026 RTGS STEEL CO 2,360.00 8,820.00",
].join("\n");
const rows = parseStatementText(pdf);
assert.equal(rows.length, 2);
assert.equal(rows[0].amount, 1180);
assert.equal(rows[1].amount, -2360);
assert.equal(rows[0].description, "UPI/ASHA/INV-0007");
console.log("bank-statement ok");
