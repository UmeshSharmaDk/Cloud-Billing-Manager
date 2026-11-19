import assert from "node:assert/strict";
import crypto from "node:crypto";
import { payuConfig, payuForm, verifyPayuResponse } from "../src/lib/payu.ts";

const cfg = payuConfig({});
assert.equal(cfg.live, false);
assert.equal(cfg.url, "https://test.payu.in/_payment");
assert.throws(() => payuConfig({ PAYU_MODE: "live" }), /PAYU_KEY/);

const form = payuForm(cfg, { txnid: "CR1-abc", amount: "1000.00", productinfo: "2 more users", firstname: "Asha", email: "a@example.test", udf1: "1" }, "https://x/s", "https://x/f");
const sha = (s: string) => crypto.createHash("sha512").update(s).digest("hex");
assert.equal(form.hash, sha(`${cfg.key}|CR1-abc|1000.00|2 more users|Asha|a@example.test|1||||||||||${cfg.salt}`));

const reply: Record<string, string> = { status: "success", txnid: "CR1-abc", amount: "1000.00", productinfo: "2 more users", firstname: "Asha", email: "a@example.test", udf1: "1" };
reply.hash = sha(`${cfg.salt}|success||||||||||1|a@example.test|Asha|2 more users|1000.00|CR1-abc|${cfg.key}`);
assert.equal(verifyPayuResponse(cfg, reply), true);
assert.equal(verifyPayuResponse(cfg, { ...reply, amount: "1.00" }), false, "a changed amount fails");
assert.equal(verifyPayuResponse(cfg, { ...reply, hash: "00" }), false);
const fromApp = payuForm(cfg, { txnid: "CR1-abc", amount: "1000.00", productinfo: "2 more users", firstname: "Asha", email: "a@example.test", udf1: "1", udf2: "app" }, "https://x/s", "https://x/f");
assert.equal(fromApp.hash, sha(`${cfg.key}|CR1-abc|1000.00|2 more users|Asha|a@example.test|1|app|||||||||${cfg.salt}`));
console.log("  ok    PayU request and response hashes");
