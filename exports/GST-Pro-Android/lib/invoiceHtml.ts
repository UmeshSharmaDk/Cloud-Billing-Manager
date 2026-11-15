import { date, money } from "./format";
import type { Business, Customer, Invoice } from "./types";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A printable tax invoice for expo-print, laid out like the website's print view. */
export function invoiceHtml(inv: Invoice, biz: Business | undefined, cust: Customer | undefined) {
  const b = biz ?? ({} as Business);
  const addr = (...parts: unknown[]) => parts.filter(Boolean).map(esc).join(", ");
  const rows = (inv.items ?? []).map((it, i) => `
    <tr><td>${i + 1}</td><td>${esc(it.description)}</td><td>${esc(it.hsnCode)}</td>
    <td class="r">${esc(it.quantity)} ${esc(it.unit)}</td><td class="r">${money(it.unitPrice)}</td>
    <td class="r">${esc(it.discount ?? 0)}%</td><td class="r">${money(it.taxableAmount)}</td>
    <td class="r">${esc(it.gstRate)}%</td><td class="r">${money(it.totalAmount)}</td></tr>`).join("");
  const tax = inv.isInterstate
    ? `<tr><td>IGST</td><td class="r">${money(inv.igst)}</td></tr>`
    : `<tr><td>CGST</td><td class="r">${money(inv.cgst)}</td></tr><tr><td>SGST</td><td class="r">${money(inv.sgst)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:sans-serif;font-size:11px;color:#000;margin:24px}
    h1{font-size:18px;margin:0}h2{font-size:14px;text-align:center;margin:12px 0}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #444;padding:4px;vertical-align:top}
    th{background:#eee}.r{text-align:right}.grid{display:flex;gap:12px}.grid>div{flex:1;border:1px solid #444;padding:8px}
    .tot{width:45%;margin-left:auto;margin-top:8px}.muted{color:#555}
  </style></head><body>
    <h1>${esc(b.name)}</h1>
    <div>${addr(b.address, b.city, b.state, b.pincode)}</div>
    <div>GSTIN: ${esc(b.gstin)} ${b.stateCode ? `· State code ${esc(b.stateCode)}` : ""} ${b.phone ? `· ${esc(b.phone)}` : ""}</div>
    <h2>${esc(inv.type)}</h2>
    <div class="grid">
      <div><b>Bill to</b><br>${esc(inv.customerName)}<br>${addr(cust?.address, cust?.city, cust?.state, cust?.pincode)}
        ${inv.customerGstin ? `<br>GSTIN: ${esc(inv.customerGstin)}` : ""}${cust?.phone ? `<br>${esc(cust.phone)}` : ""}</div>
      <div>Invoice no: <b>${esc(inv.invoiceNumber)}</b><br>Date: ${date(inv.invoiceDate)}<br>Due: ${date(inv.dueDate)}
        ${inv.placeOfSupply ? `<br>Place of supply: ${esc(inv.placeOfSupply)}` : ""}</div>
    </div>
    <table style="margin-top:8px"><tr><th>#</th><th>Description</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Disc</th><th>Taxable</th><th>GST</th><th>Amount</th></tr>${rows}</table>
    <table class="tot">
      <tr><td>Taxable value</td><td class="r">${money(inv.subtotal)}</td></tr>${tax}
      ${Number((inv as any).tcsAmount) > 0 ? `<tr><td>TCS @ ${(inv as any).tcsRate}% (s.206C)</td><td class="r">${money((inv as any).tcsAmount)}</td></tr>` : ""}
      ${inv.roundOff ? `<tr><td>Round off</td><td class="r">${money(inv.roundOff)}</td></tr>` : ""}
      <tr><th>Grand total</th><th class="r">${money(inv.grandTotal)}</th></tr>
    </table>
    ${inv.notes ? `<p><b>Notes:</b> ${esc(inv.notes)}</p>` : ""}
    ${b.bankName ? `<p><b>Bank:</b> ${addr(b.bankName, b.bankAccount && `A/c ${b.bankAccount}`, b.bankIfsc && `IFSC ${b.bankIfsc}`, b.bankBranch)}</p>` : ""}
    ${inv.upi ? `<p style="display:flex;align-items:center;gap:12px"><img src="${esc(inv.upi.qr)}" width="110" height="110" alt="UPI QR"><span><b>Scan to pay ${money(inv.upi.amount)}</b><br><span class="muted">Any UPI app</span></span></p>` : ""}
    ${b.termsConditions ? `<p class="muted"><b>Terms:</b> ${esc(b.termsConditions)}</p>` : ""}
    <p class="r" style="margin-top:40px">For ${esc(b.name)}<br><br>Authorised signatory</p>
  </body></html>`;
}
