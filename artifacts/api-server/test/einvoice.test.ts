/** node test/einvoice.test.ts */
import { buildEinvoiceJson, buildEwayBillJson } from "../src/lib/einvoice.ts";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${cond || !detail ? "" : `  (${detail})`}`);
};

const seller = { name: "Sharma Traders", gstin: "27aaaaa0000a1z5", address: "12 MG Road", city: "Pune", pincode: "411001", stateCode: "27", phone: "+91 98765 43210" };
const buyer = { name: "Ravi Stores", gstin: "29BBBBB1111B1Z5", address: "4 Brigade Road", city: "Bengaluru", pincode: "560001", stateCode: "29" };
const invoice = {
  type: "Tax Invoice", status: "unpaid", invoiceNumber: "INV-2026-27-0007", invoiceDate: "2026-11-05",
  customerGstin: "29BBBBB1111B1Z5", placeOfSupply: "29", isInterstate: true,
  subtotal: 900, cgst: 0, sgst: 0, igst: 162, tcsAmount: 0, roundOff: 0, grandTotal: 1062,
  items: [{ description: "Laptop bag", hsnCode: "4202", quantity: 2, unit: "Nos", unitPrice: 500, discount: 10, gstRate: 18, taxableAmount: 900, cgst: 0, sgst: 0, igst: 162 }],
};

const ok = buildEinvoiceJson({ seller, buyer, invoice }) as any;
const e = ok.json?.[0];
check("builds one document in schema 1.1", e?.Version === "1.1" && ok.json.length === 1, JSON.stringify(ok.problems));
check("dates are DD/MM/YYYY and the type is INV", e?.DocDtls.Dt === "05/11/2026" && e.DocDtls.Typ === "INV");
check("GSTINs are upper case, PINs are numbers", e?.SellerDtls.Gstin === "27AAAAA0000A1Z5" && e.BuyerDtls.Pin === 560001);
check("buyer place of supply comes from the invoice", e?.BuyerDtls.Pos === "29");
const it = e?.ItemList[0];
check("discount is the gap between gross and taxable", it?.TotAmt === 1000 && it.Discount === 100 && it.AssAmt === 900, JSON.stringify(it));
check("item value is taxable plus tax", it?.TotItemVal === 1062 && it.IgstAmt === 162 && it.Unit === "NOS" && it.IsServc === "N");
check("totals match the invoice", e?.ValDtls.AssVal === 900 && e.ValDtls.IgstVal === 162 && e.ValDtls.TotInvVal === 1062);
check("seller phone is digits only", e?.SellerDtls.Ph === "919876543210");

const b2c = buildEinvoiceJson({ seller, buyer, invoice: { ...invoice, customerGstin: null } }) as any;
check("a sale to an unregistered customer is refused with a reason", b2c.problems?.some((p: string) => /GSTIN/.test(p)));
const noHsn = buildEinvoiceJson({ seller, buyer, invoice: { ...invoice, items: [{ ...invoice.items[0], hsnCode: "" }] } }) as any;
check("a line without HSN is named", noHsn.problems?.some((p: string) => /Item 1/.test(p)));
const bos = buildEinvoiceJson({ seller, buyer, invoice: { ...invoice, type: "Bill of Supply" } }) as any;
check("a bill of supply is not an e-invoice", Boolean(bos.problems?.length));
const longNo = buildEinvoiceJson({ seller, buyer, invoice: { ...invoice, invoiceNumber: "SHARMA-2026-27-0007" } }) as any;
check("an invoice number over 16 characters is refused", longNo.problems?.some((p: string) => /16/.test(p)));

const bill = {
  supplyType: "O", subSupplyType: "1", docType: "INV", docNo: "INV-2026-27-0007", docDate: "2026-11-05",
  fromGstin: seller.gstin, fromTrdName: seller.name, fromAddr1: seller.address, fromCity: seller.city, fromPincode: seller.pincode, fromState: "27",
  toGstin: "", toTrdName: "Walk-in", toAddr1: "4 Brigade Road", toCity: "Bengaluru", toPincode: "560001", toState: "29",
  transMode: "1", transDistance: "840.00", vehicleNo: "mh 12 ab 1234", vehicleType: "R",
  totalValue: 900, cgstValue: 0, sgstValue: 0, igstValue: 162, totalInvValue: 1062, items: invoice.items,
};
const w = (buildEwayBillJson(bill) as any).json?.billLists?.[0];
check("e-way bill: unregistered buyer is URP", w?.toGstin === "URP");
check("e-way bill: distance is a whole-number string, vehicle has no spaces", w?.transDistance === "840" && w.vehicleNo === "MH12AB1234");
check("e-way bill: inter-state item carries IGST rate", w?.itemList[0].igstRate === 18 && w.itemList[0].cgstRate === 0 && w.mainHsnCode === 4202);
check("e-way bill: state codes are numbers", w?.fromStateCode === 27 && w.toStateCode === 29);
const noDist = buildEwayBillJson({ ...bill, transDistance: null }) as any;
check("e-way bill without distance is refused", noDist.problems?.some((p: string) => /Distance/.test(p)));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
