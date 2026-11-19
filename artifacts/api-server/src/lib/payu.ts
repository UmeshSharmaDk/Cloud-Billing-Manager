/**
 * PayU hosted checkout (https://docs.payu.in): the browser posts a signed form
 * to PayU, the customer pays there, and PayU posts the result back to us.
 * Both directions are signed with SHA-512 over the merchant salt.
 *
 * PAYU_MODE=live with PAYU_KEY and PAYU_SALT takes real money. Anything else is
 * PayU's test environment with PayU's published test merchant, so no secret is
 * needed until going live.
 */

import crypto from "node:crypto";

const TEST = { key: "gtKFFx", salt: "eCwWELxi", url: "https://test.payu.in/_payment" };

export function payuConfig(env: NodeJS.ProcessEnv = process.env) {
  const live = env["PAYU_MODE"] === "live";
  const key = env["PAYU_KEY"]?.trim() || (live ? "" : TEST.key);
  const salt = env["PAYU_SALT"]?.trim() || (live ? "" : TEST.salt);
  if (!key || !salt) throw new Error("PAYU_MODE=live needs PAYU_KEY and PAYU_SALT.");
  return { live, key, salt, url: live ? "https://secure.payu.in/_payment" : TEST.url };
}

const sha512 = (s: string) => crypto.createHash("sha512").update(s).digest("hex");

export interface PayuRequest {
  txnid: string; amount: string; productinfo: string; firstname: string; email: string; udf1?: string;
  /** "app" when the Android app started the payment: the result page then sends the admin back to it. */
  udf2?: string;
}

/** The fields to post to PayU, hash included. */
export function payuForm(cfg: { key: string; salt: string }, r: PayuRequest, surl: string, furl: string) {
  const udf1 = r.udf1 ?? "";
  const udf2 = r.udf2 ?? "";
  const hash = sha512([cfg.key, r.txnid, r.amount, r.productinfo, r.firstname, r.email, udf1, udf2, "", "", "", "", "", "", "", "", cfg.salt].join("|"));
  return { key: cfg.key, txnid: r.txnid, amount: r.amount, productinfo: r.productinfo, firstname: r.firstname, email: r.email, udf1, udf2, surl, furl, hash };
}

/** Whether PayU's callback is genuine: the reverse hash over what it posted. */
export function verifyPayuResponse(cfg: { key: string; salt: string }, b: Record<string, string | undefined>): boolean {
  const f = (k: string) => b[k] ?? "";
  const parts = [cfg.salt, f("status"), "", "", "", "", "", f("udf5"), f("udf4"), f("udf3"), f("udf2"), f("udf1"), f("email"), f("firstname"), f("productinfo"), f("amount"), f("txnid"), cfg.key];
  if (b["additionalCharges"]) parts.unshift(b["additionalCharges"]);
  const expected = sha512(parts.join("|"));
  const got = f("hash").toLowerCase();
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** What PayU is asked to charge for a seat request. */
export function payuRequestFor(request: { id: number; amountInr: number; additionalUsers: number; payuTxnid: string | null }, admin: { name: string; email: string }, udf2 = "") {
  return {
    txnid: request.payuTxnid!, amount: request.amountInr.toFixed(2), productinfo: `${request.additionalUsers} more users on Billing Pilot`,
    firstname: admin.name.slice(0, 60), email: admin.email, udf1: String(request.id), udf2,
  };
}
