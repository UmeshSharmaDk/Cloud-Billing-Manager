/** Run: node test/bank-match.test.ts */
import { matchStatement } from "../src/lib/bank-match.ts";

let fail = 0;
const check = (name: string, cond: boolean) => { console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}`); if (!cond) fail++; };

const invoices = [
  { id: 1, number: "INV-0007", party: "Asha", due: 1180 },
  { id: 2, number: "INV-0008", party: "Ravi", due: 500 },
  { id: 3, number: "INV-0009", party: "Mira", due: 500 },
];
const purchases = [{ id: 9, number: "B/77", party: "Steel Co", due: 2360 }];

const m = matchStatement([
  { date: "2026-11-01", description: "NEFT ASHA inv0007", amount: 300 },   // by number, even though amount differs
  { date: "2026-11-02", description: "UPI RAVI", amount: 500 },            // two invoices due 500: no guess
  { date: "2026-11-03", description: "IMPS", amount: 1180 },               // INV-0007 already used
  { date: "2026-11-04", description: "RTGS STEEL", amount: -2360 },        // debit by amount
  { date: "2026-11-05", description: "Bank charges", amount: -59 },
], invoices, purchases);

check("number in narration wins", m[0]?.id === 1 && m[0].by === "number");
check("ambiguous amount is not guessed", m[1] === null);
check("a document is suggested once", m[2] === null);
check("debit matches a bill by amount", m[3]?.kind === "purchase" && m[3].id === 9);
check("unmatched line stays null", m[4] === null);
if (fail) process.exit(1);
