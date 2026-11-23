/**
 * GSTR-1 in the JSON format the GST portal's "Prepare offline" upload and the
 * offline tool accept, so a month's return is uploaded rather than retyped.
 *
 * Sections built: B2B, B2CL, B2CS, CDNR (credit and debit notes to registered
 * buyers) and HSN. Rules:
 *   - a buyer with a GSTIN goes to B2B (notes to CDNR);
 *   - an inter-state sale to an unregistered buyer above ₹1,00,000 goes to
 *     B2CL, every other unregistered sale is summed into B2CS by state and rate;
 *   - notes to unregistered buyers are netted into B2CS.
 * ponytail: CDNUR, exempt/nil (Bill of Supply), exports and advances are not
 * built; they are rare for our users. Add a section when someone needs it.
 *
 * Pure and dependency-free so it runs under `node test/gstr1-json.test.ts`.
 * Amounts are summed in paise to stay exact.
 */

export interface Gstr1Line {
  gstRate?: number | string; taxableAmount?: number | string;
  cgst?: number | string; sgst?: number | string; igst?: number | string;
  hsnCode?: string; description?: string; productName?: string; unit?: string; quantity?: number | string;
}
export interface Gstr1Invoice {
  invoiceNumber: string; invoiceDate: string; type: string;
  customerGstin: string | null; placeOfSupply: string | null; isInterstate: boolean;
  grandTotal: number | string; items: Gstr1Line[];
}

export const B2CL_THRESHOLD = 100000;

const p = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const r = (paise: number) => paise / 100;
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const isNote = (type: string) => /^\s*(credit|debit) note/i.test(type);
const isCredit = (type: string) => /^\s*credit note/i.test(type);
const pos = (inv: Gstr1Invoice, home: string) => (inv.placeOfSupply ?? "").padStart(2, "0").slice(-2) || home;

/** UQC codes the portal accepts, from the units our users type. */
const UQC: Record<string, string> = {
  nos: "NOS", no: "NOS", pcs: "PCS", pc: "PCS", piece: "PCS", pieces: "PCS", kg: "KGS", kgs: "KGS", g: "GMS", gm: "GMS", gms: "GMS",
  l: "LTR", ltr: "LTR", litre: "LTR", ml: "MLT", m: "MTR", mtr: "MTR", box: "BOX", set: "SET", sets: "SET", pair: "PRS", dozen: "DOZ", doz: "DOZ",
  bag: "BAG", bags: "BAG", bottle: "BTL", btl: "BTL", unit: "UNT", units: "UNT", hour: "OTH", hrs: "OTH", service: "OTH",
};
export const uqc = (unit?: string) => UQC[String(unit ?? "").trim().toLowerCase()] ?? "OTH";

/** Item rows grouped by rate, as the portal wants them on an invoice. */
function itemsByRate(lines: Gstr1Line[]) {
  const by = new Map<number, { tx: number; i: number; c: number; s: number }>();
  for (const l of lines) {
    const rt = Number(l.gstRate ?? 0);
    const b = by.get(rt) ?? { tx: 0, i: 0, c: 0, s: 0 };
    b.tx += p(l.taxableAmount); b.i += p(l.igst); b.c += p(l.cgst); b.s += p(l.sgst);
    by.set(rt, b);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([rt, b], n) => ({
    num: n + 1,
    itm_det: { txval: r(b.tx), rt, iamt: r(b.i), camt: r(b.c), samt: r(b.s), csamt: 0 },
  }));
}

