/**
 * Files for the government portals, built from our own records:
 *
 * - `buildEinvoiceJson`: one invoice in the e-invoice schema (INV-01, v1.1),
 *   for the IRP's bulk upload. The IRP returns the IRN, acknowledgement and
 *   signed QR, which the user saves back on the invoice.
 * - `buildEwayBillJson`: one e-way bill in the portal's bulk-generation format.
 *
 * Neither talks to a government API. ponytail: direct IRN/EWB generation needs
 * a GSP account and its credentials; add a client here once one is chosen.
 *
 * Both return `{ problems }` instead of a file the portal would reject, so the
 * user is told what to fix in our app rather than reading a portal error.
 */
import { normaliseStateCode, stateCodeFromGstin } from "./gst";
import { uqc } from "./gstr1-json";

type Party = {
  name?: string | null; gstin?: string | null; address?: string | null; city?: string | null;
  pincode?: string | null; stateCode?: string | null; phone?: string | null; email?: string | null;
};

const p = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const r = (paise: number) => paise / 100;
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const GSTIN = /^[0-9]{2}[0-9A-Z]{13}$/;
const pin = (v: unknown) => (/^[1-9]\d{5}$/.test(String(v ?? "").trim()) ? Number(String(v).trim()) : null);
const stateOf = (party: Party) => normaliseStateCode(party.stateCode) ?? stateCodeFromGstin(party.gstin);
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export function einvoiceDocType(type: string): "INV" | "CRN" | "DBN" | null {
  if (/^\s*tax invoice/i.test(type)) return "INV";
  if (/^\s*credit note/i.test(type)) return "CRN";
  if (/^\s*debit note/i.test(type)) return "DBN";
  return null;
}

/** What is missing for a party (seller or buyer) to appear on a portal file. */
function partyProblems(who: string, party: Party, needGstin: boolean): string[] {
  const out: string[] = [];
  const gstin = String(party.gstin ?? "").trim().toUpperCase();
  if (needGstin && !GSTIN.test(gstin)) out.push(`${who} GSTIN is missing or not 15 characters.`);
  if (!clip(party.address, 100)) out.push(`${who} address is missing.`);
  if (clip(party.city, 50).length < 3) out.push(`${who} city is missing.`);
  if (pin(party.pincode) === null) out.push(`${who} PIN code must be 6 digits.`);
  if (!stateOf(party)) out.push(`${who} state is missing.`);
  return out;
}

export function buildEinvoiceJson(args: { seller: Party; buyer: Party; invoice: any }):
  { json: unknown[]; problems?: never } | { problems: string[]; json?: never } {
  const { seller, buyer, invoice } = args;
  const problems: string[] = [];
  const typ = einvoiceDocType(invoice.type ?? "Tax Invoice");
  if (!typ) problems.push(`A ${invoice.type} does not need an e-invoice. Only tax invoices, credit notes and debit notes do.`);
  if (invoice.status === "cancelled") problems.push("This invoice is cancelled.");
  if (!invoice.customerGstin) problems.push("E-invoices are for sales to GST-registered customers. Add the customer's GSTIN.");
  if (!/^[A-Z1-9][A-Z0-9/-]{0,15}$/i.test(invoice.invoiceNumber ?? "")) {
    problems.push("The invoice number must be at most 16 letters, digits, / or -, and not start with 0. Shorten the invoice prefix in Settings.");
  }
  problems.push(...partyProblems("Your business", seller, true));
  problems.push(...partyProblems("Customer", { ...buyer, gstin: invoice.customerGstin ?? buyer.gstin }, true));
  const lines: any[] = invoice.items ?? [];
  if (lines.length === 0) problems.push("The invoice has no items.");
  lines.forEach((l, n) => {
    if (!/^\d{4,8}$/.test(String(l.hsnCode ?? "").trim())) problems.push(`Item ${n + 1} needs an HSN or SAC code of 4 to 8 digits.`);
  });
  if (problems.length) return { problems };

  const ItemList = lines.map((l, n) => {
    const qty = Number(l.quantity ?? 1);
    const price = Number(l.unitPrice ?? l.rate ?? 0);
    const tot = Math.round(qty * price * 100);
    const ass = p(l.taxableAmount);
    const hsn = String(l.hsnCode).trim();
    return {
      SlNo: String(n + 1),
      PrdDesc: clip(l.description ?? l.productName, 300) || "Item",
      IsServc: hsn.startsWith("99") ? "Y" : "N",
      HsnCd: hsn,
      Qty: qty,
      Unit: uqc(l.unit),
      UnitPrice: Math.round(price * 1000) / 1000,
      TotAmt: r(tot),
      Discount: r(Math.max(0, tot - ass)),
      AssAmt: r(ass),
      GstRt: Number(l.gstRate ?? 0),
      IgstAmt: r(p(l.igst)),
      CgstAmt: r(p(l.cgst)),
      SgstAmt: r(p(l.sgst)),
      TotItemVal: r(ass + p(l.igst) + p(l.cgst) + p(l.sgst)),
    };
  });

  const sellerState = stateOf(seller)!;
  const pos = normaliseStateCode(invoice.placeOfSupply) ?? stateOf(buyer) ?? sellerState;
  const party = (x: Party, gstin: string) => ({
    Gstin: gstin.trim().toUpperCase(),
    LglNm: clip(x.name, 100),
    Addr1: clip(x.address, 100),
    Loc: clip(x.city, 50),
    Pin: pin(x.pincode)!,
    Stcd: stateOf({ ...x, gstin })!,
    ...(/^\d{6,12}$/.test(String(x.phone ?? "").replace(/\D/g, "")) ? { Ph: String(x.phone).replace(/\D/g, "").slice(-12) } : {}),
    ...(x.email && /^\S+@\S+\.\S+$/.test(x.email) ? { Em: clip(x.email, 100) } : {}),
  });

  return {
    json: [{
      Version: "1.1",
      TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
      DocDtls: { Typ: typ, No: invoice.invoiceNumber, Dt: ddmmyyyy(invoice.invoiceDate) },
      SellerDtls: party(seller, String(seller.gstin)),
      BuyerDtls: { ...party(buyer, String(invoice.customerGstin)), Pos: pos },
      ItemList,
      ValDtls: {
        AssVal: r(p(invoice.subtotal)),
        CgstVal: r(p(invoice.cgst)),
        SgstVal: r(p(invoice.sgst)),
        IgstVal: r(p(invoice.igst)),
        OthChrg: r(p(invoice.tcsAmount)),
        RndOffAmt: r(p(invoice.roundOff)),
        TotInvVal: r(p(invoice.grandTotal)),
      },
    }],
  };
}

