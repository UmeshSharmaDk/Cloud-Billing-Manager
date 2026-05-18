import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useListVendors, useListProducts, useCreatePurchase } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, ArrowLeft, Upload, FileText, AlertCircle } from "lucide-react";

interface LineItem { productId: number | null; description: string; hsnCode: string; quantity: number; unit: string; unitPrice: number; gstRate: number; }
const emptyItem = (): LineItem => ({ productId: null, description: "", hsnCode: "", quantity: 1, unit: "Nos", unitPrice: 0, gstRate: 18 });
function calcLine(item: LineItem) { const taxable = item.quantity * item.unitPrice; const gstAmt = (taxable * item.gstRate) / 100; return { taxable, gstAmt, total: taxable + gstAmt }; }

// Parse CSV and match products by name/SKU
function parseCSV(text: string, products: any[]): { items: LineItem[]; warnings: string[] } {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { items: [], warnings: ["CSV must have a header row and at least one data row"] };

  const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const colIdx = (names: string[]) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };

  const descCol = colIdx(["description", "name", "product", "item", "productname", "itemname"]);
  const qtyCol = colIdx(["qty", "quantity", "units"]);
  const priceCol = colIdx(["price", "rate", "unitprice", "cost", "purchaseprice", "amount"]);
  const hsnCol = colIdx(["hsn", "hsncode", "hsnno"]);
  const gstCol = colIdx(["gst", "gstrate", "gstpercent", "taxrate"]);
  const unitCol = colIdx(["unit", "uom", "measuringunit"]);

  if (descCol < 0) return { items: [], warnings: ["CSV must have a 'description' or 'name' column"] };
  if (qtyCol < 0) return { items: [], warnings: ["CSV must have a 'quantity' or 'qty' column"] };
  if (priceCol < 0) return { items: [], warnings: ["CSV must have a 'price' or 'rate' column"] };

  const items: LineItem[] = [];
  const warnings: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const description = cols[descCol] || "";
    const quantity = parseFloat(cols[qtyCol] || "0");
    const unitPrice = parseFloat(cols[priceCol] || "0");
    if (!description || quantity <= 0 || unitPrice <= 0) { warnings.push(`Row ${i + 1}: Skipped (missing data)`); continue; }

    // Try to match to existing product
    const matched = products.find(p => p.name.toLowerCase().trim() === description.toLowerCase().trim() || p.sku?.toLowerCase() === description.toLowerCase());

    items.push({
      productId: matched?.id ?? null,
      description: matched?.name ?? description,
      hsnCode: hsnCol >= 0 ? (cols[hsnCol] || matched?.hsnCode || "") : (matched?.hsnCode || ""),
      quantity,
      unit: unitCol >= 0 ? (cols[unitCol] || matched?.unit || "Nos") : (matched?.unit || "Nos"),
      unitPrice,
      gstRate: gstCol >= 0 ? parseFloat(cols[gstCol] || "18") : (matched ? parseFloat(matched.gstRate || "18") : 18),
    });
    if (matched) {
      // will auto-update inventory when purchase is recorded
    } else {
      warnings.push(`Row ${i + 1}: "${description}" not found in products — will be added as new item`);
    }
  }
  return { items, warnings };
}

