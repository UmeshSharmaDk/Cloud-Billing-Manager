/**
 * Match the GSTR-2B file downloaded from the GST portal against the purchase
 * bills in the books. Runs on the device: the file is not uploaded. A copy of the website's lib/gstr2b.ts.
 */

export interface BookBill { id: number; vendorName: string; vendorGstin?: string | null; invoiceNumber: string; invoiceDate: string; totalGst: number; grandTotal: number }
export interface PortalBill { gstin: string; supplier: string; number: string; date: string; tax: number; value: number }
export type Row =
  | { kind: "matched"; portal: PortalBill; book: BookBill }
  | { kind: "mismatch"; portal: PortalBill; book: BookBill; difference: number }
  | { kind: "portal_only"; portal: PortalBill }
  | { kind: "books_only"; book: BookBill };

const num = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
const key = (gstin: string, n: string) => `${gstin.trim().toUpperCase()}|${num(n)}`;

/** The B2B invoices (and supplier credit notes, as negatives) in a GSTR-2B JSON file. */
export function parseGstr2b(json: any): PortalBill[] {
  const doc = json?.data?.docdata ?? json?.docdata ?? json;
  if (!doc || (!doc.b2b && !doc.cdnr)) throw new Error("This does not look like a GSTR-2B file from the GST portal.");
  const tax = (d: any) => Number(d.igst ?? 0) + Number(d.cgst ?? 0) + Number(d.sgst ?? 0) + Number(d.cess ?? 0);
  const out: PortalBill[] = [];
  for (const s of doc.b2b ?? []) for (const i of s.inv ?? []) {
    out.push({ gstin: s.ctin, supplier: s.trdnm ?? s.ctin, number: i.inum, date: i.dt, tax: tax(i), value: Number(i.val ?? 0) });
  }
  for (const s of doc.cdnr ?? []) for (const n of s.nt ?? []) {
    const sign = n.typ === "D" ? 1 : -1;
    out.push({ gstin: s.ctin, supplier: s.trdnm ?? s.ctin, number: n.ntnum, date: n.dt, tax: sign * tax(n), value: sign * Number(n.val ?? 0) });
  }
  return out;
}

/** Pair each portal bill with a book bill by supplier GSTIN and bill number; tax within ₹1 counts as matched. */
export function reconcile(portal: PortalBill[], books: BookBill[]): Row[] {
  const byKey = new Map<string, BookBill>();
  for (const b of books) if (b.vendorGstin) byKey.set(key(b.vendorGstin, b.invoiceNumber), b);
  const used = new Set<number>();
  const rows: Row[] = portal.map((p) => {
    const book = byKey.get(key(p.gstin, p.number));
    if (!book) return { kind: "portal_only", portal: p };
    used.add(book.id);
    const difference = Math.round((p.tax - Number(book.totalGst)) * 100) / 100;
    return Math.abs(difference) <= 1 ? { kind: "matched", portal: p, book } : { kind: "mismatch", portal: p, book, difference };
  });
  for (const b of books) if (!used.has(b.id)) rows.push({ kind: "books_only", book: b });
  return rows;
}
