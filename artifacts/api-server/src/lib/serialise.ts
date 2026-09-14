/**
 * Response shaping shared across routers.
 *
 * `mapUser` existed in two files and `mapInvoice`/`mapPurchase` in two each.
 * Duplication is how a fix lands in one copy and misses the other — exactly
 * how F-05 ended up correct in forty query sites and wrong in four.
 */

import type { User } from "@workspace/db";
import { Decimal, dec, toJson } from "./money";

/**
 * The public view of a user. Everything not listed here — `passwordHash`,
 * `tokenVersion`, `deletedAt` — stays server-side, so adding a sensitive
 * column to the table cannot leak it through an existing endpoint.
 */
export function mapUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    subscriptionStatus: user.subscriptionStatus,
    subscriptionEnd: user.subscriptionEnd,
    businessId: user.businessId,
    createdAt: user.createdAt,
  };
}


/**
 * The public view of an invoice.
 *
 * `balanceDue` is part of it. The reports copy of this function omitted it, so
 * the same invoice had a different shape depending on whether it arrived from
 * `/api/invoices` or `/api/reports/sales` — which is why the invoice detail page
 * carries a `inv.balanceDue ?? Math.max(0, ...)` fallback. One shape, one place.
 */
export function mapInvoice(inv: any) {
  const grandTotal = dec(inv.grandTotal);
  const paidAmount = dec(inv.paidAmount);
  const balanceDue = grandTotal.minus(paidAmount);
  return {
    ...inv,
    subtotal: toJson(inv.subtotal),
    cgst: toJson(inv.cgst),
    sgst: toJson(inv.sgst),
    igst: toJson(inv.igst),
    totalGst: toJson(inv.totalGst),
    grandTotal: toJson(grandTotal),
    roundOff: toJson(inv.roundOff),
    paidAmount: toJson(paidAmount),
    balanceDue: toJson(balanceDue.isNegative() ? new Decimal(0) : balanceDue),
    items: Array.isArray(inv.items) ? inv.items : [],
  };
}

/**
 * The public view of a purchase.
 *
 * Bills are exposed under both namings: `billNumber`/`billDate` is what the
 * frontend uses, `invoiceNumber`/`invoiceDate` is what the column is called.
 */
export function mapPurchase(p: any) {
  return {
    ...p,
    billNumber: p.invoiceNumber,
    billDate: p.invoiceDate,
    subtotal: toJson(p.subtotal),
    cgst: toJson(p.cgst),
    sgst: toJson(p.sgst),
    igst: toJson(p.igst),
    totalGst: toJson(p.totalGst),
    grandTotal: toJson(p.grandTotal),
    status: p.status ?? "unpaid",
    paymentStatus: p.status ?? "unpaid",
    items: Array.isArray(p.items) ? p.items : [],
  };
}

/** The public view of a catalog product. */
export function mapProduct(p: any) {
  return {
    ...p,
    purchasePrice: p.purchasePrice ? toJson(p.purchasePrice) : null,
    sellingPrice: p.sellingPrice ? toJson(p.sellingPrice) : null,
    gstRate: Number(dec(p.gstRate).toFixed(2)),
    stockQuantity: Number(dec(p.stockQuantity).toFixed(3)),
    lowStockThreshold: p.lowStockThreshold ? Number(dec(p.lowStockThreshold).toFixed(3)) : null,
  };
}
