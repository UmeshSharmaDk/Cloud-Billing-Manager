import { useRoute, useLocation } from "wouter";
import { useGetPurchase, useUpdatePurchase } from "@workspace/api-client-react";
import { formatCurrency, formatDate, statusBadge } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function PurchaseDetailPage() {
  const [, params] = useRoute("/purchases/:id");
  const [, setLocation] = useLocation();
  const { data, isLoading, refetch } = useGetPurchase(parseInt(params?.id || "0"));
  const mutation = useUpdatePurchase();
  const { toast } = useToast();

  const p: any = data || {};
  const items: any[] = p.items || [];

  const handleStatus = (status: string) => {
    mutation.mutate({ id: parseInt(params?.id || "0"), data: { paymentStatus: status } as any }, {
      onSuccess: () => { toast({ title: `Status updated to ${status}` }); refetch(); },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    });
  };

  if (isLoading) return <div className="space-y-4 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/purchases")}><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold">{p.billNumber || `Purchase #${p.id}`}</h1>
            <p className="text-muted-foreground text-sm">Vendor: {p.vendorName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm px-3 py-1 rounded-full border font-medium ${statusBadge(p.paymentStatus)}`}>{p.paymentStatus}</span>
          <Select value={p.paymentStatus} onValueChange={handleStatus}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unpaid">Mark Unpaid</SelectItem>
              <SelectItem value="partial">Mark Partial</SelectItem>
              <SelectItem value="paid">Mark Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="p-5 grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Vendor</p>
                <p className="font-semibold">{p.vendorName}</p>
                {p.vendorGstin && <p className="text-xs font-mono text-muted-foreground">GSTIN: {p.vendorGstin}</p>}
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Bill Details</p>
                <div className="space-y-1 text-sm">
                  <div className="flex gap-2"><span className="text-muted-foreground">Bill Date:</span><span>{formatDate(p.billDate)}</span></div>
                  <div className="flex gap-2"><span className="text-muted-foreground">Due:</span><span>{formatDate(p.dueDate)}</span></div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Items Purchased</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Description</th>
                      <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Qty</th>
                      <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Rate</th>
                      <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Taxable</th>
                      <th className="text-right py-2 px-4 font-semibold text-muted-foreground">GST (ITC)</th>
                      <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: any, i: number) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 px-4 font-medium">{item.description}</td>
                        <td className="py-2 px-4 text-right">{item.quantity} {item.unit}</td>
                        <td className="py-2 px-4 text-right">{formatCurrency(item.unitPrice)}</td>
                        <td className="py-2 px-4 text-right">{formatCurrency(item.taxableAmount)}</td>
                        <td className="py-2 px-4 text-right text-blue-600">{formatCurrency(parseFloat(item.cgst || 0) + parseFloat(item.sgst || 0) + parseFloat(item.igst || 0))}</td>
                        <td className="py-2 px-4 text-right font-semibold">{formatCurrency(item.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="sticky top-4">
            <CardHeader className="pb-3"><CardTitle className="text-base">Payment Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Taxable</span><span>{formatCurrency(p.taxableAmount)}</span></div>
              <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Total GST (ITC)</span><span className="text-blue-600 font-medium">{formatCurrency(p.totalGst)}</span></div>
              <div className="flex justify-between py-2 border-t-2 font-bold text-base"><span>Total</span><span>{formatCurrency(p.totalAmount)}</span></div>
              {p.paymentStatus !== "paid" && (
                <Button className="w-full mt-2 gap-2" onClick={() => handleStatus("paid")} disabled={mutation.isPending}>
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