export default function PurchaseNewPage() {
  const [, setLocation] = useLocation();
  const { data: vendorsData } = useListVendors();
  const { data: productsData } = useListProducts();
  const vendors: any[] = (vendorsData as any)?.vendors || [];
  const products: any[] = (productsData as any)?.products || [];
  const { toast } = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ vendorId: "", billNumber: "", billDate: today, notes: "" });
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [csvFile, setCsvFile] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mutation = useCreatePurchase();

  const setItem = (i: number, update: Partial<LineItem>) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...update } : it));
  const selectProduct = (i: number, productId: string) => {
    const p = products.find(pr => String(pr.id) === productId);
    if (p) setItem(i, { productId: p.id, description: p.name, hsnCode: p.hsnCode || "", unit: p.unit || "Nos", unitPrice: parseFloat(p.purchasePrice) || 0, gstRate: parseFloat(p.gstRate) || 18 });
  };

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { items: parsed, warnings } = parseCSV(text, products);
      if (parsed.length === 0) {
        toast({ title: "CSV parse failed", description: warnings[0] || "No valid rows found", variant: "destructive" });
        return;
      }
      setItems(parsed);
      setCsvWarnings(warnings);
      toast({ title: `Imported ${parsed.length} items from CSV`, description: warnings.length ? `${warnings.length} warning(s) — see below` : "All items matched successfully" });
    };
    reader.readAsText(file);
    // Reset input so same file can be re-imported
    e.target.value = "";
  };

  const totals = items.reduce((acc, it) => { const c = calcLine(it); return { taxable: acc.taxable + c.taxable, gst: acc.gst + c.gstAmt, total: acc.total + c.total }; }, { taxable: 0, gst: 0, total: 0 });

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!form.vendorId) { toast({ title: "Select a vendor", variant: "destructive" }); return; }
    if (items.some(it => !it.description || it.unitPrice <= 0)) { toast({ title: "Fill all line items correctly", variant: "destructive" }); return; }
    mutation.mutate({
      data: {
        vendorId: parseInt(form.vendorId),
        billNumber: form.billNumber,
        billDate: form.billDate,
        notes: form.notes,
        items: items.map(it => ({
          productId: it.productId, description: it.description, hsnCode: it.hsnCode,
          quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice, gstRate: it.gstRate,
        })),
      } as any,
    }, {
      onSuccess: () => { toast({ title: "Purchase bill recorded! Inventory updated." }); setLocation("/purchases"); },
      onError: () => toast({ title: "Failed to record purchase", variant: "destructive" }),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="icon" onClick={() => setLocation("/purchases")}><ArrowLeft className="w-4 h-4" /></Button>
          <div><h1 className="text-2xl font-bold">New Purchase Bill</h1><p className="text-muted-foreground text-sm">Record a purchase to claim input tax credit and update inventory</p></div>
        </div>
        {/* CSV Import Button */}
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCSV} />
          <Button type="button" variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4" /> Import CSV
          </Button>
        </div>
      </div>

      {/* CSV info tooltip */}
      <Card className="bg-blue-50/60 border-blue-200">
        <CardContent className="p-3 flex items-start gap-2">
          <FileText className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-xs text-blue-700">
            <span className="font-semibold">Import from CSV:</span> Upload a file with columns <code className="bg-blue-100 px-1 rounded">description, quantity, price</code> (and optionally <code className="bg-blue-100 px-1 rounded">hsn, gst, unit</code>). Matched products will have their inventory updated automatically on save.
          </div>
        </CardContent>
      </Card>

      {csvWarnings.length > 0 && (
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-amber-700 text-xs font-semibold mb-1"><AlertCircle className="w-4 h-4" /> CSV Import Warnings</div>
            <ul className="text-xs text-amber-600 space-y-0.5 list-disc list-inside">
              {csvWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {csvFile && <p className="text-xs text-muted-foreground">Imported from: <span className="font-mono">{csvFile}</span></p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Bill Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-2">
                <Label>Vendor *</Label>
                <Select value={form.vendorId} onValueChange={(v) => setForm(f => ({ ...f, vendorId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select vendor..." /></SelectTrigger>
                  <SelectContent>{vendors.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}{v.gstin ? ` — ${v.gstin}` : ""}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Vendor Bill # (optional)</Label><Input value={form.billNumber} onChange={(e) => setForm(f => ({ ...f, billNumber: e.target.value }))} placeholder="VND-001" /></div>
              <div className="space-y-2"><Label>Bill Date *</Label><Input type="date" value={form.billDate} onChange={(e) => setForm(f => ({ ...f, billDate: e.target.value }))} required /></div>
              <div className="sm:col-span-2 space-y-2"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note..." /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Line Items ({items.length})</CardTitle>
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setItems(prev => [...prev, emptyItem()])}>
                <Plus className="w-3.5 h-3.5" /> Add Row
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((item, i) => {
                const c = calcLine(item);
                return (
                  <div key={i} className="border border-border rounded-lg p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Link to Product (for stock update)</Label>
                        <Select value={item.productId ? String(item.productId) : ""} onValueChange={(v) => selectProduct(i, v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select product (optional)..." /></SelectTrigger>
                          <SelectContent>{products.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Description *</Label>
                        <Input className="h-8 text-xs" value={item.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Item description" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div className="space-y-1"><Label className="text-xs">Qty</Label><Input className="h-8 text-xs" type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => setItem(i, { quantity: parseFloat(e.target.value) || 0 })} /></div>
                      <div className="space-y-1"><Label className="text-xs">Unit</Label><Input className="h-8 text-xs" value={item.unit} onChange={(e) => setItem(i, { unit: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-xs">Price (₹)</Label><Input className="h-8 text-xs" type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => setItem(i, { unitPrice: parseFloat(e.target.value) || 0 })} /></div>
                      <div className="space-y-1"><Label className="text-xs">GST %</Label>
                        <Select value={String(item.gstRate)} onValueChange={(v) => setItem(i, { gstRate: parseFloat(v) })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{[0, 5, 12, 18, 28].map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1"><Label className="text-xs">HSN</Label><Input className="h-8 text-xs font-mono" value={item.hsnCode} onChange={(e) => setItem(i, { hsnCode: e.target.value })} placeholder="Optional" /></div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Taxable: {formatCurrency(c.taxable)} · ITC: {formatCurrency(c.gstAmt)}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground text-sm">{formatCurrency(c.total)}</span>
                        {items.length > 1 && <button type="button" onClick={() => setItems(prev => prev.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </div>
                    {item.productId && <p className="text-xs text-emerald-600">✓ Inventory for this product will be updated on save</p>}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="sticky top-4">
            <CardHeader className="pb-3"><CardTitle className="text-base">Purchase Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Taxable Amount</span><span className="font-medium">{formatCurrency(totals.taxable)}</span></div>
              <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Total GST (ITC)</span><span className="font-medium text-blue-600">{formatCurrency(totals.gst)}</span></div>
              <div className="flex justify-between py-2 font-bold text-base border-t-2"><span>Total Amount</span><span>{formatCurrency(totals.total)}</span></div>
              <div className="text-xs text-muted-foreground bg-accent/40 rounded p-2">
                Products linked above will have their stock levels increased automatically.
              </div>
              <Button type="submit" className="w-full" disabled={mutation.isPending}>{mutation.isPending ? "Saving..." : "Record Purchase & Update Stock"}</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
