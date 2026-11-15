/**
 * Frozen books and the transaction audit trail, for the routes that change
 * invoices, purchases, payments and e-way bills.
 *
 * `books(kind)` goes after `requireBusiness` and the body validator:
 *   - it refuses a change to anything dated on or before the business's lock
 *     date (the date sent, and for an existing record the date it has now);
 *   - on a 2xx answer it records who changed what, before the transaction
 *     commits, so the record and the change land together.
 */
import type { NextFunction, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, businessesTable, invoicesTable, purchasesTable, paymentsTable, ewayBillsTable } from "@workspace/db";
import { recordAudit, actorFrom, type BookKind } from "../lib/audit";

const TABLES = {
  invoice: { table: invoicesTable, date: invoicesTable.invoiceDate, body: ["invoiceDate"] },
  purchase: { table: purchasesTable, date: purchasesTable.invoiceDate, body: ["invoiceDate", "billDate"] },
  payment: { table: paymentsTable, date: paymentsTable.date, body: ["date"] },
  eway_bill: { table: ewayBillsTable, date: ewayBillsTable.docDate, body: ["docDate"] },
} as const;

// Recording a payment on an old invoice is normal; cancelling or editing it is not.
const PAYMENT_KEYS = new Set(["status", "paymentStatus", "paidAmount", "mode", "referenceNumber"]);
const isPaymentOnly = (body: Record<string, unknown>) =>
  Object.keys(body).every((k) => PAYMENT_KEYS.has(k)) &&
  body.status !== "cancelled" && body.paymentStatus !== "cancelled";

export const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function books(kind: BookKind) {
  const spec = TABLES[kind];
  return async (req: any, res: Response, next: NextFunction) => {
    const businessId: number = req.businessId;
    const id: number | undefined = req.validatedParams?.id;
    const body: Record<string, unknown> = req.body ?? {};

    const [biz] = await db.select({ lockDate: businessesTable.lockDate }).from(businessesTable)
      .where(eq(businessesTable.id, businessId)).limit(1);
    const lock = biz?.lockDate;
    if (lock && !((kind === "invoice" || kind === "purchase") && req.method === "PATCH" && isPaymentOnly(body))) {
      const dates = spec.body.map((k) => body[k]).filter((d): d is string => typeof d === "string");
      if (id) {
        const [row] = await db.select({ d: spec.date }).from(spec.table as any)
          .where(and(eq((spec.table as any).id, id), eq((spec.table as any).businessId, businessId))).limit(1);
        if (row?.d) dates.push(row.d);
      }
      if (dates.some((d) => d <= lock)) {
        return res.status(409).json({
          error: `Books are frozen up to ${fmtDay(lock)}. Records dated on or before then can't be changed. Ask your administrator.`,
          code: "books_frozen", lockDate: lock,
        });
      }
    }

    const send = res.json.bind(res);
    res.json = ((payload: any) => {
      if (res.statusCode >= 300) return send(payload);
      const doc = payload?.[kind === "eway_bill" ? "bill" : kind] ?? payload ?? {};
      const action = req.method === "POST" ? "created" : req.method === "DELETE" ? "deleted"
        : req.path.endsWith("/status") ? "status_changed" : "updated";
      void recordAudit({
        ...actorFrom(req), businessId, action: `${kind}.${action}`, targetType: kind,
        targetId: id ?? (typeof doc.id === "number" ? doc.id : null),
        details: {
          number: doc.invoiceNumber ?? doc.docNo ?? undefined,
          date: doc.invoiceDate ?? doc.date ?? doc.docDate ?? undefined,
          total: doc.grandTotal ?? doc.amount ?? undefined,
          status: doc.status ?? undefined,
        },
      }).finally(() => send(payload));
      return res;
    }) as any;
    return next();
  };
}
