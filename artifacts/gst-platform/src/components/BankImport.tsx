import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/api-fetch";
import { fileToText } from "@/lib/pdf-parser";
import { parseStatementText, type StatementRow } from "@/lib/bank-statement";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Landmark } from "lucide-react";

type Match = { kind: "invoice" | "purchase"; id: number; number: string; party: string; partyId?: number | null; due: number; by: "number" | "amount" };

async function post(path: string, body: unknown, method = "POST") {
  const res = await authFetch(`/api${path}`, { method, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Request failed");
  return data;
}

/** Record a matched statement line through the ordinary payment endpoints, so lock dates and the audit trail apply. */
async function apply(row: StatementRow, m: Match) {
  const base = { date: row.date, mode: "bank_transfer", referenceNumber: row.reference || undefined, notes: row.description.slice(0, 2000) || undefined };
  const amount = Math.abs(row.amount);
  if (m.kind === "invoice") {
    await post("/payments", { ...base, type: "received", invoiceId: m.id, customerId: m.partyId, amount: Math.min(amount, m.due) });
  } else {
    await post("/payments", { ...base, type: "paid", vendorId: m.partyId, amount });
    if (amount >= m.due) await post(`/purchases/${m.id}`, { paymentStatus: "paid" }, "PATCH");
  }
}

/** Upload a bank statement, review which invoice or bill each line settles, and record the ticked ones. */
export function BankImport() {
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [matches, setMatches] = useState<(Match | null)[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const load = async (file: File) => {
    setBusy("Reading the statement…");
    try {
      const parsed = parseStatementText(await fileToText(file));
      if (!parsed.length) throw new Error("No transactions found. Export the statement as Excel or CSV from your bank and try again.");
      const { matches } = await post("/payments/match", { rows: parsed });
      setRows(parsed);
      setMatches(matches);
      setPicked(new Set(matches.flatMap((m: Match | null, i: number) => (m ? [i] : []))));
    } catch (e: any) {
      toast({ title: "Could not import", description: e.message, variant: "destructive" });
    } finally {
      setBusy("");
    }
  };

  const record = async () => {
    const failed: string[] = [];
    let done = 0;
    for (const i of picked) {
      setBusy(`Recording ${done + failed.length + 1} of ${picked.size}…`);
      try { await apply(rows[i], matches[i]!); done++; } catch (e: any) { failed.push(`${matches[i]!.number}: ${e.message}`); }
    }
    setBusy("");
    toast({ title: `Recorded ${done} payment${done === 1 ? "" : "s"}`, description: failed.join("\n") || undefined, variant: failed.length ? "destructive" : undefined });
    setRows([]); setMatches([]); setPicked(new Set());
    await qc.invalidateQueries();
  };

  const toggle = (i: number) => setPicked((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const matched = matches.filter(Boolean).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4" /> Import bank statement</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Excel, CSV or PDF (scanned PDFs and photos are read with OCR). Each line is matched to an unpaid invoice or bill by its number in the narration, or by an amount that only one of them is due. Nothing is saved until you press Record.</p>
        <Input type="file" accept=".xlsx,.xls,.csv,.pdf,.txt,image/*" disabled={!!busy} className="max-w-sm"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ""; }} />
        {busy && <p className="text-muted-foreground">{busy}</p>}
        {rows.length > 0 && !busy && (
          <>
            <p>{rows.length} lines read, {matched} matched.</p>
            <div className="max-h-96 overflow-auto">
              <table className="w-full">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2" /><th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Narration</th>
                  <th className="py-2 pr-3 text-right">Amount</th><th className="py-2">Settles</th>
                </tr></thead>
                <tbody>{rows.map((r, i) => {
                  const m = matches[i];
                  return (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-2">{m && <input type="checkbox" aria-label={`Record ${m.number}`} checked={picked.has(i)} onChange={() => toggle(i)} />}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="py-2 pr-3 max-w-xs truncate" title={r.description}>{r.description}</td>
                      <td className={`py-2 pr-3 text-right whitespace-nowrap ${r.amount > 0 ? "text-success-text" : "text-danger-text"}`}>{formatCurrency(r.amount)}</td>
                      <td className="py-2">{m ? <>{m.kind === "invoice" ? "Invoice" : "Bill"} {m.number} · {m.party} <span className="text-xs text-muted-foreground">({formatCurrency(m.due)} due, by {m.by})</span></> : <span className="text-muted-foreground">No match</span>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button disabledReason={picked.size ? undefined : "Tick the matches to record first"} onClick={record}>Record {picked.size} payment{picked.size === 1 ? "" : "s"}</Button>
              <Button variant="ghost" onClick={() => { setRows([]); setMatches([]); }}>Discard statement</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
