import { useState } from "react";
import { authFetch } from "@/lib/api-fetch";
import { parseGstr2b, reconcile, type Row, type BookBill } from "@/lib/gstr2b";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

/** Every purchase bill dated in the month. */
async function monthBills(from: string, to: string): Promise<BookBill[]> {
  const out: BookBill[] = [];
  for (let page = 1; page < 200; page++) {
    const res = await authFetch(`/api/purchases?fromDate=${from}&toDate=${to}&limit=100&page=${page}`);
    if (!res.ok) throw new Error("Could not load your purchase bills.");
    const d = await res.json();
    out.push(...d.purchases.filter((p: any) => p.status !== "cancelled"));
    if (out.length >= d.total || d.purchases.length === 0) break;
  }
  return out;
}

const LABEL: Record<Row["kind"], string> = {
  matched: "Matched",
  mismatch: "Tax differs",
  portal_only: "On the portal, not in your books",
  books_only: "In your books, not on the portal",
};

/** GSTR-2B against the month's purchase bills, so credit is claimed only where the supplier filed. */
export function Gstr2bReconcile({ month }: { month: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true); setError(""); setRows(null);
    try {
      const portal = parseGstr2b(JSON.parse(await file.text()));
      const [y, m] = month.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      setRows(reconcile(portal, await monthBills(`${month}-01`, `${month}-${String(last).padStart(2, "0")}`)));
    } catch (err: any) {
      setError(err instanceof SyntaxError ? "That file is not JSON. Download GSTR-2B as JSON from the GST portal." : err.message);
    } finally {
      setBusy(false);
    }
  };

  const counts = (k: Row["kind"]) => rows?.filter((r) => r.kind === k).length ?? 0;
  const atRisk = rows?.filter((r) => r.kind === "books_only").reduce((s, r) => s + Number((r as any).book.totalGst), 0) ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Match GSTR-2B with your purchase bills</CardTitle>
          <CardDescription>
            On the GST portal open Returns, GSTR-2B, choose the month and download the JSON file. Pick it here; it is read on this device and not uploaded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="gstr2b-file">GSTR-2B JSON file for {month}</Label>
          <Input id="gstr2b-file" type="file" accept=".json,application/json" disabled={busy} onChange={(e) => void load(e.target.files?.[0])} />
          {busy && <p className="text-sm text-muted-foreground">Matching…</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
        </CardContent>
      </Card>

      {rows && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["matched", "mismatch", "portal_only", "books_only"] as const).map((k) => (
              <Card key={k}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{LABEL[k]}</p><p className="text-xl font-bold">{counts(k)}</p></CardContent></Card>
            ))}
          </div>
          {atRisk > 0 && (
            <p className="text-sm">Input credit of <strong>{formatCurrency(atRisk)}</strong> is on bills your suppliers have not filed yet. Ask them to file before you claim it.</p>
          )}
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="p-3">Result</th><th className="p-3">Supplier</th><th className="p-3">Bill no.</th><th className="p-3 text-right">Tax on portal</th><th className="p-3 text-right">Tax in books</th>
                </tr></thead>
                <tbody>
                  {[...rows].sort((a, b) => Number(a.kind === "matched") - Number(b.kind === "matched")).map((r, i) => {
                    const p = "portal" in r ? r.portal : null;
                    const b = "book" in r ? r.book : null;
                    return (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-3">{LABEL[r.kind]}</td>
                        <td className="p-3">{p?.supplier ?? b?.vendorName}<div className="text-xs font-mono text-muted-foreground">{p?.gstin ?? b?.vendorGstin ?? "No GSTIN"}</div></td>
                        <td className="p-3 font-mono">{p?.number ?? b?.invoiceNumber}</td>
                        <td className="p-3 text-right">{p ? formatCurrency(p.tax) : "-"}</td>
                        <td className="p-3 text-right">{b ? formatCurrency(Number(b.totalGst)) : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