export function buildGstr1Json(args: { gstin: string; homeState: string; month: number; year: number; invoices: Gstr1Invoice[] }) {
  const { gstin, homeState, month, year, invoices } = args;
  const b2b = new Map<string, unknown[]>();
  const cdnr = new Map<string, unknown[]>();
  const b2cl = new Map<string, unknown[]>();
  const b2cs = new Map<string, { sply_ty: string; pos: string; typ: string; rt: number; tx: number; i: number; c: number; s: number }>();
  const hsn = new Map<string, { desc: string; uqc: string; rt: number; qty: number; tx: number; i: number; c: number; s: number }>();
  let gt = 0;

  for (const inv of invoices) {
    const sign = isCredit(inv.type) ? -1 : 1;
    const place = pos(inv, homeState);
    const registered = !!inv.customerGstin?.trim();
    const value = r(p(inv.grandTotal));
    gt += sign * p(inv.grandTotal);

    for (const l of inv.items) {
      const key = `${String(l.hsnCode || "").trim() || "NA"}|${Number(l.gstRate ?? 0)}`;
      const h = hsn.get(key) ?? { desc: String(l.description ?? l.productName ?? "").slice(0, 30), uqc: uqc(l.unit), rt: Number(l.gstRate ?? 0), qty: 0, tx: 0, i: 0, c: 0, s: 0 };
      h.qty += sign * Number(l.quantity ?? 0);
      h.tx += sign * p(l.taxableAmount); h.i += sign * p(l.igst); h.c += sign * p(l.cgst); h.s += sign * p(l.sgst);
      hsn.set(key, h);
    }

    if (registered) {
      const ctin = inv.customerGstin!.trim().toUpperCase();
      if (isNote(inv.type)) {
        const list = cdnr.get(ctin) ?? [];
        list.push({ ntty: sign === -1 ? "C" : "D", nt_num: inv.invoiceNumber, nt_dt: ddmmyyyy(inv.invoiceDate), val: value, pos: place, rchrg: "N", inv_typ: "R", itms: itemsByRate(inv.items) });
        cdnr.set(ctin, list);
      } else {
        const list = b2b.get(ctin) ?? [];
        list.push({ inum: inv.invoiceNumber, idt: ddmmyyyy(inv.invoiceDate), val: value, pos: place, rchrg: "N", inv_typ: "R", itms: itemsByRate(inv.items) });
        b2b.set(ctin, list);
      }
    } else if (inv.isInterstate && !isNote(inv.type) && Number(inv.grandTotal) > B2CL_THRESHOLD) {
      const list = b2cl.get(place) ?? [];
      list.push({ inum: inv.invoiceNumber, idt: ddmmyyyy(inv.invoiceDate), val: value, itms: itemsByRate(inv.items) });
      b2cl.set(place, list);
    } else {
      for (const l of inv.items) {
        const rt = Number(l.gstRate ?? 0);
        const sply = inv.isInterstate ? "INTER" : "INTRA";
        const key = `${sply}|${place}|${rt}`;
        const b = b2cs.get(key) ?? { sply_ty: sply, pos: place, typ: "OE", rt, tx: 0, i: 0, c: 0, s: 0 };
        b.tx += sign * p(l.taxableAmount); b.i += sign * p(l.igst); b.c += sign * p(l.cgst); b.s += sign * p(l.sgst);
        b2cs.set(key, b);
      }
    }
  }

  const out: Record<string, unknown> = {
    gstin: gstin.toUpperCase(),
    fp: `${String(month).padStart(2, "0")}${year}`,
    version: "GST3.1.6",
    hash: "hash",
  };
  if (b2b.size) out.b2b = [...b2b.entries()].map(([ctin, inv]) => ({ ctin, inv }));
  if (b2cl.size) out.b2cl = [...b2cl.entries()].map(([pos, inv]) => ({ pos, inv }));
  if (b2cs.size) out.b2cs = [...b2cs.values()].map((b) => ({
    sply_ty: b.sply_ty, rt: b.rt, typ: b.typ, pos: b.pos, txval: r(b.tx), iamt: r(b.i), camt: r(b.c), samt: r(b.s), csamt: 0,
  }));
  if (cdnr.size) out.cdnr = [...cdnr.entries()].map(([ctin, nt]) => ({ ctin, nt }));
  if (hsn.size) out.hsn = {
    data: [...hsn.entries()].map(([key, h], n) => ({
      num: n + 1, hsn_sc: key.split("|")[0], desc: h.desc, uqc: h.uqc, qty: Math.round(h.qty * 1000) / 1000,
      rt: h.rt, txval: r(h.tx), iamt: r(h.i), camt: r(h.c), samt: r(h.s), csamt: 0,
    })),
  };
  return { json: out, grossTurnover: r(gt) };
}
