/** A bank statement line: credits positive, debits negative, date as YYYY-MM-DD. */
export type StatementRow = { date: string; description: string; amount: number; reference: string | null };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Indian banks write dates day first: 05/11/2026, 05-11-26, 05 Nov 2026, 05-Nov-26, or ISO. */
export function parseBankDate(s: string): string | null {
  const t = s.trim().toLowerCase();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[\/\-. ]([a-z]{3,9}|\d{1,2})[\/\-. ,]+(\d{2}|\d{4})\b/);
  if (!m) return null;
  const mon = /\d/.test(m[2]) ? Number(m[2]) : MONTHS.indexOf(m[2].slice(0, 3)) + 1;
  const day = Number(m[1]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const num = (s: string | undefined) => {
  const n = parseFloat((s ?? "").replace(/[,₹\s]|cr|dr/gi, ""));
  return Number.isFinite(n) ? n : 0;
};
const MONEY = /-?\d[\d,]*\.\d{2}\b/g;

/** Rows from an exported statement (CSV or Excel, cells separated by tabs or commas). */
function fromTable(lines: string[][]): StatementRow[] | null {
  const h = lines.findIndex((cells) => {
    const l = cells.map((c) => c.toLowerCase());
    return l.some((c) => c.includes("date")) && l.some((c) => /withdrawal|debit|deposit|credit|amount/.test(c));
  });
  if (h < 0) return null;
  const head = lines[h].map((c) => c.toLowerCase().trim());
  const col = (re: RegExp) => head.findIndex((c) => re.test(c));
  const date = col(/date/), desc = col(/narration|description|particulars|details|remarks/);
  const ref = col(/ref|chq|cheque|utr/), debit = col(/withdrawal|debit/), credit = col(/deposit|credit/);
  const amount = col(/^amount|amount \(/), side = col(/cr\/dr|dr\/cr|^type$/);
  const rows: StatementRow[] = [];
  for (const cells of lines.slice(h + 1)) {
    const d = parseBankDate(cells[date] ?? "");
    if (!d) continue;
    let amt = credit >= 0 || debit >= 0 ? num(cells[credit]) - num(cells[debit]) : num(cells[amount]);
    if (side >= 0 && /dr|debit/i.test(cells[side] ?? "")) amt = -Math.abs(amt);
    if (amount >= 0 && /\bdr\b/i.test(cells[amount] ?? "")) amt = -Math.abs(amt);
    if (!amt) continue;
    rows.push({ date: d, description: (cells[desc] ?? "").trim(), amount: Math.round(amt * 100) / 100, reference: ref >= 0 ? cells[ref]?.trim() || null : null });
  }
  return rows;
}

/**
 * Rows from statement text (a PDF or a scan): each line that starts with a date
 * and ends "amount balance". Whether money came in or went out is read from how
 * the balance moved; the first line, with no balance before it, from a Cr/Dr mark.
 */
function fromText(lines: string[]): StatementRow[] {
  const rows: StatementRow[] = [];
  let balance: number | null = null;
  for (const line of lines) {
    const opening = /opening balance/i.test(line) ? line.match(MONEY) : null;
    if (opening) { balance = num(opening[opening.length - 1]); continue; }
    const d = parseBankDate(line);
    const money = line.match(MONEY);
    if (!d || !money || money.length < 2) continue;
    const amt = num(money[money.length - 2]);
    const bal = num(money[money.length - 1]);
    let sign = 0;
    if (balance !== null) sign = Math.sign(Math.round((bal - balance) * 100));
    else if (/\bcr\b/i.test(line)) sign = 1;
    else if (/\bdr\b/i.test(line)) sign = -1;
    balance = bal;
    if (!sign || !amt) continue;
    const description = line.replace(/^\S+(\s+[a-z]{3,9}\s+\d{2,4})?/i, "").replace(MONEY, "").replace(/\s+/g, " ").trim();
    rows.push({ date: d, description, amount: sign * amt, reference: null });
  }
  return rows;
}

export function parseStatementText(text: string): StatementRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : lines.some((l) => l.split(",").length > 3) ? "," : null;
  // ponytail: comma split ignores quoted commas; Excel exports come through as tabs, which covers most banks.
  const table = sep ? fromTable(lines.map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "")))) : null;
  return table ?? fromText(lines);
}
