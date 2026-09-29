import { Router } from "express";
import { db, paymentsTable, invoicesTable, customersTable, vendorsTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { dec, toColumn, toJson } from "../lib/money";
import { settleInvoice } from "../lib/invoice-payments";
import { validateBody, validateQuery } from "../middleware/validate";
import { ListPaymentsQuery, CreatePaymentBody } from "../schemas";
import type { TenantRequest, IdParams } from "../lib/http";
import { resolveTenantRefs } from "../lib/tenant-refs";

const router = Router();

/**
 * Handlers in this router run after `requireAuth` and `requireBusiness`, so
 * the caller's tenant is resolved and the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `businessId` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = TenantRequest<any, any, IdParams>;


function mapPayment(p: any) {
  return { ...p, amount: toJson(p.amount) };
}

router.get("/", requireAuth, requireBusiness, validateQuery(ListPaymentsQuery), async (req: Req, res) => {
  const businessId = req.businessId;
  const { type, page, limit } = req.validatedQuery;
  const conditions: any[] = [eq(paymentsTable.businessId, businessId)];
  if (type) conditions.push(eq(paymentsTable.type, type));
  const payments = await db.select().from(paymentsTable).where(and(...conditions))
    .limit(limit).offset((page - 1) * limit)
    .orderBy(desc(paymentsTable.createdAt));
  const [{ count: total }] = await db.select({ count: count() }).from(paymentsTable).where(and(...conditions));
  return res.json({ payments: payments.map(mapPayment), total: Number(total) });
});

router.post("/", requireAuth, requireBusiness, validateBody(CreatePaymentBody), async (req: Req, res) => {
  const businessId = req.businessId;
  const { type, amount, date, mode, referenceNumber, invoiceId, customerId, vendorId, notes } = req.body;

  // Each of these named a row by id and was stored unchecked, so a payment
  // could point at another tenant's invoice, customer or vendor. Zod proves
  // they are positive integers; only a scoped lookup proves they are ours.
  const refs = await resolveTenantRefs(businessId, {
    invoiceId: { table: invoicesTable, value: invoiceId, label: "invoice" },
    customerId: { table: customersTable, value: customerId, label: "customer" },
    vendorId: { table: vendorsTable, value: vendorId, label: "vendor" },
  });
  if (!refs.ok) return res.status(400).json({ error: refs.error });

  const resolvedInvoiceId: number | null = refs.ids["invoiceId"] ?? null;

  // A payment that names an invoice is a receipt against it, so it has to move
  // the invoice's own figures — it used to be stored beside the invoice and
  // change nothing, leaving a receipt and a balance due that disagreed. It goes
  // through the same path as marking an invoice paid: one locked transaction,
  // refused if it would take the invoice past its total or the invoice is
  // cancelled. Money going out cannot be a receipt against a sales invoice.
  if (resolvedInvoiceId !== null) {
    if (type !== "received" && type !== "in") {
      return res.status(400).json({ error: "Only a received payment can be recorded against an invoice." });
    }
    const result = await db.transaction((tx) => settleInvoice(
      tx, businessId, resolvedInvoiceId,
      (invoice) => ({ target: dec(invoice.paidAmount).plus(dec(amount)) }),
      {
        type, date, mode, referenceNumber, notes,
        customerId: refs.ids["customerId"] ?? undefined,
        vendorId: refs.ids["vendorId"] ?? undefined,
      },
    ));
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(mapPayment(result.payment));
  }

  const [payment] = await db.insert(paymentsTable).values({
    businessId, type, amount: toColumn(amount), date, mode,
    referenceNumber, notes,
    invoiceId: null, customerId: refs.ids["customerId"], vendorId: refs.ids["vendorId"],
  }).returning();
  return res.status(201).json(mapPayment(payment));
});

export default router;
