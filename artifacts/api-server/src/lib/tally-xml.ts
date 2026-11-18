/**
 * Sales and purchase vouchers in the XML that TallyPrime imports
 * (Gateway of Tally > Import > Transactions), for CAs who finish books in Tally.
 *
 * Each voucher balances: party against sales or purchase, the GST heads, TCS,
 * and a round-off line for whatever is left. Ledger masters for every party
 * and head used are included first so the import does not stop on a missing
 * ledger; Tally skips the ones that already exist.
 *
 * Tally's sign convention: debits are negative, credits positive.
 * Pure and dependency-free so it runs under `node test/tally-xml.test.ts`.
 */

export interface TallyDoc {
  kind: "sale" | "purchase";
  type: string; // Tax Invoice, Credit Note, Debit Note, ...
  number: string;
  date: string; // YYYY-MM-DD
  party: string;
  partyGstin: string | null;
  subtotal: number | string;
  cgst: number | string; sgst: number | string; igst: number | string;
  tcs?: number | string;
  total: number | string;
}

export const TALLY_LEDGERS = {
  sale: { main: "Sales", cgst: "Output CGST", sgst: "Output SGST", igst: "Output IGST" },
  purchase: { main: "Purchase", cgst: "Input CGST", sgst: "Input SGST", igst: "Input IGST" },
  tcs: "TCS Payable",
  roundOff: "Round Off",
} as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const paise = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const amt = (p: number) => (p / 100).toFixed(2);

function voucherType(d: TallyDoc): string {
  if (/^\s*credit note/i.test(d.type)) return "Credit Note";
  if (/^\s*debit note/i.test(d.type)) return "Debit Note";
  return d.kind === "sale" ? "Sales" : "Purchase";
}

function entry(ledger: string, p: number): string {
  // Negative = debit. ISDEEMEDPOSITIVE is Yes for debits.
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${p < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${amt(p)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
}

/** Ledger lines for one voucher, as [ledger, paise] with debits negative. Sums to zero. */
export function voucherLines(d: TallyDoc): Array<[string, number]> {
  const heads = TALLY_LEDGERS[d.kind];
  // A sale credits income and debits the party; a purchase the other way.
  // A credit note on a sale (or a debit note on a purchase) reverses it.
  const reversed = d.kind === "sale" ? /^\s*credit note/i.test(d.type) : /^\s*debit note/i.test(d.type);
  const s = (d.kind === "sale" ? 1 : -1) * (reversed ? -1 : 1);
  const lines: Array<[string, number]> = [];
  const add = (ledger: string, p: number) => { if (p) lines.push([ledger, s * p]); };
  add(heads.main, paise(d.subtotal));
  add(heads.cgst, paise(d.cgst));
  add(heads.sgst, paise(d.sgst));
  add(heads.igst, paise(d.igst));
  add(TALLY_LEDGERS.tcs, paise(d.tcs));
  const total = paise(d.total);
  const counted = lines.reduce((n, [, p]) => n + s * p, 0);
  add(TALLY_LEDGERS.roundOff, total - counted);
  lines.unshift([d.party, -s * total]);
  return lines;
}

export function buildTallyXml(docs: TallyDoc[], company?: string): string {
  const masters = new Map<string, string>(); // ledger -> parent group
  for (const d of docs) masters.set(d.party, d.kind === "sale" ? "Sundry Debtors" : "Sundry Creditors");
  const used = new Set(docs.flatMap((d) => voucherLines(d).map(([l]) => l)));
  const groups: Record<string, string> = {
    Sales: "Sales Accounts", Purchase: "Purchase Accounts", [TALLY_LEDGERS.roundOff]: "Indirect Expenses",
  };
  for (const l of used) if (!masters.has(l)) masters.set(l, groups[l] ?? "Duties & Taxes");

  const gstinOf = new Map(docs.filter((d) => d.partyGstin).map((d) => [d.party, d.partyGstin!.toUpperCase()]));
  const ledgerXml = [...masters.entries()].map(([name, parent]) =>
    `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><PARENT>${esc(parent)}</PARENT>` +
    (gstinOf.has(name) ? `<PARTYGSTIN>${esc(gstinOf.get(name)!)}</PARTYGSTIN>` : "") +
    `</LEDGER></TALLYMESSAGE>`).join("\n");

  const voucherXml = docs.map((d) => {
    const vt = voucherType(d);
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${vt}" ACTION="Create">` +
      `<DATE>${d.date.replace(/-/g, "")}</DATE><VOUCHERTYPENAME>${vt}</VOUCHERTYPENAME>` +
      `<VOUCHERNUMBER>${esc(d.number)}</VOUCHERNUMBER><PARTYLEDGERNAME>${esc(d.party)}</PARTYLEDGERNAME>` +
      `<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>` +
      voucherLines(d).map(([l, p]) => entry(l, p)).join("") +
      `</VOUCHER></TALLYMESSAGE>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>
<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : ""}</REQUESTDESC>
<REQUESTDATA>
${ledgerXml}
${voucherXml}
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>
`;
}
