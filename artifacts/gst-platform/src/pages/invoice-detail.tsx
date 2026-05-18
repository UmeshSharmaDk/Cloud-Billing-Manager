import { useRoute, useLocation } from "wouter";
import { useGetInvoice, useUpdateInvoiceStatus } from "@workspace/api-client-react";
import { formatCurrency, formatDate, statusBadge } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Printer, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function InvoiceDetailPage() {
  const [, params] = useRoute("/invoices/:id");
  const [, setLocation] = useLocation();
  const { data, isLoading, refetch } = useGetInvoice(parseInt(params?.id || "0"));
  const paymentMutation = useUpdateInvoiceStatus();
  const { toast } = useToast();

  // API returns: id, invoiceNumber, status (not paymentStatus), grandTotal (not totalAmount), subtotal (not taxableAmount), balanceDue
  const inv: any = data || {};
  const items: any[] = inv.items || [];

  const handleStatus = (newStatus: string) => {
    paymentMutation.mutate({ id: parseInt(params?.id || "0"), data: { paymentStatus: newStatus } as any }, {
      onSuccess: () => { toast({ title: `Status updated to ${newStatus}` }); refetch(); },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    });
  };

  if (isLoading) return (
    <div className="space-y-4 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-xl" />)}</div>
  );

  const balanceDue = inv.balanceDue ?? Math.max(0, (inv.grandTotal || 0) - (inv.paidAmount || 0));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/invoices")}><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold">{inv.invoiceNumber}</h1>
            <p className="text-muted-foreground text-sm">{formatDate(inv.invoiceDate)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm px-3 py-1 rounded-full border font-medium ${statusBadge(inv.status)}`}>{inv.status}</span>
          <Select value={inv.status} onValueChange={handleStatus}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unpaid">Mark Unpaid</SelectItem>
              <SelectItem value="partial">Mark Partial</SelectItem>
              <SelectItem value="paid">Mark Paid</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => window.print()}>
            <Printer className="w-4 h-4" /> Print
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="p-5 grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Billed To</p>
                <p className="font-semibold">{inv.customerName}</p>
                {inv.customerGstin && <p className="text-xs font-mono text-muted-foreground">GSTIN: {inv.customerGstin}</p>}
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Invoice Info</p>
                <div className="space-y-1 text-sm">
                  <div className="flex gap-2"><span className="text-muted-foreground">Date:</span><span>{formatDate(inv.invoiceDate)}</span></div>
                  <div className="flex gap-2"><span className="text-muted-foreground">Due:</span><span>{formatDate(inv.dueDate)}</span></div>
                  <div className="flex gap-2"><span className="text-muted-foreground">Supply:</span><span>{inv.placeOfSupply || "-"}</span></div>
                  <div className="flex gap-2"><span className="text-muted-foreground">Type:</span><span>{inv.isInterstate ? "Inter-state (IGST)" : "Intra-state (CGST+SGST)"}</span></div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Line Items</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Description</th>
                      <th className="text-left py-2 px-4 font-semibold text-muted-foreground">HSN</th>
                      <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Qty</th>
                      <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Rate</th>
                      <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Taxable</th>
                      <th className="text-right py-2 px-4 font-semibold text-muted-foreground">GST%</th>
                      <th className="text-right py-2 px-4 font-semibold text-muted-foreground">GST Amt</th>
                      <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: any, i: number) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 px-4 font-medium">{item.description}</td>
                        <td className="py-2 px-4 font-mono text-xs text-muted-foreground">{item.hsnCode || "-"}</td>
                        <td className="py-2 px-4 text-right">{item.quantity} {item.unit}</td>
                        <td className="py-2 px-4 text-right">{formatCurrency(item.unitPrice)}</td>
                        <td className="py-2 px-4 text-right">{formatCurrency(item.taxableAmount)}</td>
                        <td className="py-2 px-4 text-right">{item.gstRate}%</td>
                        <td className="py-2 px-4 text-right text-primary">
                          {formatCurrency(parseFloat(item.cgst || 0) + parseFloat(item.sgst || 0) + parseFloat(item.igst || 0))}
                        </td>
                        <td className="py-2 px-4 text-right font-semibold">{formatCurrency(item.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">GST Breakup</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div><p className="text-muted-foreground text-xs">Taxable Value</p><p className="font-semibold">{formatCurrency(inv.subtotal)}</p></div>
                {parseFloat(inv.cgst) > 0 && <div><p className="text-muted-foreground text-xs">CGST</p><p className="font-semibold">{formatCurrency(inv.cgst)}</p></div>}
                {parseFloat(inv.sgst) > 0 && <div><p className="text-muted-foreground text-xs">SGST</p><p className="font-semibold">{formatCurrency(inv.sgst)}</p></div>}
                {parseFloat(inv.igst) > 0 && <div><p className="text-muted-foreground text-xs">IGST</p><p className="font-semibold">{formatCurrency(inv.igst)}</p></div>}
                {inv.roundOff !== 0 && <div><p className="text-muted-foreground text-xs">Round Off</p><p className="font-semibold">{formatCurrency(inv.roundOff)}</p></div>}
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="sticky top-4">
            <CardHeader className="pb-3"><CardTitle className="text-base">Payment Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Taxable Amount</span><span>{formatCurrency(inv.subtotal)}</span></div>
              <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Total GST</span><span className="text-primary font-medium">{formatCurrency(inv.totalGst)}</span></div>
              <div className="flex justify-between py-2 border-t-2 font-bold text-base"><span>Grand Total</span><span className="text-primary">{formatCurrency(inv.grandTotal)}</span></div>
              {parseFloat(inv.paidAmount) > 0 && (
                <div className="flex justify-between text-emerald-600"><span>Paid</span><span className="font-semibold">{formatCurrency(inv.paidAmount)}</span></div>
              )}
              {balanceDue > 0 && (
                <div className="flex justify-between text-red-600 border-t pt-1"><span className="font-semibold">Balance Due</span><span className="font-bold">{formatCurrency(balanceDue)}</span></div>
              )}
              {inv.status !== "paid" && (
                <Button className="w-full mt-2 gap-2" onClick={() => handleStatus("paid")} disabled={paymentMutation.isPending}>
                  <CheckCircle className="w-4 h-4" /> Mark as Paid
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
