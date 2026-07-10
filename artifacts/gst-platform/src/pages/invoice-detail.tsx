import { useRoute, useLocation } from "wouter";
import { useGetInvoice, useUpdateInvoiceStatus, useGetBusiness, useGetCustomer } from "@workspace/api-client-react";
import { formatCurrency, formatDate, statusBadge, amountToWords } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Printer, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function InvoiceDetailPage() {
  const [, params] = useRoute("/invoices/:id");
  const [, setLocation] = useLocation();
  const { data, isLoading, refetch } = useGetInvoice(parseInt(params?.id || "0"));
  const { data: businessData } = useGetBusiness();
  const paymentMutation = useUpdateInvoiceStatus();
  const { toast } = useToast();

  // API returns: id, invoiceNumber, status (not paymentStatus), grandTotal (not totalAmount), subtotal (not taxableAmount), balanceDue
  const inv: any = data || {};
  const items: any[] = inv.items || [];
  const business: any = businessData || {};

  const { data: customerData } = useGetCustomer(inv.customerId || 0, { query: { enabled: !!inv.customerId } as any });
  const customer: any = customerData || {};

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
  const gstLabel = inv.isInterstate ? "IGST" : "CGST + SGST";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2 no-print">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 no-print">
        <div className="lg:col-span-2">
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
        </div>
        <div>
          <Card>
            <CardContent className="p-4 space-y-2 text-sm">
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

      {/* Printable invoice — visually matches the standard tax invoice / proforma layout */}
      <div id="invoice-print-area" className="bg-white text-black border border-gray-800 mx-auto max-w-[900px]">
        <div className="flex justify-between items-start border-b border-gray-800 px-4 py-2">
          <div className="text-xs font-semibold">GSTIN : {business.gstin || "-"}</div>
          <div className="text-lg font-bold">{inv.type || "Tax Invoice"}</div>
        </div>

        <div className="grid grid-cols-2 border-b border-gray-800 text-xs">
          <div className="p-3 border-r border-gray-800 space-y-1">
            <p className="font-semibold underline">Customer Detail</p>
            <p><span className="inline-block w-20 text-gray-600">M/S</span>{inv.customerName}</p>
            {(customer.address || customer.city) && (
              <p><span className="inline-block w-20 text-gray-600 align-top">Address</span>
                <span className="inline-block w-[70%]">{[customer.address, customer.city, customer.state, customer.pincode].filter(Boolean).join(", ")}</span>
              </p>
            )}
            {customer.phone && <p><span className="inline-block w-20 text-gray-600">Phone</span>{customer.phone}</p>}
            <p><span className="inline-block w-20 text-gray-600">GSTIN</span>{inv.customerGstin || "-"}</p>
            <p><span className="inline-block w-20 text-gray-600">Place of Supply</span>{inv.placeOfSupply || "-"}</p>
          </div>
          <div className="p-3 grid grid-cols-2 gap-y-1 content-start">
            <span className="text-gray-600">{inv.type || "Invoice"} No.</span><span className="font-medium">{inv.invoiceNumber}</span>
            <span className="text-gray-600">{inv.type || "Invoice"} Date</span><span className="font-medium">{formatDate(inv.invoiceDate)}</span>
            <span className="text-gray-600">Due Date</span><span className="font-medium">{formatDate(inv.dueDate)}</span>
            <span className="text-gray-600">Reverse Charge</span><span className="font-medium">No</span>
          </div>
        </div>

        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-gray-800">
              <th className="border-r border-gray-800 px-2 py-1 w-8">Sr.<br />No.</th>
              <th className="border-r border-gray-800 px-2 py-1 text-left">Name of Product / Service</th>
              <th className="border-r border-gray-800 px-2 py-1 w-20">HSN / SAC</th>
              <th className="border-r border-gray-800 px-2 py-1 w-14">Qty</th>
              <th className="border-r border-gray-800 px-2 py-1 w-16">Rate</th>
              <th className="border-r border-gray-800 px-2 py-1 w-20">Taxable Value</th>
              <th className="border-r border-gray-800 px-2 py-1 w-24" colSpan={2}>{gstLabel}</th>
              <th className="px-2 py-1 w-20">Total</th>
            </tr>
            <tr className="border-b-2 border-gray-800 text-[10px] text-gray-600">
              <th className="border-r border-gray-800"></th><th className="border-r border-gray-800"></th><th className="border-r border-gray-800"></th>
              <th className="border-r border-gray-800"></th><th className="border-r border-gray-800"></th><th className="border-r border-gray-800"></th>
              <th className="border-r border-gray-800 font-normal">%</th><th className="border-r border-gray-800 font-normal">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, i: number) => (
              <tr key={i} className="border-b border-gray-300 align-top">
                <td className="border-r border-gray-800 px-2 py-1 text-center">{i + 1}</td>
                <td className="border-r border-gray-800 px-2 py-1">{item.description}</td>
                <td className="border-r border-gray-800 px-2 py-1 text-center font-mono">{item.hsnCode || "-"}</td>
                <td className="border-r border-gray-800 px-2 py-1 text-right">{item.quantity} {item.unit}</td>
                <td className="border-r border-gray-800 px-2 py-1 text-right">{parseFloat(item.unitPrice).toFixed(2)}</td>
                <td className="border-r border-gray-800 px-2 py-1 text-right">{parseFloat(item.taxableAmount).toFixed(2)}</td>
                <td className="border-r border-gray-800 px-2 py-1 text-right">{item.gstRate}</td>
                <td className="border-r border-gray-800 px-2 py-1 text-right">
                  {(parseFloat(item.cgst || 0) + parseFloat(item.sgst || 0) + parseFloat(item.igst || 0)).toFixed(2)}
                </td>
                <td className="px-2 py-1 text-right">{parseFloat(item.totalAmount).toFixed(2)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-b-2 border-gray-800 font-semibold">
              <td className="border-r border-gray-800 px-2 py-1"></td>
              <td className="border-r border-gray-800 px-2 py-1">Total</td>
              <td className="border-r border-gray-800 px-2 py-1"></td>
              <td className="border-r border-gray-800 px-2 py-1 text-right">{items.reduce((s, it) => s + parseFloat(it.quantity || 0), 0)}</td>
              <td className="border-r border-gray-800 px-2 py-1"></td>
              <td className="border-r border-gray-800 px-2 py-1 text-right">{parseFloat(inv.subtotal).toFixed(2)}</td>
              <td className="border-r border-gray-800 px-2 py-1"></td>
              <td className="border-r border-gray-800 px-2 py-1 text-right">{parseFloat(inv.totalGst).toFixed(2)}</td>
              <td className="px-2 py-1 text-right">{parseFloat(inv.grandTotal).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-2 text-xs border-b border-gray-800">
          <div className="p-3 border-r border-gray-800">
            <p className="font-semibold">Total in words</p>
            <p className="font-medium mt-1">{amountToWords(inv.grandTotal)}</p>
          </div>
          <div className="p-3 space-y-1">
            <div className="flex justify-between"><span className="text-gray-600">Taxable Amount</span><span>{formatCurrency(inv.subtotal)}</span></div>
            {inv.isInterstate
              ? <div className="flex justify-between"><span className="text-gray-600">Add : IGST</span><span>{formatCurrency(inv.igst)}</span></div>
              : (
                <>
                  <div className="flex justify-between"><span className="text-gray-600">Add : CGST</span><span>{formatCurrency(inv.cgst)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">Add : SGST</span><span>{formatCurrency(inv.sgst)}</span></div>
                </>
              )}
            <div className="flex justify-between border-t pt-1"><span className="text-gray-600">Total Tax</span><span>{formatCurrency(inv.totalGst)}</span></div>
            <div className="flex justify-between font-bold text-sm border-t pt-1"><span>Total Amount After Tax</span><span>{formatCurrency(inv.grandTotal)}</span></div>
          </div>
        </div>

        <div className="grid grid-cols-2 text-xs">
          <div className="p-3 border-r border-gray-800 space-y-1">
            <p className="font-semibold">Bank Details</p>
            <div className="flex justify-between"><span className="text-gray-600">Bank Name</span><span>{business.bankName || "-"}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Branch Name</span><span>{business.bankBranch || "-"}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Bank Account Number</span><span>{business.bankAccount || "-"}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Bank Branch IFSC</span><span>{business.bankIfsc || "-"}</span></div>
            <p className="font-semibold pt-2">Terms and Conditions</p>
            <p className="whitespace-pre-line text-[11px]">{business.termsConditions || "1. Goods once sold will not be taken back.\n2. Subject to jurisdiction."}</p>
          </div>
          <div className="p-3 flex flex-col justify-between">
            <p className="text-right text-[11px]">Certified that the particulars given above are true and correct.</p>
            <p className="text-right text-[11px] mt-1">For {business.name || "-"}</p>
            <div className="mt-16 text-right font-medium">Authorised Signatory</div>
          </div>
        </div>
      </div>
    </div>
  );
}
