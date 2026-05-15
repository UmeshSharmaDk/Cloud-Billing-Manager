import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateProduct } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

const GST_RATES = [0, 5, 12, 18, 28];
const UNITS = ["Nos", "Kg", "Box", "Set", "Pair", "Ltr", "Mtr", "Pcs", "Roll"];

export default function ProductNewPage() {
  const [, setLocation] = useLocation();
  const mutation = useCreateProduct();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", sku: "", hsnCode: "", unit: "Nos", category: "", purchasePrice: "", sellingPrice: "", gstRate: "18", stockQuantity: "0", lowStockThreshold: "10" });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      data: { ...form, purchasePrice: parseFloat(form.purchasePrice) || 0, sellingPrice: parseFloat(form.sellingPrice) || 0, gstRate: parseFloat(form.gstRate) || 18, stockQuantity: parseFloat(form.stockQuantity) || 0, lowStockThreshold: parseFloat(form.lowStockThreshold) || 10 } as any,
    }, {
      onSuccess: () => { toast({ title: "Product added to inventory!" }); setLocation("/inventory"); },
      onError: () => toast({ title: "Failed to add product", variant: "destructive" }),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="icon" onClick={() => setLocation("/inventory")}><ArrowLeft className="w-4 h-4" /></Button>
        <div><h1 className="text-2xl font-bold">Add Product</h1><p className="text-muted-foreground text-sm">Add a new product or service to your inventory</p></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Product Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 space-y-2"><Label>Product Name *</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Industrial Grade Bolts (M10x50)" required /></div>
            <div className="space-y-2"><Label>SKU Code</Label><Input value={form.sku} onChange={(e) => set("sku", e.target.value.toUpperCase())} placeholder="SKU-BOLT-M10" className="font-mono" /></div>
            <div className="space-y-2"><Label>HSN Code</Label><Input value={form.hsnCode} onChange={(e) => set("hsnCode", e.target.value)} placeholder="73181590" className="font-mono" /></div>
            <div className="space-y-2"><Label>Unit</Label><Select value={form.unit} onValueChange={(v) => set("unit", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Category</Label><Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Hardware" /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Pricing & Stock</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Purchase Price (₹)</Label><Input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} placeholder="450.00" /></div>
            <div className="space-y-2"><Label>Selling Price (₹)</Label><Input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => set("sellingPrice", e.target.value)} placeholder="680.00" /></div>
            <div className="space-y-2"><Label>GST Rate</Label><Select value={form.gstRate} onValueChange={(v) => set("gstRate", v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{GST_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Opening Stock</Label><Input type="number" min="0" step="0.01" value={form.stockQuantity} onChange={(e) => set("stockQuantity", e.target.value)} /></div>
            <div className="space-y-2"><Label>Low Stock Alert</Label><Input type="number" min="0" value={form.lowStockThreshold} onChange={(e) => set("lowStockThreshold", e.target.value)} /></div>
          </CardContent>
        </Card>
      </div>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => setLocation("/inventory")}>Cancel</Button>
        <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving..." : "Add Product"}</Button>
      </div>
    </form>
  );
}
