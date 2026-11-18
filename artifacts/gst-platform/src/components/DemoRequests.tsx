import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/api-fetch";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RowsSkeleton } from "@/components/ui/skeleton";

type DemoRequest = {
  id: number; name: string; phone: string; email: string | null; city: string | null;
  businessType: string; clientCount: number | null; message: string | null; status: string; createdAt: string;
};
const when = (v: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(v));

/** Superadmin: "Book a demo" requests from the website, newest first. */
export function DemoRequests() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["demo-requests"],
    queryFn: async () => {
      const res = await authFetch("/api/demo-requests");
      if (!res.ok) throw new Error("Could not load demo requests.");
      return ((await res.json()) as { requests: DemoRequest[] }).requests;
    },
  });
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await authFetch(`/api/demo-requests/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      if (!res.ok) throw new Error("Could not update the request.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["demo-requests"] }),
  });
  const open = (q.data ?? []).filter((r) => r.status !== "closed");

  return (
    <section className="space-y-4">
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[.15em] text-muted-foreground">From the website</p>
        <h2 className="text-xl font-semibold tracking-tight">Demo requests · {open.length} open</h2>
      </div>
      <Card className="overflow-hidden rounded-xl">
        {q.isLoading ? <div className="p-5"><RowsSkeleton rows={3} /></div>
          : q.error ? <p className="p-5 text-sm text-danger">{(q.error as Error).message}</p>
          : !open.length ? <p className="p-5 text-sm text-muted-foreground">No open requests. New ones from the Book a demo page appear here and are emailed to you.</p>
          : <div className="divide-y divide-border">{open.map((r) => (
            <div key={r.id} className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-start">
              <div className="min-w-0 text-sm">
                <p className="font-semibold">{r.name} <span className="font-normal text-muted-foreground">· {r.businessType}{r.clientCount ? ` · ${r.clientCount} clients or branches` : ""}</span></p>
                <p className="mt-1"><a className="inline-flex min-h-11 items-center hover:underline" href={`tel:${r.phone.replace(/\s/g, "")}`}>{r.phone}</a>{r.email && <> · <a className="hover:underline" href={`mailto:${r.email}`}>{r.email}</a></>}{r.city && ` · ${r.city}`}</p>
                {r.message && <p className="mt-1 text-muted-foreground">{r.message}</p>}
                <p className="mt-1 text-xs text-muted-foreground">{when(r.createdAt)} · {r.status === "new" ? "Not contacted yet" : "Contacted"}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {r.status === "new" && <Button variant="outline" size="sm" loading={setStatus.isPending && setStatus.variables?.id === r.id && setStatus.variables.status === "contacted"} onClick={() => setStatus.mutate({ id: r.id, status: "contacted" })}>Mark contacted</Button>}
                <Button variant="ghost" size="sm" loading={setStatus.isPending && setStatus.variables?.id === r.id && setStatus.variables.status === "closed"} onClick={() => setStatus.mutate({ id: r.id, status: "closed" })}>Close request</Button>
              </div>
            </div>
          ))}</div>}
      </Card>
    </section>
  );
}
