import assert from "node:assert/strict";
import { AiError, generate, jsonOf, takeAiCredit, textOf } from "../src/lib/ai.ts";

const env = { GOOGLE_API_KEY: "k-123", AI_DAILY_LIMIT: "2" } as any;
let seen: any;
const reply = (status: number, body: unknown) => (async (url: string, init: any) => {
  seen = { url, init };
  return new Response(JSON.stringify(body), { status });
}) as any;

// The key travels in a header, never in the URL.
const out = await generate({ system: "s", contents: [{ role: "user", parts: [{ text: "hi" }] }] }, env,
  reply(200, { candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "नमस्ते" }] } }] }));
assert.equal(seen.init.headers["x-goog-api-key"], "k-123");
assert.ok(!seen.url.includes("k-123"));
assert.equal(textOf(out), "नमस्ते", "thought parts are left out");

await assert.rejects(generate({ system: "s", contents: [] }, {} as any), (e: any) => e instanceof AiError && e.status === 503);
await assert.rejects(generate({ system: "s", contents: [] }, env, reply(429, {})), (e: any) => e.status === 503);
await assert.rejects(generate({ system: "s", contents: [] }, env, reply(500, {})), (e: any) => e.status === 502);

assert.deepEqual(jsonOf({ role: "model", parts: [{ text: '{"a":1}' }] }), { a: 1 });
assert.throws(() => jsonOf({ role: "model", parts: [{ text: "not json" }] }), AiError);

// Two a day per business, counted on the Indian date.
const t = new Date("2026-11-22T10:00:00Z");
assert.equal(takeAiCredit(7, env, t), true);
assert.equal(takeAiCredit(7, env, t), true);
assert.equal(takeAiCredit(7, env, t), false, "third use on the same day is refused");
assert.equal(takeAiCredit(8, env, t), true, "another business has its own count");
assert.equal(takeAiCredit(7, env, new Date("2026-11-22T19:00:00Z")), true, "00:30 IST is a new day");
console.log("  ok    AI client and daily limit");

const { appRate } = await import("../src/lib/ai.ts");
assert.equal(appRate(18), 18);
assert.equal(appRate(40), 28, "a rate the forms don't offer snaps to the nearest one");
assert.equal(appRate("abc", 12), 12);
console.log("  ok    GST rates fit the forms");
