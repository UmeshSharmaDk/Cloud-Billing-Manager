/** node test/tally-xml.test.ts */
import { buildTallyXml, voucherLines } from "../src/lib/tally-xml.ts";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${cond || !detail ? "" : `  (${detail})`}`);
};
const sale = { kind: "sale" as const, type: "Tax Invoice", number: "INV-1", date: "2026-11-05", party: "Acme & Sons", partyGstin: "29bbbbb1111b1z5",
  subtotal: 1000.4, cgst: 90.04, sgst: 90.04, igst: 0, tcs: 0, total: 1180 };
const balance = (l: Array<[string, number]>) => l.reduce((n, [, p]) => n + p, 0);

const s = voucherLines(sale);
check("a sale debits the party for the total", s[0][0] === "Acme & Sons" && s[0][1] === -118000);
check("and credits sales and output GST", s.some(([l, p]) => l === "Sales" && p === 100040) && s.some(([l, p]) => l === "Output CGST" && p === 9004));
check("a round-off line makes it balance", balance(s) === 0 && s.some(([l, p]) => l === "Round Off" && p === -48), JSON.stringify(s));

const cn = voucherLines({ ...sale, type: "Credit Note", number: "CN-1", subtotal: 100, cgst: 9, sgst: 9, total: 118 });
check("a credit note on a sale reverses it", cn[0][1] === 11800 && cn.some(([l, p]) => l === "Sales" && p === -10000) && balance(cn) === 0);

const pur = voucherLines({ kind: "purchase", type: "Tax Invoice", number: "B-9", date: "2026-11-06", party: "Steel Co", partyGstin: null,
  subtotal: 2500, cgst: 0, sgst: 0, igst: 450, total: 2950 });
check("a purchase credits the party and debits purchase and input GST",
  pur[0][1] === 295000 && pur.some(([l, p]) => l === "Purchase" && p === -250000) && pur.some(([l, p]) => l === "Input IGST" && p === -45000) && balance(pur) === 0);

const xml = buildTallyXml([sale, { ...sale, kind: "purchase", party: "Steel Co", number: "B-9" }], "My Co");
check("party names are escaped", xml.includes("Acme &amp; Sons") && !xml.includes("Acme & Sons"));
check("ledger masters come with their groups and GSTIN", xml.includes('<LEDGER NAME="Acme &amp; Sons" ACTION="Create"><NAME>Acme &amp; Sons</NAME><PARENT>Sundry Debtors</PARENT><PARTYGSTIN>29BBBBB1111B1Z5</PARTYGSTIN>') && xml.includes("<PARENT>Duties &amp; Taxes</PARENT>"));
check("vouchers carry Tally's date format and type", xml.includes("<DATE>20261105</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>") && xml.includes('VCHTYPE="Purchase"'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
