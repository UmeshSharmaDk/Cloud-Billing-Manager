/**
 * PayU posts the payment result here from its own site, as a form. Mounted
 * ahead of the origin and CSRF checks (it is a cross-site POST by design) and
 * trusted only through PayU's signature and the amount we asked for.
 */

import express, { type Request, type Response } from "express";
import crypto from "node:crypto";
import { rootDb, runInSystemScope, db, capacityRequestsTable, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { payuConfig, payuForm, payuRequestFor, verifyPayuResponse } from "../lib/payu";
import { recordAudit } from "../lib/audit";
import { config } from "../lib/config";
import { logger } from "../lib/logger";

export const payuCallback = [
  express.urlencoded({ extended: false, limit: "20kb" }),
  async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, string>;
    // A payment started from the Android app ends in the phone's browser: say so there, rather than open the website.
    const done = (result: string) => body["udf2"] === "app" && verifyPayuResponse(payuConfig(), body)
      ? page(res, result === "success" ? "Payment received" : "Payment not completed",
        result === "success" ? "The platform owner will now approve your extra users. You can go back to the Billing Pilot app." : "No money was taken for this request, or PayU did not confirm it. Go back to the Billing Pilot app to try again.")
      : res.redirect(303, `${config.appBaseUrl}/admin/users?payment=${result}`);
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

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A bare page for the phone's browser. Its own CSP: the API's default allows nothing at all. */
function page(res: Response, title: string, text: string, form = "", nonce = "") {
  res.setHeader("Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action https://test.payu.in https://secure.payu.in${nonce ? `; script-src 'nonce-${nonce}'` : ""}`);
  res.setHeader("Cache-Control", "no-store");
  return res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#101828}button{min-height:44px;padding:0 1.25rem;border:0;border-radius:10px;background:#386BFF;color:#fff;font-size:1rem}button:focus-visible{outline:3px solid #101828;outline-offset:2px}</style></head>
<body><h1 style="font-size:1.25rem">${esc(title)}</h1><p>${esc(text)}</p>${form}</body></html>`);
}

/**
 * GET /api/payments/payu/checkout/:txnid: the Android app has no web view, so it
 * opens this in the phone's browser, which posts the signed form on to PayU. The
 * unguessable txnid from POST /capacity-requests/:id/pay is the only key, and it
 * can do nothing but start paying that request.
 */
export async function payuCheckout(req: Request, res: Response) {
  const txnid = String(req.params["txnid"] ?? "");
  if (!/^CR\d+-[0-9a-f]{16}$/.test(txnid)) return res.status(404).type("text").send("Not found");
  const found = await runInSystemScope(rootDb, async () => {
    const [row] = await db.select({ request: capacityRequestsTable, name: usersTable.name, email: usersTable.email })
      .from(capacityRequestsTable).innerJoin(usersTable, eq(usersTable.id, capacityRequestsTable.adminId))
      .where(and(eq(capacityRequestsTable.payuTxnid, txnid), eq(capacityRequestsTable.status, "pending"))).limit(1);
    return row;
  });
  if (!found) return page(res.status(404), "Payment link not found", "Open the request again in the Billing Pilot app to get a new link.");
  if (found.request.paymentStatus === "paid") return page(res, "Already paid", "This request is paid. You can go back to the Billing Pilot app.");
  const cfg = payuConfig();
  const back = `${config.appBaseUrl}/api/payments/payu/callback`;
  const fields = payuForm(cfg, payuRequestFor(found.request, found, "app"), back, back);
  const nonce = crypto.randomBytes(16).toString("base64");
  const inputs = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(String(v))}">`).join("");
  return page(res, `Pay ₹${fields.amount} with PayU`, `${fields.productinfo}.${cfg.live ? "" : " Test mode: no real money is taken."}`,
    `<form id="pay" method="post" action="${esc(cfg.url)}">${inputs}<button type="submit">Continue to PayU</button></form><script nonce="${nonce}">document.getElementById("pay").submit()</script>`, nonce);
}
