// TOTP is hand-rolled on node:crypto, so it is checked against RFC 6238's own
// test vectors, and the recovery codes against the properties login relies on.
import {
  base32Encode, base32Decode, totpAt, matchTotp, currentStep,
  generateRecoveryCodes, hashRecoveryCode, looksLikeTotp,
} from "../src/lib/mfa.ts";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  [${detail}]` : ""}`); }
};

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890".
const secret = base32Encode(Buffer.from("12345678901234567890"));
check("base32 round-trips", base32Decode(secret).toString() === "12345678901234567890");
check("base32 matches the RFC 4648 example", base32Encode(Buffer.from("foobar")) === "MZXW6YTBOI");
for (const [t, code] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"],
  [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]] as const) {
  const got = totpAt(secret, Math.floor(t / 30), 8);
  check(`RFC vector at T=${t}`, got === code, got);
}

const now = 1_700_000_000_000;
const step = currentStep(now);
check("the current code matches its step", matchTotp(secret, totpAt(secret, step), now) === step);
check("one step of drift is accepted", matchTotp(secret, totpAt(secret, step - 1), now) === step - 1);
check("two steps of drift is not", matchTotp(secret, totpAt(secret, step - 2), now) === null);
check("a wrong code is refused", matchTotp(secret, totpAt(secret, step) === "000000" ? "111111" : "000000", now) === null);
check("a non-numeric code is refused", matchTotp(secret, "abcdef", now) === null);

const codes = generateRecoveryCodes();
check("ten recovery codes", codes.length === 10);
check("all different", new Set(codes).size === codes.length);
check("shaped XXXXX-XXXXX without 0, O, 1 or I", codes.every((c) => /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(c)));
check("typed back loosely, a code hashes the same",
  hashRecoveryCode(codes[0]!) === hashRecoveryCode(` ${codes[0]!.toLowerCase().replace("-", " ")} `));
check("a recovery code is never mistaken for a TOTP code", codes.every((c) => !looksLikeTotp(c)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
