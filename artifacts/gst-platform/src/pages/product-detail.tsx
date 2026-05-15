import { useRoute, useLocation } from "wouter";
import { useGetProduct, useUpdateProduct } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Edit2, Save, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

const GST_RATES = [0, 5, 12, 18, 28];
const UNITS = ["Nos", "Kg", "Box", "Set", "Pair", "Ltr", "Mtr", "Pcs", "Roll"];

export default function ProductDetailPage() {
  const [, params] = useRoute("/inventory/:id");
  const [, setLocation] = useLocation();
  const { data, isLoading, refetch } = useGetProduct(parseInt(params?.id || "0"));
  const mutation = useUpdateProduct();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  const p: any = data || {};
  useEffect(() => {
    if (p.id) setForm({ ...p, gstRate: String(p.gstRate || 18), purchasePrice: String(p.purchasePrice || 0), sellingPrice: String(p.sellingPrice || 0), stockQuantity: String(p.stockQuantity || 0), lowStockThreshold: String(p.lowStockThreshold || 10) });
  }, [p.id]);

  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleSave = () => {
    mutation.mutate({ id: parseInt(params?.id || "0"), data: { ...form, purchasePrice: parseFloat(form.purchasePrice), sellingPrice: parseFloat(form.sellingPrice), gstRate: parseFloat(form.gstRate), stockQuantity: parseFloat(form.stockQuantity), lowStockThreshold: parseFloat(form.lowStockThreshold) } as any }, {
      onSuccess: () => { toast({ title: "Product updated!" }); setEditing(false); refetch(); },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    });
  };

  if (isLoading) return <div className="space-y-4 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}</div>;

  const isLow = p.stockQuantity <= p.lowStockThreshold;
  const isOut = p.stockQuantity <= 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/inventory")}><ArrowLeft className="w-4 h-4" /></Button>
          <div><h1 className="text-2xl font-bold">{p.name}</h1><p className="text-muted-foreground text-sm font-mono">{p.sku}</p></div>
        </div>
        {!editing ? (
          <Button variant="outline" className="gap-2" onClick={() => setEditing(true)}><Edit2 className="w-4 h-4" /> Edit</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button className="gap-2" onClick={handleSave} disabled={mutation.isPending}><Save className="w-4 h-4" />{mutation.isPending ? "Saving..." : "Save"}</Button>
          </div>
        )}
      </div>

      {(isOut || isLow) && !editing && (
        <div className={`flex items-center gap-2 p-3 rounded-lg border ${isOut ? "bg-red-50 border-red-200 text-red-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm font-medium">{isOut ? "Out of stock! Reorder immediately." : `Low stock — only ${p.stockQuantity} ${p.unit} remaining (min: ${p.lowStockThreshold})`}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Product Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {editing ? (
              <>
                <div className="sm:col-span-2 space-y-1"><Label className="text-xs">Product Name</Label><Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">SKU</Label><Input value={form.sku || ""} onChange={(e) => set("sku", e.target.value.toUpperCase())} className="font-mono" /></div>
                <div className="space-y-1"><Label className="text-xs">HSN Code</Label><Input value={form.hsnCode || ""} onChange={(e) => set("hsnCode", e.target.value)} className="font-mono" /></div>
                <div className="space-y-1"><Label className="text-xs">Unit</Label><Select value={form.unit || "Nos"} onValueChange={(v) => set("unit", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label className="text-xs">Category</Label><Input value={form.category || ""} onChange={(e) => set("category", e.target.value)} /></div>
              </>
            ) : (
              <>
                <div><p className="text-xs text-muted-foreground">HSN Code</p><p className="font-medium font-mono">{p.hsnCode || "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Unit</p><p className="font-medium">{p.unit}</p></div>
                <div><p className="text-xs text-muted-foreground">Category</p><p className="font-medium">{p.category || "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">GST Rate</p><p className="font-semibold text-primary">{p.gstRate}%</p></div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Pricing & Stock</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {editing ? (
              <>
                <div className="space-y-1"><Label className="text-xs">Purchase Price (₹)</Label><Input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Selling Price (₹)</Label><Input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => set("sellingPrice", e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">GST Rate</Label><Select value={form.gstRate} onValueChange={(v) => set("gstRate", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{GST_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label className="text-xs">Current Stock</Label><Input type="number" min="0" step="0.01" value={form.stockQuantity} onChange={(e) => set("stockQuantity", e.target.value)} /></div>
                <div className="space-y-1"><Label className="text-xs">Low Stock Min</Label><Input type="number" min="0" value={form.lowStockThreshold} onChange={(e) => set("lowStockThreshold", e.target.value)} /></div>
              </>
            ) : (
              <>
                <div><p className="text-xs text-muted-foreground">Purchase Price</p><p className="font-semibold">{formatCurrency(p.purchasePrice)}</p></div>
                <div><p className="text-xs text-muted-foreground">Selling Price</p><p className="font-semibold text-primary">{formatCurrency(p.sellingPrice)}</p></div>
                <div><p className="text-xs text-muted-foreground">Margin</p><p className="font-medium text-emerald-600">{p.purchasePrice > 0 ? `${(((p.sellingPrice - p.purchasePrice) / p.purchasePrice) * 100).toFixed(1)}%` : "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Current Stock</p><p className={`font-bold text-lg ${isOut ? "text-red-600" : isLow ? "text-amber-600" : "text-emerald-600"}`}>{p.stockQuantity} {p.unit}</p></div>
                <div><p className="text-xs text-muted-foreground">Min. Stock</p><p className="font-medium">{p.lowStockThreshold} {p.unit}</p></div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
