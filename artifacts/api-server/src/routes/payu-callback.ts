/**
 * PayU posts the payment result here from its own site, as a form. Mounted
 * ahead of the origin and CSRF checks (it is a cross-site POST by design) and
 * trusted only through PayU's signature and the amount we asked for.
 */

import express, { type Request, type Response } from "express";
import { rootDb, runInSystemScope, db, capacityRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { payuConfig, verifyPayuResponse } from "../lib/payu";
import { recordAudit } from "../lib/audit";
import { config } from "../lib/config";
import { logger } from "../lib/logger";

export const payuCallback = [
  express.urlencoded({ extended: false, limit: "20kb" }),
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const done = (result: string) => res.redirect(303, `${config.appBaseUrl}/admin/users?payment=${result}`);
    if (!verifyPayuResponse(payuConfig(), body)) {
      logger.warn({ txnid: body["txnid"] }, "PayU callback with a bad signature");
      return done("failed");
    }
    const outcome = await runInSystemScope(rootDb, async () => {
      const [request] = await db.select().from(capacityRequestsTable).where(eq(capacityRequestsTable.payuTxnid, body["txnid"] ?? "")).limit(1);
      if (!request) return "failed";
      if (request.paymentStatus === "paid") return "success";
      const paid = body["status"] === "success" && Number(body["amount"]) === request.amountInr;
      await db.update(capacityRequestsTable).set(paid
        ? { paymentStatus: "paid", paidAt: new Date(), payuPaymentId: body["mihpayid"] ?? null }
        : { paymentStatus: "failed" }).where(eq(capacityRequestsTable.id, request.id));
      await recordAudit({
        actorId: request.adminId, actorEmail: body["email"] ?? "", action: paid ? "capacity_request.paid" : "capacity_request.payment_failed",
        targetType: "capacity_request", targetId: request.id,
        details: { txnid: body["txnid"], payuId: body["mihpayid"] ?? null, amount: body["amount"], status: body["status"] },
      });
      return paid ? "success" : "failed";
    });
    return done(outcome);
  },
];