/** Accepts what the IRP hands back after an upload. */
export const IRN_PATTERN = /^[0-9a-f]{64}$/i;

export function buildEwayBillJson(bill: any, invoice?: any):
  { json: unknown; problems?: never } | { problems: string[]; json?: never } {
  const problems: string[] = [];
  const from: Party = { name: bill.fromTrdName, gstin: bill.fromGstin, address: bill.fromAddr1, city: bill.fromCity, pincode: bill.fromPincode, stateCode: bill.fromState };
  const to: Party = { name: bill.toTrdName, gstin: bill.toGstin, address: bill.toAddr1, city: bill.toCity, pincode: bill.toPincode, stateCode: bill.toState };
  problems.push(...partyProblems("From", from, true));
  problems.push(...partyProblems("To", to, false));
  const toGstin = String(bill.toGstin ?? "").trim().toUpperCase();
  if (toGstin && !GSTIN.test(toGstin)) problems.push("To GSTIN is not 15 characters. Leave it empty for an unregistered party.");
  const distance = Math.round(Number(bill.transDistance ?? 0));
  if (!(distance > 0 && distance <= 4000)) problems.push("Distance must be between 1 and 4000 km.");
  const lines: any[] = (bill.items?.length ? bill.items : invoice?.items) ?? [];
  if (lines.length === 0) problems.push("The e-way bill has no items. Link it to an invoice.");
  lines.forEach((l, n) => {
    if (!/^\d{4,8}$/.test(String(l.hsnCode ?? "").trim())) problems.push(`Item ${n + 1} needs an HSN code of 4 to 8 digits.`);
  });
  if (problems.length) return { problems };

  const interstate = stateOf(from) !== stateOf(to);
  const itemList = lines.map((l, n) => {
    const rate = Number(l.gstRate ?? 0);
    return {
      itemNo: n + 1,
      productName: clip(l.description ?? l.productName, 100) || "Item",
      productDesc: clip(l.description ?? l.productName, 100) || "Item",
      hsnCode: Number(String(l.hsnCode).trim()),
      quantity: Number(l.quantity ?? 1),
      qtyUnit: uqc(l.unit),
      taxableAmount: r(p(l.taxableAmount ?? Number(l.quantity ?? 1) * Number(l.unitPrice ?? l.rate ?? 0))),
      sgstRate: interstate ? 0 : rate / 2,
      cgstRate: interstate ? 0 : rate / 2,
      igstRate: interstate ? rate : 0,
      cessRate: 0,
      cessNonAdvol: 0,
    };
  });
  const st = (x: Party) => Number(stateOf(x));
  const vehicle = String(bill.vehicleNo ?? "").replace(/[\s-]/g, "").toUpperCase();
  return {
    json: {
      version: "1.0.0621",
      billLists: [{
        userGstin: String(bill.fromGstin).trim().toUpperCase(),
        supplyType: bill.supplyType ?? "O",
        subSupplyType: Number(bill.subSupplyType ?? 1),
        subSupplyDesc: "",
        docType: bill.docType ?? "INV",
        docNo: bill.docNo,
        docDate: ddmmyyyy(bill.docDate),
        transType: 1,
        fromGstin: String(bill.fromGstin).trim().toUpperCase(),
        fromTrdName: clip(bill.fromTrdName, 100),
        fromAddr1: clip(bill.fromAddr1, 120),
        fromAddr2: "",
        fromPlace: clip(bill.fromCity, 50),
        fromPincode: pin(bill.fromPincode),
        fromStateCode: st(from),
        actualFromStateCode: st(from),
        toGstin: toGstin || "URP",
        toTrdName: clip(bill.toTrdName, 100),
        toAddr1: clip(bill.toAddr1, 120),
        toAddr2: "",
        toPlace: clip(bill.toCity, 50),
        toPincode: pin(bill.toPincode),
        toStateCode: st(to),
        actualToStateCode: st(to),
        totalValue: r(p(bill.totalValue)),
        cgstValue: r(p(bill.cgstValue)),
        sgstValue: r(p(bill.sgstValue)),
        igstValue: r(p(bill.igstValue)),
        cessValue: 0,
        cessNonAdvolValue: 0,
        OthValue: 0,
        totInvValue: r(p(bill.totalInvValue)),
        transMode: Number(bill.transMode ?? 1),
        transDistance: String(distance),
        transporterName: clip(bill.transporterName, 100),
        transporterId: clip(bill.transporterId, 15).toUpperCase(),
        transDocNo: clip(bill.transDocNo, 15),
        transDocDate: bill.transDocDate ? ddmmyyyy(bill.transDocDate) : "",
        vehicleNo: vehicle,
        vehicleType: bill.vehicleType ?? "R",
        mainHsnCode: itemList[0]!.hsnCode,
        itemList,
      }],
    },
  };
}
