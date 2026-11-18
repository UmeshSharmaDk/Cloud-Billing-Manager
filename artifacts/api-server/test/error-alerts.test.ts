import assert from "node:assert/strict";
import { alertServerError } from "../src/lib/error-alerts.ts";

const sent: any[] = [];
const send = (m: unknown) => sent.push(m);
const info = { requestId: 7, method: "GET", path: "/api/x", error: "boom" };

delete process.env["ERROR_ALERT_TO"];
assert.equal(alertServerError(info, send, 1_000_000), false);
process.env["ERROR_ALERT_TO"] = "ops@example.test";
assert.equal(alertServerError(info, send, 2_000_000), true);
assert.equal(alertServerError(info, send, 2_000_001), false);
assert.equal(alertServerError(info, send, 2_000_002), false);
assert.equal(alertServerError(info, send, 2_000_000 + 10 * 60 * 1000), true);
assert.equal(sent.length, 2);
assert.match(sent[1].text, /2 more errors/);
assert.equal(sent[0].to, "ops@example.test");
console.log("  ok    500s are emailed at most once every ten minutes, with a count of the rest");
