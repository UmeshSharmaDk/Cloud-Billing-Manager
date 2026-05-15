import { useRoute, useLocation } from "wouter";
import { useGetCustomer, useUpdateCustomer } from "@workspace/api-client-react";
import { formatCurrency, formatDate, statusBadge } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Edit2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

export default function CustomerDetailPage() {
  const [, params] = useRoute("/customers/:id");
  const [, setLocation] = useLocation();
  const { data, isLoading, refetch } = useGetCustomer(parseInt(params?.id || "0"));
  const mutation = useUpdateCustomer();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  const c: any = data || {};
  useEffect(() => { if (c.id) setForm(c); }, [c.id]);
  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleSave = () => {
    mutation.mutate({ id: parseInt(params?.id || "0"), data: form as any }, {
      onSuccess: () => { toast({ title: "Customer updated!" }); setEditing(false); refetch(); },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    });
  };

  if (isLoading) return <div className="space-y-4 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}</div>;

  const invoices: any[] = c.recentInvoices || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/customers")}><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold">{c.name}</h1>
            {c.gstin && <p className="text-muted-foreground text-sm font-mono">GSTIN: {c.gstin}</p>}
          </div>
        </div>
        {!editing ? (
          <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}><Edit2 className="w-4 h-4" /> Edit</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setEditing(false); setForm(c); }}>Cancel</Button>
            <Button className="gap-2" onClick={handleSave} disabled={mutation.isPending}><Save className="w-4 h-4" />{mutation.isPending ? "Saving..." : "Save"}</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Customer Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {editing ? (
                <>
                  <div className="sm:col-span-2 space-y-1"><Label className="text-xs">Business Name</Label><Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">GSTIN</Label><Input value={form.gstin || ""} onChange={(e) => set("gstin", e.target.value.toUpperCase())} className="font-mono" /></div>
                  <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Email</Label><Input type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">City</Label><Input value={form.city || ""} onChange={(e) => set("city", e.target.value)} /></div>
                  <div className="sm:col-span-2 space-y-1"><Label className="text-xs">Address</Label><Input value={form.address || ""} onChange={(e) => set("address", e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">Credit Limit (₹)</Label><Input type="number" value={form.creditLimit || ""} onChange={(e) => set("creditLimit", e.target.value)} /></div>
                </>
              ) : (
                <>
                  <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{c.phone || "-"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium">{c.email || "-"}</p></div>
                  <div className="sm:col-span-2"><p className="text-xs text-muted-foreground">Address</p><p className="font-medium">{[c.address, c.city, c.state, c.pincode].filter(Boolean).join(", ") || "-"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Credit Limit</p><p className="font-medium">{formatCurrency(c.creditLimit)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Outstanding</p><p className={`font-semibold ${c.outstandingBalance > 0 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(c.outstandingBalance)}</p></div>
                </>
              )}
            </CardContent>
          </Card>

          {invoices.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Recent Invoices</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {invoices.map((inv: any) => (
                    <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                      <div><p className="text-sm font-medium">{inv.invoiceNumber}</p><p className="text-xs text-muted-foreground">{formatDate(inv.invoiceDate)}</p></div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatCurrency(inv.totalAmount)}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusBadge(inv.paymentStatus)}`}>{inv.paymentStatus}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Account Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Total Billed</span><span className="font-semibold">{formatCurrency(c.totalBilled)}</span></div>
              <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Total Paid</span><span className="font-semibold text-emerald-600">{formatCurrency(c.totalPaid)}</span></div>
              <div className="flex justify-between py-1"><span className="text-muted-foreground">Outstanding</span><span className={`font-bold ${parseFloat(c.outstandingBalance) > 0 ? "text-red-600" : "text-emerald-600"}`}>{formatCurrency(c.outstandingBalance)}</span></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
