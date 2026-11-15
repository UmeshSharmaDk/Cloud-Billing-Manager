import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { authFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";

type Client = {
  id: number; name: string; email: string; isActive: boolean;
  business: { id: number; name: string; gstin: string | null; lockDate: string | null } | null;
  sales?: number; invoices?: number; purchases?: number; netGst?: number; receivable?: number; lastInvoiceAt?: string | null;
};

/** Consultant view: every client's month at a glance; a row opens that client. */
export function ClientsBoard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const q = useQuery({
    queryKey: ["admin-clients", month],
    queryFn: async () => {
      const res = await authFetch(`/api/admin/clients?month=${month}`);
      if (!res.ok) throw new Error("Could not load clients.");
      return (await res.json()) as { clients: Client[] };
    },
  });
  const clients = q.data?.clients ?? [];
  const sum = (k: "sales" | "purchases" | "netGst" | "receivable") => clients.reduce((n, c) => n + (c[k] ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">Clients</CardTitle>
        <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="max-w-[11rem]" />
      </CardHeader>
      <CardContent>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : q.error ? <p className="text-sm text-red-600">{(q.error as Error).message}</p>
          : !clients.length ? <p className="text-sm text-muted-foreground">No clients yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Client</th><th className="py-2 pr-3 text-right">Sales</th><th className="py-2 pr-3 text-right">Purchases</th>
                <th className="py-2 pr-3 text-right">Net GST</th><th className="py-2 pr-3 text-right">Owed to them</th><th className="py-2">Last invoice</th>
              </tr></thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-2 pr-3">
                      <Link href={`/admin/users/${c.id}`} className="font-medium hover:underline">{c.business?.name ?? c.name}</Link>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        {c.name}{c.business?.gstin ? ` · ${c.business.gstin}` : ""}{!c.isActive && " · inactive"}
                        {c.business?.lockDate && <span className="inline-flex items-center gap-0.5"> · <Lock className="h-3 w-3" /> {formatDate(c.business.lockDate)}</span>}
                      </p>
                    </td>
                    <td className="py-2 pr-3 text-right">{formatCurrency(c.sales ?? 0)}<p className="text-xs text-muted-foreground">{c.invoices ?? 0} invoices</p></td>
                    <td className="py-2 pr-3 text-right">{formatCurrency(c.purchases ?? 0)}</td>
                    <td className="py-2 pr-3 text-right">{formatCurrency(c.netGst ?? 0)}</td>
                    <td className="py-2 pr-3 text-right">{formatCurrency(c.receivable ?? 0)}</td>
                    <td className="py-2 text-xs text-muted-foreground">{c.lastInvoiceAt ? formatDate(c.lastInvoiceAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t font-semibold">
                <td className="py-2 pr-3">All clients</td><td className="py-2 pr-3 text-right">{formatCurrency(sum("sales"))}</td>
                <td className="py-2 pr-3 text-right">{formatCurrency(sum("purchases"))}</td><td className="py-2 pr-3 text-right">{formatCurrency(sum("netGst"))}</td>
                <td className="py-2 pr-3 text-right">{formatCurrency(sum("receivable"))}</td><td />
              </tr></tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
