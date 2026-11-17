import { useQuery } from "@tanstack/react-query";
import { RowsSkeleton } from "@/components/ui/skeleton";
import { authFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Entry = Record<string, any>;

/** Monthly TDS (on purchase bills, Form 26Q) or TCS (on sales, Form 27EQ). */
export function TdsTcsReport({ kind, month, year }: { kind: "tds" | "tcs"; month: number; year: number }) {
  const q = useQuery({
    queryKey: ["report", kind, month, year],
    queryFn: async () => {
      const res = await authFetch(`/api/reports/${kind}?month=${month}&year=${year}`);
      if (!res.ok) throw new Error("Could not load the report.");
      return (await res.json()) as { totalTds?: number; totalTcs?: number; sections?: Entry[]; entries: Entry[] };
    },
  });
  if (q.isLoading) return <Card><CardContent className="p-5"><RowsSkeleton rows={4} /></CardContent></Card>;
  if (q.error) return <p className="text-sm text-danger">{(q.error as Error).message}</p>;
  const d = q.data!;
  const tds = kind === "tds";
  const total = tds ? d.totalTds : d.totalTcs;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{tds ? "TDS withheld" : "TCS collected"}</p><p className="text-xl font-bold">{formatCurrency(total ?? 0)}</p><p className="text-xs text-muted-foreground">Deposit by the 7th of next month</p></CardContent></Card>
        {tds && d.sections?.map((s) => (
          <Card key={s.section}><CardContent className="p-4"><p className="text-xs text-muted-foreground">Section {s.section} · {s.bills} bills</p><p className="text-xl font-bold">{formatCurrency(s.tds)}</p><p className="text-xs text-muted-foreground">on {formatCurrency(s.taxable)}</p></CardContent></Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">{tds ? "Deductees (Form 26Q)" : "Collectees (Form 27EQ)"}</CardTitle></CardHeader>
        <CardContent>
          {!d.entries.length ? <p className="text-sm text-muted-foreground">Nothing this month. Add {tds ? "a TDS rate on purchase bills" : "a TCS rate on invoices"} to see it here.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{tds ? "Vendor" : "Customer"}</th><th className="py-2 pr-3">PAN</th>{tds && <th className="py-2 pr-3">Section</th>}
                  <th className="py-2 pr-3">Document</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3 text-right">Rate</th><th className="py-2 text-right">{tds ? "TDS" : "TCS"}</th>
                </tr></thead>
                <tbody>{d.entries.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{tds ? e.vendorName : e.customerName}</td><td className="py-2 pr-3 font-mono text-xs">{e.pan ?? "—"}</td>{tds && <td className="py-2 pr-3">{e.section}</td>}
                    <td className="py-2 pr-3">{tds ? e.billNumber : e.invoiceNumber}</td><td className="py-2 pr-3">{formatDate(e.date)}</td>
                    <td className="py-2 pr-3 text-right">{formatCurrency(tds ? e.taxable : e.amount)}</td><td className="py-2 pr-3 text-right">{e.rate}%</td><td className="py-2 text-right font-medium">{formatCurrency(tds ? e.tds : e.tcs)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
