import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Lock, LockOpen } from "lucide-react";

type Entry = { id: number; actorEmail: string; action: string; targetType: string; details: Record<string, any>; createdAt: string };

const VERB: Record<string, string> = { created: "created", updated: "edited", deleted: "deleted", status_changed: "changed status of" };
const NOUN: Record<string, string> = { invoice: "invoice", purchase: "purchase", payment: "payment", eway_bill: "e-way bill" };

/** One audit row as a sentence an admin can read. */
export function describeAudit(e: Entry): string {
  const [kind, act] = e.action.split(".");
  const d = e.details ?? {};
  if (NOUN[kind]) {
    const what = [NOUN[kind], d.number].filter(Boolean).join(" ");
    return `${VERB[act] ?? act} ${what}${d.status && act === "status_changed" ? ` → ${d.status}` : ""}`;
  }
  if (e.action === "business.lock_date_changed") return d.after ? `froze books up to ${formatDate(d.after)}` : "unfroze the books";
  return e.action.replace(/[._]/g, " ");
}

/** Freeze a user's books up to a date, and read their audit trail. */
export function BooksControl({ userId, lockDate }: { userId: number; lockDate: string | null }) {
  const [day, setDay] = useState(lockDate ?? "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  useEffect(() => setDay(lockDate ?? ""), [lockDate]);

  const trail = useQuery({
    queryKey: ["audit", userId],
    queryFn: async () => {
      const res = await authFetch(`/api/admin/users/${userId}/audit?limit=100`);
      if (!res.ok) throw new Error("Could not load the audit trail.");
      return (await res.json()) as { entries: Entry[]; total: number };
    },
  });

  const save = async (next: string | null) => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/admin/users/${userId}/lock-date`, { method: "PATCH", body: JSON.stringify({ lockDate: next }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not save.");
      toast({ title: next ? `Books frozen up to ${formatDate(next)}` : "Books unfrozen" });
      await qc.invalidateQueries();
    } catch (e: any) {
      toast({ title: "Not saved", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Lock className="h-4 w-4" /> Freeze transactions</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {lockDate ? `Frozen up to ${formatDate(lockDate)}.` : "Nothing is frozen."} Invoices, purchases, payments and e-way bills dated on or before the lock date can't be added, edited or cancelled. Payments can still be recorded against old invoices.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="max-w-[12rem]" />
            <Button disabled={saving || !day || day === lockDate} onClick={() => save(day)} className="gap-1"><Lock className="h-3.5 w-3.5" /> Freeze</Button>
            {lockDate && <Button variant="outline" disabled={saving} onClick={() => save(null)} className="gap-1"><LockOpen className="h-3.5 w-3.5" /> Unfreeze</Button>}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Audit trail</CardTitle></CardHeader>
        <CardContent className="max-h-80 overflow-y-auto text-sm">
          {trail.isLoading ? <p className="text-muted-foreground">Loading…</p> : trail.error ? <p className="text-danger">{(trail.error as Error).message}</p>
            : !trail.data?.entries.length ? <p className="text-muted-foreground">No changes recorded yet.</p> : (
              <ul className="divide-y">
                {trail.data.entries.map((e) => (
                  <li key={e.id} className="py-2">
                    <p><span className="font-medium">{e.actorEmail}</span> {describeAudit(e)}</p>
                    <p className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString("en-IN")}</p>
                  </li>
                ))}
              </ul>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
