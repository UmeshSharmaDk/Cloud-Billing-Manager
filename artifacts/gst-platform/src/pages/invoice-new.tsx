import { useState } from "react";
import { useLocation } from "wouter";
import { useListCustomers, useListProducts, useCreateInvoice } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, ArrowLeft } from "lucide-react";

interface LineItem {
  productId: number | null;
  description: string;
  hsnCode: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  gstRate: number;
  discount: number;
}

const emptyItem = (): LineItem => ({ productId: null, description: "", hsnCode: "", quantity: 1, unit: "Nos", unitPrice: 0, gstRate: 18, discount: 0 });

function calcLine(item: LineItem) {
  const subtotal = item.quantity * item.unitPrice;
  const discAmt = (subtotal * item.discount) / 100;
  const taxable = subtotal - discAmt;
  const gstAmt = (taxable * item.gstRate) / 100;
  return { subtotal, discAmt, taxable, gstAmt, total: taxable + gstAmt };
}

export default function InvoiceNewPage() {
  const [, setLocation] = useLocation();
  const { data: customersData } = useListCustomers();
  const { data: productsData } = useListProducts();
  const customers: any[] = (customersData as any)?.customers || [];
  const products: any[] = (productsData as any)?.products || [];
  const { toast } = useToast();

  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const [form, setForm] = useState({ customerId: "", invoiceDate: today, dueDate: due, placeOfSupply: "", notes: "" });
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);
  const mutation = useCreateInvoice();

  const selectedCustomer = customers.find(c => String(c.id) === form.customerId);

  const setItem = (i: number, update: Partial<LineItem>) => {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...update } : it));
  };

  const selectProduct = (i: number, productId: string) => {
    const p = products.find(pr => String(pr.id) === productId);
    if (p) setItem(i, { productId: p.id, description: p.name, hsnCode: p.hsnCode || "", unit: p.unit || "Nos", unitPrice: parseFloat(p.sellingPrice) || 0, gstRate: parseFloat(p.gstRate) || 18 });
  };

  const totals = items.reduce((acc, item) => {
    const c = calcLine(item);
    return { taxable: acc.taxable + c.taxable, gst: acc.gst + c.gstAmt, total: acc.total + c.total };
  }, { taxable: 0, gst: 0, total: 0 });

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!form.customerId) { toast({ title: "Select a customer", variant: "destructive" }); return; }
    if (items.some(it => !it.description || it.unitPrice <= 0)) { toast({ title: "Fill all line items correctly", variant: "destructive" }); return; }

    mutation.mutate({
      data: {
        customerId: parseInt(form.customerId),
        invoiceDate: form.invoiceDate,
        dueDate: form.dueDate,
        placeOfSupply: form.placeOfSupply || selectedCustomer?.stateCode || "",
        notes: form.notes,
        items: items.map(it => ({ productId: it.productId, description: it.description, hsnCode: it.hsnCode, quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice, gstRate: it.gstRate, discount: it.discount })),
      } as any,
    }, {
      onSuccess: (data: any) => {
        toast({ title: "Invoice created!", description: `${data.invoice?.invoiceNumber || "Invoice"} generated.` });
        setLocation("/invoices");
      },
      onError: () => toast({ title: "Failed to create invoice", variant: "destructive" }),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="icon" onClick={() => setLocation("/invoices")}><ArrowLeft className="w-4 h-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold">New Sales Invoice</h1>
          <p className="text-muted-foreground text-sm">Create a GST-compliant sales invoice</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Invoice Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-2">
                <Label>Customer *</Label>
                <Select value={form.customerId} onValueChange={(v) => setForm(f => ({ ...f, customerId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select customer..." /></SelectTrigger>
                  <SelectContent>
                    {customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}{c.gstin ? ` — ${c.gstin}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                {selectedCustomer && (
                  <div className="text-xs text-muted-foreground bg-accent/50 rounded p-2">
                    {selectedCustomer.address}, {selectedCustomer.city}, {selectedCustomer.state} {selectedCustomer.stateCode ? `(${selectedCustomer.stateCode})` : ""}
                  </div>
                )}
              </div>
              <div className="space-y-2"><Label>Invoice Date *</Label><Input type="date" value={form.invoiceDate} onChange={(e) => setForm(f => ({ ...f, invoiceDate: e.target.value }))} required /></div>
              <div className="space-y-2"><Label>Due Date</Label><Input type="date" value={form.dueDate} onChange={(e) => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Place of Supply (State Code)</Label><Input value={form.placeOfSupply} onChange={(e) => setForm(f => ({ ...f, placeOfSupply: e.target.value }))} placeholder={selectedCustomer?.stateCode || "e.g. 27"} maxLength={2} /></div>
              <div className="space-y-2"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note..." /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Line Items</CardTitle>
              <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setItems(prev => [...prev, emptyItem()])}>
                <Plus className="w-3.5 h-3.5" /> Add Item
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((item, i) => {
                const c = calcLine(item);
                return (
                  <div key={i} className="border border-border rounded-lg p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-2 space-y-1">
                        <Label className="text-xs">Product / Description</Label>
                        <Select value={item.productId ? String(item.productId) : ""} onValueChange={(v) => selectProduct(i, v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select product..." /></SelectTrigger>
                          <SelectContent>{products.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Input className="h-8 text-xs" value={item.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Description" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">HSN Code</Label>
                        <Input className="h-8 text-xs font-mono" value={item.hsnCode} onChange={(e) => setItem(i, { hsnCode: e.target.value })} placeholder="73181590" />
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
                      <div className="space-y-1"><Label className="text-xs">Disc %</Label><Input className="h-8 text-xs" type="number" min="0" max="100" value={item.discount} onChange={(e) => setItem(i, { discount: parseFloat(e.target.value) || 0 })} /></div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Taxable: {formatCurrency(c.taxable)} · GST: {formatCurrency(c.gstAmt)}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground text-sm">{formatCurrency(c.total)}</span>
                        {items.length > 1 && <button type="button" onClick={() => setItems(prev => prev.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="sticky top-4">
            <CardHeader className="pb-3"><CardTitle className="text-base">Invoice Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Subtotal (Taxable)</span><span className="font-medium">{formatCurrency(totals.taxable)}</span></div>
              <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Total GST</span><span className="font-medium text-primary">{formatCurrency(totals.gst)}</span></div>
              <div className="flex justify-between py-2 font-bold text-base border-t-2"><span>Total Amount</span><span className="text-primary">{formatCurrency(totals.total)}</span></div>
              {selectedCustomer && (
                <div className="text-xs text-muted-foreground bg-accent/40 rounded p-2">
                  {selectedCustomer.stateCode === "27" ? "Intra-state → CGST + SGST" : "Inter-state → IGST"}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={mutation.isPending}>{mutation.isPending ? "Creating..." : "Create Invoice"}</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
