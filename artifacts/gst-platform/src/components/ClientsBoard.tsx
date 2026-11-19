import { useState } from "react";
import { RowsSkeleton } from "@/components/ui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
  overdue?: number; filings?: Partial<Record<Form, { filedAt: string; arn: string | null }>>;
};
type Form = "GSTR-1" | "GSTR-3B";
const FORMS: Form[] = ["GSTR-1", "GSTR-3B"];

/** Monthly due dates: GSTR-1 on the 11th, GSTR-3B on the 20th of the next month. */
function dueDate(month: string, form: Form): string {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return `${next}-${form === "GSTR-1" ? "11" : "20"}`;
}

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
  const qc = useQueryClient();
  const mark = useMutation({
    mutationFn: async ({ id, form, filed }: { id: number; form: Form; filed: boolean }) => {
      const res = await authFetch(`/api/admin/users/${id}/filings`, { method: "PUT", body: JSON.stringify({ period: month, form, filed }) });
      if (!res.ok) throw new Error("Could not update the return.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-clients", month] }),
  });
  const today = new Date().toISOString().slice(0, 10);
  const clients = q.data?.clients ?? [];
  const pendingReturns = clients.reduce((n, c) => n + (c.business ? FORMS.filter((f) => !c.filings?.[f]).length : 0), 0);
  const sum = (k: "sales" | "purchases" | "netGst" | "receivable") => clients.reduce((n, c) => n + (c[k] ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-base">Clients</CardTitle>
          {!q.isLoading && clients.length > 0 && <p className="text-xs text-muted-foreground">{pendingReturns} returns not marked filed for this month</p>}
        </div>
        <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="max-w-[11rem]" />
      </CardHeader>
      <CardContent>
        {q.isLoading ? <RowsSkeleton rows={5} /> : q.error ? <p className="text-sm text-danger">{(q.error as Error).message}</p>
          : !clients.length ? <p className="text-sm text-muted-foreground">No clients yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">Client</th><th className="py-2 pr-3 text-right">Sales</th><th className="py-2 pr-3 text-right">Purchases</th>
                <th className="py-2 pr-3 text-right">Net GST</th><th className="py-2 pr-3 text-right">Owed to them</th>
                {FORMS.map((f) => <th key={f} className="py-2 pr-3">{f}</th>)}<th className="py-2">Last invoice</th>
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
                    <td className="py-2 pr-3 text-right">{formatCurrency(c.receivable ?? 0)}
                      {!!c.overdue && <p className="text-xs text-danger-text">{c.overdue} overdue</p>}</td>
                    {FORMS.map((f) => {
                      const filed = c.filings?.[f];
                      const due = dueDate(month, f);
                      const busy = mark.isPending && mark.variables?.id === c.id && mark.variables.form === f;
                      if (!c.business) return <td key={f} className="py-2 pr-3 text-xs text-muted-foreground">No business</td>;
                      return (
                        <td key={f} className="py-2 pr-3 text-xs">
                          {filed ? (
                            <div className="flex items-center gap-1">
                              <span className="text-success-text">Filed {formatDate(filed.filedAt)}</span>
                              <Button variant="ghost" size="sm" loading={busy} aria-label={`Mark ${f} not filed`} onClick={() => mark.mutate({ id: c.id, form: f, filed: false })}>Undo</Button>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <p className={due < today ? "text-danger-text" : "text-muted-foreground"}>{due < today ? "Overdue since" : "Due"} {formatDate(due)}</p>
                              <Button variant="outline" size="sm" loading={busy} onClick={() => mark.mutate({ id: c.id, form: f, filed: true })}>Mark {f} filed</Button>
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2 text-xs text-muted-foreground">{c.lastInvoiceAt ? formatDate(c.lastInvoiceAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t font-semibold">
                <td className="py-2 pr-3">All clients</td><td className="py-2 pr-3 text-right">{formatCurrency(sum("sales"))}</td>
                <td className="py-2 pr-3 text-right">{formatCurrency(sum("purchases"))}</td><td className="py-2 pr-3 text-right">{formatCurrency(sum("netGst"))}</td>
                <td className="py-2 pr-3 text-right">{formatCurrency(sum("receivable"))}</td><td /><td /><td />
              </tr></tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
