import { useState } from "react";
import { Link } from "wouter";
import { useListInvoices } from "@workspace/api-client-react";
import { formatCurrency, formatDate, statusBadge } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search, FileText } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function InvoicesPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const { data, isLoading } = useListInvoices(status !== "all" ? { status } : {});
  const invoices: any[] = (data as any)?.invoices || (Array.isArray(data) ? data : []);

  const filtered = invoices.filter(inv =>
    inv.invoiceNumber?.toLowerCase().includes(search.toLowerCase()) ||
    inv.customerName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Invoices</h1>
          <p className="text-muted-foreground text-sm">Manage GST-compliant sales invoices</p>
        </div>
        <Link href="/invoices/new">
          <Button className="gap-2"><Plus className="w-4 h-4" /> New Invoice</Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        {isLoading ? (
          <CardContent className="p-6">
            <div className="space-y-3 animate-pulse">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg" />)}</div>
          </CardContent>
        ) : filtered.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="font-medium text-foreground">No invoices found</p>
            <p className="text-sm text-muted-foreground mb-4">Create your first GST invoice</p>
            <Link href="/invoices/new"><Button className="gap-2"><Plus className="w-4 h-4" /> Create Invoice</Button></Link>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Invoice #</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Customer</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Due Date</th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Taxable</th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">GST</th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Total</th>
                  <th className="text-center py-3 px-4 font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv: any) => (
                  <tr key={inv.id} className="border-b last:border-0 hover:bg-accent/40 transition-colors">
                    <td className="py-3 px-4">
                      <Link href={`/invoices/${inv.id}`}>
                        <span className="text-primary font-semibold hover:underline cursor-pointer">{inv.invoiceNumber}</span>
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium">{inv.customerName}</div>
                      {inv.customerGstin && <div className="text-xs text-muted-foreground">{inv.customerGstin}</div>}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{formatDate(inv.invoiceDate)}</td>
                    <td className="py-3 px-4 text-muted-foreground">{formatDate(inv.dueDate)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(inv.taxableAmount)}</td>
                    <td className="py-3 px-4 text-right text-muted-foreground">{formatCurrency(inv.totalGst)}</td>
                    <td className="py-3 px-4 text-right font-semibold">{formatCurrency(inv.totalAmount)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusBadge(inv.paymentStatus)}`}>{inv.paymentStatus}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
