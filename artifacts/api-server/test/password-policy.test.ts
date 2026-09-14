import crypto from "node:crypto";

// Stub the network before the module under test is loaded.
const calls: string[] = [];
let mode: "hit" | "miss" | "padding" | "error" | "http500" = "miss";

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  calls.push(String(url));
  if (mode === "error") throw new Error("network down");
  if (mode === "http500") return new Response("", { status: 500 });

  const sha1 = crypto.createHash("sha1").update(PASSWORD).digest("hex").toUpperCase();
  const suffix = sha1.slice(5);
  const noise = "0".repeat(35) + ":12\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:3\n";
  if (mode === "hit") return new Response(`${noise}${suffix}:4821\n`, { status: 200 });
  if (mode === "padding") return new Response(`${noise}${suffix}:0\n`, { status: 200 });
  return new Response(noise, { status: 200 });
}) as any;

let PASSWORD = "";

const { isBreachedPassword, validatePassword } =
  await import("../src/lib/password-policy.ts");

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}`);
  cond ? pass++ : fail++;
};

PASSWORD = "some-long-enough-passphrase";

mode = "hit";
check("a suffix present with a non-zero count is treated as breached",
  (await isBreachedPassword(PASSWORD)) === true);

mode = "miss";
check("a suffix absent from the range is not breached",
  (await isBreachedPassword(PASSWORD)) === false);

mode = "padding";
check("a padding row (count 0) is not treated as a hit",
  (await isBreachedPassword(PASSWORD)) === false);

mode = "error";
check("a network failure fails OPEN, not closed",
  (await isBreachedPassword(PASSWORD)) === false);

mode = "http500";
check("an HTTP error fails OPEN",
  (await isBreachedPassword(PASSWORD)) === false);

// k-anonymity: only the 5-char prefix may leave the process.
mode = "miss";
calls.length = 0;
await isBreachedPassword(PASSWORD);
const sha1 = crypto.createHash("sha1").update(PASSWORD).digest("hex").toUpperCase();
check("only the 5-character hash prefix is sent",
  calls.length === 1 && calls[0].endsWith(`/range/${sha1.slice(0, 5)}`));
check("neither the password nor the full hash leaves the process",
  !calls[0].includes(PASSWORD) && !calls[0].includes(sha1.slice(5)));

// End-to-end through validatePassword.
mode = "hit";
const breached = await validatePassword(PASSWORD);
check("validatePassword surfaces a breached password as a failure",
  breached !== null && /data breach/i.test(breached.message));

mode = "miss";
check("validatePassword accepts a strong unbreached passphrase",
  (await validatePassword(PASSWORD)) === null);

check("structural checks run before any network call (short password, no fetch)",
  (calls.length = 0, (await validatePassword("short")) !== null && calls.length === 0));

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
