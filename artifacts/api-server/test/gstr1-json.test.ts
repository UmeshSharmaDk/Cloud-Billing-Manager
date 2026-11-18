/** node test/gstr1-json.test.ts */
import { buildGstr1Json } from "../src/lib/gstr1-json.ts";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${cond || !detail ? "" : `  (${detail})`}`);
};
const line = (rate: number, taxable: number, intra = true, extra: Record<string, unknown> = {}) => ({
  gstRate: rate, taxableAmount: taxable, hsnCode: "8471", unit: "Nos", quantity: 1, description: "Laptop",
  ...(intra ? { cgst: taxable * rate / 200, sgst: taxable * rate / 200, igst: 0 } : { cgst: 0, sgst: 0, igst: taxable * rate / 100 }),
  ...extra,
});
const inv = (o: Record<string, unknown>) => ({ type: "Tax Invoice", customerGstin: null, placeOfSupply: "27", isInterstate: false, invoiceDate: "2026-11-05", ...o }) as any;

const { json } = buildGstr1Json({
  gstin: "27aaaaa0000a1z5", homeState: "27", month: 11, year: 2026,
  invoices: [
    inv({ invoiceNumber: "INV-1", customerGstin: "29BBBBB1111B1Z5", placeOfSupply: "29", isInterstate: true, grandTotal: 1180, items: [line(18, 1000, false)] }),
    inv({ invoiceNumber: "INV-2", customerGstin: "29BBBBB1111B1Z5", placeOfSupply: "29", isInterstate: true, grandTotal: 1236, items: [line(18, 500, false), line(12, 600, false)] }),
    inv({ invoiceNumber: "INV-3", placeOfSupply: "29", isInterstate: true, grandTotal: 236000, items: [line(18, 200000, false)] }),
    inv({ invoiceNumber: "INV-4", grandTotal: 590, items: [line(18, 500)] }),
    inv({ invoiceNumber: "INV-5", grandTotal: 1180, items: [line(18, 1000)] }),
    inv({ invoiceNumber: "CN-1", type: "Credit Note", customerGstin: "29BBBBB1111B1Z5", placeOfSupply: "29", isInterstate: true, grandTotal: 118, items: [line(18, 100, false)] }),
    inv({ invoiceNumber: "CN-2", type: "Credit Note", grandTotal: 118, items: [line(18, 100)] }),
  ],
});
const j = json as any;
check("header carries the GSTIN in capitals and the period as MMYYYY", j.gstin === "27AAAAA0000A1Z5" && j.fp === "112026");
check("registered buyers go to B2B, grouped by GSTIN", j.b2b?.length === 1 && j.b2b[0].inv.length === 2);
check("dates are DD-MM-YYYY", j.b2b[0].inv[0].idt === "05-11-2026");
check("an invoice's items are grouped by rate", j.b2b[0].inv[1].itms.length === 2 && j.b2b[0].inv[1].itms[0].itm_det.rt === 12);
check("inter-state tax is IGST", j.b2b[0].inv[0].itms[0].itm_det.iamt === 180 && j.b2b[0].inv[0].itms[0].itm_det.camt === 0);
check("a large inter-state sale to an unregistered buyer goes to B2CL", j.b2cl?.[0]?.pos === "29" && j.b2cl[0].inv[0].inum === "INV-3");
const cs = j.b2cs?.find((b: any) => b.pos === "27" && b.rt === 18);
check("small unregistered sales are summed into B2CS, less unregistered credit notes", cs?.txval === 1400 && cs.camt === 126 && cs.sply_ty === "INTRA", JSON.stringify(cs));
check("a credit note to a registered buyer goes to CDNR as type C", j.cdnr?.[0]?.nt?.[0]?.ntty === "C" && j.cdnr[0].nt[0].nt_num === "CN-1");
const h = j.hsn.data.find((d: any) => d.hsn_sc === "8471" && d.rt === 18);
check("HSN summary nets credit notes and maps the unit", h?.txval === 1000 + 500 + 200000 + 500 + 1000 - 100 - 100 && h.uqc === "NOS", JSON.stringify(h));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
