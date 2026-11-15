/** A line from a bank statement: credits are positive, debits negative. */
export type StatementRow = { date: string; description: string; amount: number; reference?: string | null };
/** An unpaid invoice (for credits) or bill (for debits), with what is still owed on it. */
export type OpenDoc = { id: number; number: string; party: string; partyId?: number | null; due: number };
export type Match = OpenDoc & { kind: "invoice" | "purchase"; by: "number" | "amount" };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const paise = (n: number) => Math.round(Math.abs(n) * 100);

/**
 * Suggest which open invoice or bill each statement line settles. A line whose
 * narration names a document's number wins; otherwise the amount must equal what
 * is due on exactly one document, so a guess is never made between two. Each
 * document is suggested at most once.
 */
export function matchStatement(rows: StatementRow[], invoices: OpenDoc[], purchases: OpenDoc[]): (Match | null)[] {
  const used = new Set<string>();
  return rows.map((row) => {
    const kind = row.amount > 0 ? "invoice" : "purchase";
    const docs = (kind === "invoice" ? invoices : purchases).filter((d) => d.due > 0 && !used.has(`${kind}${d.id}`));
    const text = norm(`${row.description} ${row.reference ?? ""}`);
    // Numbers under three characters ("1", "12") would match any narration.
    let doc = docs.find((d) => norm(d.number).length >= 3 && text.includes(norm(d.number)));
    let by: Match["by"] = "number";
    if (!doc) {
      const same = docs.filter((d) => paise(d.due) === paise(row.amount));
      doc = same.length === 1 ? same[0] : undefined;
      by = "amount";
    }
    if (!doc || row.amount === 0) return null;
    used.add(`${kind}${doc.id}`);
    return { kind, ...doc, by };
  });
}
