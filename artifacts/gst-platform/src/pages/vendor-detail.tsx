import { useRoute, useLocation } from "wouter";
import { useGetVendor, useUpdateVendor } from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Edit2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

export default function VendorDetailPage() {
  const [, params] = useRoute("/vendors/:id");
  const [, setLocation] = useLocation();
  const { data, isLoading, refetch } = useGetVendor(parseInt(params?.id || "0"));
  const mutation = useUpdateVendor();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  const v: any = data || {};
  useEffect(() => { if (v.id) setForm(v); }, [v.id]);
  const set = (k: string, val: string) => setForm((f: any) => ({ ...f, [k]: val }));

  const handleSave = () => {
    mutation.mutate({ id: parseInt(params?.id || "0"), data: form as any }, {
      onSuccess: () => { toast({ title: "Vendor updated!" }); setEditing(false); refetch(); },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    });
  };

  if (isLoading) return <div className="space-y-4 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/vendors")}><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold">{v.name}</h1>
            {v.gstin && <p className="text-muted-foreground text-sm font-mono">GSTIN: {v.gstin}</p>}
          </div>
        </div>
        {!editing ? (
          <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}><Edit2 className="w-4 h-4" /> Edit</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditing(false); setForm(v); }}>Cancel</Button>
            <Button className="gap-2" onClick={handleSave} disabled={mutation.isPending}><Save className="w-4 h-4" />{mutation.isPending ? "Saving..." : "Save"}</Button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Vendor Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {editing ? (
            <>
              <div className="sm:col-span-2 space-y-1"><Label className="text-xs">Business Name</Label><Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">GSTIN</Label><Input value={form.gstin || ""} onChange={(e) => set("gstin", e.target.value.toUpperCase())} className="font-mono" /></div>
              <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Email</Label><Input type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">City</Label><Input value={form.city || ""} onChange={(e) => set("city", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Payment Terms</Label><Input value={form.paymentTerms || ""} onChange={(e) => set("paymentTerms", e.target.value)} /></div>
            </>
          ) : (
            <>
              <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{v.phone || "-"}</p></div>
              <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium">{v.email || "-"}</p></div>
              <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Address</p><p className="font-medium">{[v.address, v.city, v.state, v.pincode].filter(Boolean).join(", ") || "-"}</p></div>
              <div><p className="text-xs text-muted-foreground">Payment Terms</p><p className="font-medium">{v.paymentTerms || "-"}</p></div>
              {v.bankName && <div><p className="text-xs text-muted-foreground">Bank</p><p className="font-medium">{v.bankName} ({v.bankIfsc})</p></div>}
            </>
          )}
        </CardContent>
      </Card>

      {v.recentPurchases && v.recentPurchases.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent Purchases</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {v.recentPurchases.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div><p className="text-sm font-medium">{p.billNumber}</p><p className="text-xs text-muted-foreground">{formatDate(p.billDate)}</p></div>
                  <p className="text-sm font-semibold">{formatCurrency(p.totalAmount)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
