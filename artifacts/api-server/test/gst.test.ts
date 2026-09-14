/**
 * Supply-type resolution: the CGST+SGST vs IGST decision.
 *
 * The bug these cover was not a wrong number, it was a wrong *head* of tax on
 * an invoice whose total was right — invisible on the document, expensive at
 * filing time. Every case below distinguishes "charged the wrong tax" from
 * "charged the wrong amount".
 *
 *   node test/gst.test.ts
 */

import {
  normaliseStateCode,
  stateCodeFromGstin,
  businessStateCode,
  resolveSupplyType,
} from "../src/lib/gst.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`); }
}

console.log("\nstate code normalisation");
check("a two-digit code passes through", normaliseStateCode("27") === "27");
check("a one-digit code is padded", normaliseStateCode("7") === "07");
check("surrounding whitespace is ignored", normaliseStateCode(" 27 ") === "27");
check("an unassigned code is rejected", normaliseStateCode("00") === null);
check("a code past the assigned range is rejected", normaliseStateCode("45") === null);
check("'Other Territory' (97) is accepted", normaliseStateCode("97") === "97");
check("a foreign counterparty (99) is accepted", normaliseStateCode("99") === "99");
check("a non-numeric value is rejected", normaliseStateCode("MH") === null);
check("an empty string is rejected", normaliseStateCode("") === null);
check("null is rejected", normaliseStateCode(null) === null);
check("a number is rejected (only strings are state codes)", normaliseStateCode(27) === null);

console.log("\nstate code from GSTIN");
// The first two characters of a GSTIN are the state of registration, which is
// what makes this a fallback rather than a guess.
check("reads the leading state code", stateCodeFromGstin("27AAAPA1234A1Z5") === "27");
check("reads a zero-padded code", stateCodeFromGstin("07AAAPA1234A1Z5") === "07");
check("lowercase is fine — only the digits are read", stateCodeFromGstin("27aaapa1234a1z5") === "27");
check("whitespace is trimmed", stateCodeFromGstin("  27AAAPA1234A1Z5  ") === "27");
check("a too-short value is rejected", stateCodeFromGstin("27AAAPA1234") === null);
check("a too-long value is rejected", stateCodeFromGstin("27AAAPA1234A1Z55") === null);
check("an unassigned leading code is rejected", stateCodeFromGstin("00AAAPA1234A1Z5") === null);
check("a non-numeric prefix is rejected", stateCodeFromGstin("MHAAAPA1234A1Z5") === null);
check("null is rejected", stateCodeFromGstin(null) === null);

console.log("\nbusiness state code prefers the explicit field");
check("uses stateCode when set",
  businessStateCode({ stateCode: "29", gstin: "27AAAPA1234A1Z5" }) === "29");
check("falls back to the GSTIN when stateCode is null",
  businessStateCode({ stateCode: null, gstin: "27AAAPA1234A1Z5" }) === "27");
check("falls back when stateCode is blank",
  businessStateCode({ stateCode: "  ", gstin: "27AAAPA1234A1Z5" }) === "27");
check("falls back when stateCode is junk",
  businessStateCode({ stateCode: "MH", gstin: "27AAAPA1234A1Z5" }) === "27");
check("null when neither is usable",
  businessStateCode({ stateCode: null, gstin: null }) === null);
check("null for a missing business", businessStateCode(null) === null);

console.log("\nsupply type");
const mh = { stateCode: "27", gstin: null };

{
  const r = resolveSupplyType(mh, "27");
  check("same state is intra-state", r.ok && r.isInterstate === false);
}
{
  const r = resolveSupplyType(mh, "29");
  check("a different state is inter-state", r.ok && r.isInterstate === true);
}
{
  // The padding case: "7" and "07" are the same state, and comparing them as
  // raw strings made a local sale look inter-state.
  const r = resolveSupplyType({ stateCode: "07", gstin: null }, "7");
  check("'7' and '07' are the same state", r.ok && r.isInterstate === false);
}
{
  const r = resolveSupplyType(mh, null);
  check("no place of supply is treated as local", r.ok && r.isInterstate === false);
}
{
  const r = resolveSupplyType(mh, "");
  check("an empty place of supply is treated as local", r.ok && r.isInterstate === false);
}

console.log("\nthe regression: a business with no state code");
{
  // Registration never set state_code, so this was every newly registered
  // business. It previously compared "27" against "" and charged IGST on a
  // local sale.
  const r = resolveSupplyType({ stateCode: null, gstin: null }, "27");
  check("refuses rather than guessing", !r.ok);
  check("and says what to do about it",
    !r.ok && /business state code/i.test(r.error), !r.ok ? r.error : "");
}
{
  // The common case in a GST product: no explicit state code, but a GSTIN,
  // which settles it authoritatively.
  const r = resolveSupplyType({ stateCode: null, gstin: "27AAAPA1234A1Z5" }, "27");
  check("a GSTIN alone resolves an intra-state sale", r.ok && r.isInterstate === false);
}
{
  const r = resolveSupplyType({ stateCode: null, gstin: "27AAAPA1234A1Z5" }, "29");
  check("a GSTIN alone resolves an inter-state sale", r.ok && r.isInterstate === true);
}

console.log("\nan unusable place of supply is rejected, not read as inter-state");
for (const bad of ["MH", "00", "45"]) {
  const r = resolveSupplyType(mh, bad);
  check(`"${bad}" is rejected`, !r.ok, r.ok ? `isInterstate=${r.isInterstate}` : "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
