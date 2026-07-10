import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useListVendors, useListProducts, useCreatePurchase } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/utils";
import { parsePdfPurchaseBill } from "@/lib/pdf-parser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, ArrowLeft, Upload, FileText, AlertCircle, Loader2 } from "lucide-react";

interface LineItem { productId: number | null; description: string; hsnCode: string; quantity: number; unit: string; unitPrice: number; gstRate: number; }
const emptyItem = (): LineItem => ({ productId: null, description: "", hsnCode: "", quantity: 1, unit: "Nos", unitPrice: 0, gstRate: 18 });
function calcLine(item: LineItem) { const taxable = item.quantity * item.unitPrice; const gstAmt = (taxable * item.gstRate) / 100; return { taxable, gstAmt, total: taxable + gstAmt }; }

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
  const [pdfWarnings, setPdfWarnings] = useState<string[]>([]);
  const [pdfFile, setPdfFile] = useState<string | null>(null);
  const [pdfParsing, setPdfParsing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mutation = useCreatePurchase();

  const setItem = (i: number, update: Partial<LineItem>) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...update } : it));
  const selectProduct = (i: number, productId: string) => {
    const p = products.find(pr => String(pr.id) === productId);
    if (p) setItem(i, { productId: p.id, description: p.name, hsnCode: p.hsnCode || "", unit: p.unit || "Nos", unitPrice: parseFloat(p.purchasePrice) || 0, gstRate: parseFloat(p.gstRate) || 18 });
  };

  const handlePdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "Please select a PDF file", variant: "destructive" });
      return;
    }
    setPdfFile(file.name);
    setPdfParsing(true);
    setPdfWarnings([]);
    try {
      const result = await parsePdfPurchaseBill(file, products);
      if (result.items.length === 0) {
        toast({ title: "Could not extract line items", description: result.warnings[0] || "Try a different PDF, or add items manually", variant: "destructive" });
        setPdfWarnings(result.warnings);
        return;
      }
      const parsedItems: LineItem[] = result.items.map(it => {
        const matched = products.find(p => p.name.toLowerCase().trim() === it.description.toLowerCase().trim());
        return {
          productId: matched?.id ?? null,
          description: it.description,
          hsnCode: it.hsnCode || matched?.hsnCode || "",
          quantity: it.quantity,
          unit: matched?.unit || "Nos",
          unitPrice: it.unitPrice,
          gstRate: it.gstRate ?? (matched ? parseFloat(matched.gstRate) : 18),
        };
      });
      setItems(parsedItems);
      setPdfWarnings(result.warnings);
      if (result.detected.billNumber) setForm(f => ({ ...f, billNumber: result.detected.billNumber! }));
      if (result.detected.billDate) setForm(f => ({ ...f, billDate: result.detected.billDate! }));
      toast({
        title: `Extracted ${parsedItems.length} item(s) from PDF`,
        description: result.warnings.length ? `${result.warnings.length} warning(s) — review below` : "Review the extracted items before saving",
      });
    } catch (err) {
      toast({ title: "Failed to read PDF", description: "The file may be corrupted or password-protected", variant: "destructive" });
    } finally {
      setPdfParsing(false);
    }
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
        {/* PDF Import Button */}
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handlePdf} />
          <Button type="button" variant="outline" className="gap-2" onClick={() => fileRef.current?.click()} disabled={pdfParsing}>
            {pdfParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {pdfParsing ? "Reading PDF..." : "Import from PDF"}
          </Button>
        </div>
      </div>

      {/* PDF info tooltip */}
      <Card className="bg-blue-50/60 border-blue-200">
        <CardContent className="p-3 flex items-start gap-2">
          <FileText className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <div className="text-xs text-blue-700">
            <span className="font-semibold">Import from PDF:</span> Upload a vendor bill PDF and we'll automatically extract the description, quantity, price, HSN code and GST rate for each line item. Matched products will have their inventory updated automatically on save. Works best with text-based (not scanned/image) PDFs.
          </div>
        </CardContent>
      </Card>

      {pdfWarnings.length > 0 && (
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-amber-700 text-xs font-semibold mb-1"><AlertCircle className="w-4 h-4" /> PDF Import Warnings</div>
            <ul className="text-xs text-amber-600 space-y-0.5 list-disc list-inside">
              {pdfWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {pdfFile && <p className="text-xs text-muted-foreground">Imported from: <span className="font-mono">{pdfFile}</span> — please review extracted items below before saving.</p>}

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
