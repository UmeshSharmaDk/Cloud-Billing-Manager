/**
 * Property tests for the money arithmetic.
 *
 * The invariant that matters on a GST return: the line items and the invoice
 * totals are both filed, and they must reconcile exactly. The old code rounded
 * each line for storage but accumulated the unrounded values, so three lines of
 * 33.333 were stored as 33.33 each — summing to 99.99 — under a subtotal of
 * 100.00.
 *
 * Run: pnpm --filter @workspace/api-server run test
 */

import { Decimal, dec, paise, rupees, sum, splitGst, toJson } from "../src/lib/money.ts";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${cond || !detail ? "" : `  [${detail}]`}`);
  cond ? pass++ : fail++;
};

// Mirrors calcGst / calcPurchaseTotals: round at the line, sum the rounded.
function calcLines(
  items: Array<{ quantity: string; unitPrice: string; discount: string; gstRate: string }>,
  isInterstate: boolean,
) {
  const lines = items.map((item) => {
    const taxableAmount = paise(
      dec(item.quantity).times(dec(item.unitPrice))
        .times(new Decimal(100).minus(dec(item.discount))).dividedBy(100),
    );
    const lineGst = paise(taxableAmount.times(dec(item.gstRate)).dividedBy(100));
    const igst = isInterstate ? lineGst : new Decimal(0);
    const { cgst, sgst } = isInterstate
      ? { cgst: new Decimal(0), sgst: new Decimal(0) }
      : splitGst(lineGst);
    return { taxableAmount, cgst, sgst, igst, totalAmount: sum([taxableAmount, cgst, sgst, igst]) };
  });

  const subtotal = sum(lines.map((l) => l.taxableAmount));
  const cgst = sum(lines.map((l) => l.cgst));
  const sgst = sum(lines.map((l) => l.sgst));
  const igst = sum(lines.map((l) => l.igst));
  const totalGst = sum([cgst, sgst, igst]);
  const payable = subtotal.plus(totalGst);
  const grandTotal = rupees(payable);
  return { lines, subtotal, cgst, sgst, igst, totalGst, grandTotal, roundOff: paise(grandTotal.minus(payable)) };
}

// --- the exact case that used to drift -------------------------------------
{
  const r = calcLines(
    Array.from({ length: 3 }, () => ({ quantity: "1", unitPrice: "33.333", discount: "0", gstRate: "18" })),
    false,
  );
  const lineSum = sum(r.lines.map((l) => l.taxableAmount));
  check("the 3 x 33.333 case: lines sum exactly to the subtotal",
    lineSum.equals(r.subtotal), `${lineSum.toFixed(2)} vs ${r.subtotal.toFixed(2)}`);
  check("...and the subtotal is the honest 99.99, not a rounded-up 100.00",
    r.subtotal.toFixed(2) === "99.99", r.subtotal.toFixed(2));
}

// --- generated cases --------------------------------------------------------
const RATES = ["0", "0.1", "0.25", "1", "1.5", "3", "5", "6", "7.5", "12", "18", "28"];
let seed = 20260912;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const money = () => (rand() * 9999).toFixed(rand() < 0.5 ? 2 : 3);
const qty = () => (rand() * 40 + 0.001).toFixed(3);

let subtotalOk = 0, cgstOk = 0, sgstOk = 0, igstOk = 0, lineOk = 0, gstOk = 0, roundOk = 0;
const CASES = 500;

for (let c = 0; c < CASES; c++) {
  const isInterstate = rand() < 0.5;
  const items = Array.from({ length: 1 + Math.floor(rand() * 12) }, () => ({
    quantity: qty(),
    unitPrice: money(),
    discount: rand() < 0.3 ? (rand() * 40).toFixed(2) : "0",
    gstRate: pick(RATES),
  }));
  const r = calcLines(items, isInterstate);

  if (sum(r.lines.map((l) => l.taxableAmount)).equals(r.subtotal)) subtotalOk++;
  if (sum(r.lines.map((l) => l.cgst)).equals(r.cgst)) cgstOk++;
  if (sum(r.lines.map((l) => l.sgst)).equals(r.sgst)) sgstOk++;
  if (sum(r.lines.map((l) => l.igst)).equals(r.igst)) igstOk++;
  if (r.lines.every((l) => sum([l.taxableAmount, l.cgst, l.sgst, l.igst]).equals(l.totalAmount))) lineOk++;
  if (sum([r.cgst, r.sgst, r.igst]).equals(r.totalGst)) gstOk++;
  // grandTotal - roundOff must reconstruct the payable amount exactly.
  if (r.grandTotal.minus(r.roundOff).equals(r.subtotal.plus(r.totalGst))) roundOk++;
}

check(`lines sum exactly to the subtotal (${subtotalOk}/${CASES})`, subtotalOk === CASES);
check(`lines sum exactly to CGST (${cgstOk}/${CASES})`, cgstOk === CASES);
check(`lines sum exactly to SGST (${sgstOk}/${CASES})`, sgstOk === CASES);
check(`lines sum exactly to IGST (${igstOk}/${CASES})`, igstOk === CASES);
check(`each line's parts sum to its own total (${lineOk}/${CASES})`, lineOk === CASES);
check(`CGST + SGST + IGST equals the total GST (${gstOk}/${CASES})`, gstOk === CASES);
check(`grand total less round-off reconstructs the payable amount (${roundOk}/${CASES})`, roundOk === CASES);

// --- the float version fails the same property -----------------------------
{
  // The previous implementation, verbatim in spirit: round the line, accumulate
  // the unrounded. Shown here so the test records what was actually wrong.
  let subtotal = 0;
  const lines = [33.333, 33.333, 33.333].map((v) => {
    subtotal += v;
    return Math.round(v * 100) / 100;
  });
  const oldSubtotal = Math.round(subtotal * 100) / 100;
  const lineSum = Math.round(lines.reduce((a, b) => a + b, 0) * 100) / 100;
  check("the float implementation does NOT hold the invariant (regression guard)",
    lineSum !== oldSubtotal, `lines ${lineSum} vs subtotal ${oldSubtotal}`);
}

// --- splitGst never loses or invents a paisa -------------------------------
{
  let ok = 0;
  for (let i = 0; i < 2000; i++) {
    const total = paise(new Decimal(rand() * 5000));
    const { cgst, sgst } = splitGst(total);
    if (cgst.plus(sgst).equals(total)) ok++;
  }
  check(`CGST and SGST always reconstruct the tax exactly (${ok}/2000)`, ok === 2000);
}

// --- representation -------------------------------------------------------
{
  check("0.1 + 0.2 is exactly 0.30", sum(["0.1", "0.2"]).toFixed(2) === "0.30");
  check("a hundred 0.01s are exactly 1.00",
    sum(Array.from({ length: 100 }, () => "0.01")).toFixed(2) === "1.00");
  check("toJson keeps two decimal places", toJson("1234.565") === 1234.57, String(toJson("1234.565")));
  check("garbage coerces to zero rather than NaN", dec("not-a-number").toFixed(2) === "0.00");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
