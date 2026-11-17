import { useState } from "react";
import { RowsSkeleton, Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate, statusBadge } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Tab = "invoices" | "purchases" | "reports";
type Row = { id: number; invoiceNumber: string; customerName?: string; vendorName?: string; invoiceDate: string; grandTotal: number; status: string };

/** GET one of the user's endpoints through the admin's read-only `asUser` view. */
async function viewAs<T>(path: string, userId: number, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, asUser: String(userId) });
  const res = await authFetch(`/api${path}?${qs}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Could not load records.");
  return data as T;
}

/** An admin's read-only look at one user's invoices, purchases and monthly GST summary. */
export function UserRecords({ userId }: { userId: number }) {
  const [tab, setTab] = useState<Tab>("invoices");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [year, mon] = month.split("-");

  const list = useQuery({
    queryKey: ["asUser", userId, tab],
    enabled: tab !== "reports",
    queryFn: () => viewAs<Record<string, Row[]>>(`/${tab}`, userId, { limit: "100" }),
  });
  const report = useQuery({
    queryKey: ["asUser", userId, "gstr3b", month],
    enabled: tab === "reports" && !!year && !!mon,
    queryFn: () => viewAs<Record<string, number>>("/reports/gstr3b", userId, { month: String(Number(mon)), year }),
  });

  const rows = list.data?.[tab] ?? [];
  const r = report.data;
  const error = (tab === "reports" ? report.error : list.error) as Error | null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Records (view only)</CardTitle>
        <div className="flex gap-2 pt-2">
          {(["invoices", "purchases", "reports"] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 text-sm capitalize ${tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{t}</button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {error ? <p className="text-sm text-danger">{error.message}</p> : tab === "reports" ? (
          <div className="space-y-4">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="max-w-[12rem]" />
            {report.isLoading ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="status" aria-label="Loading">{[0, 1, 2, 3].map((i) => <div key={i} className="rounded-lg border p-3 space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-4 w-24" /></div>)}</div> : r && (
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ["Taxable sales", r.outwardTaxable],
                  ["Output GST", Number(r.outwardCgst) + Number(r.outwardSgst) + Number(r.outwardIgst)],
                  ["Input GST", Number(r.inputCgst) + Number(r.inputSgst) + Number(r.inputIgst)],
                  ["Net GST payable", r.totalTax],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-semibold">{formatCurrency(value as number)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : list.isLoading ? <RowsSkeleton rows={5} /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No {tab} yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Number</th><th className="py-2 pr-3">{tab === "invoices" ? "Customer" : "Vendor"}</th>
                <th className="py-2 pr-3">Date</th><th className="py-2 pr-3 text-right">Total</th><th className="py-2">Status</th>
              </tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{row.invoiceNumber}</td>
                  <td className="py-2 pr-3">{row.customerName ?? row.vendorName}</td>
                  <td className="py-2 pr-3">{formatDate(row.invoiceDate)}</td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(row.grandTotal)}</td>
                  <td className="py-2"><span className={`rounded-full border px-2 py-0.5 text-xs ${statusBadge(row.status)}`}>{row.status}</span></td>
                </tr>
              ))}</tbody>
            </table>
            {rows.length === 100 && <p className="pt-2 text-xs text-muted-foreground">Showing the latest 100.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
