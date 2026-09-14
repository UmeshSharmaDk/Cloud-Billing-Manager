import { useState } from "react";
import { useListPayments } from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Search, CreditCard, TrendingUp, TrendingDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function PaymentsPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const { data, isLoading } = useListPayments(type !== "all" ? { type } : {});
  const payments: any[] = (data as any)?.payments || (Array.isArray(data) ? data : []);

  const filtered = payments.filter(p =>
    p.referenceNumber?.toLowerCase().includes(search.toLowerCase()) ||
    p.notes?.toLowerCase().includes(search.toLowerCase()) ||
    p.mode?.toLowerCase().includes(search.toLowerCase())
  );

  const totalReceived = filtered.filter(p => p.type === "received").reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const totalPaid = filtered.filter(p => p.type === "paid").reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Payments</h1>
        <p className="text-muted-foreground text-sm">Track all payment receipts and disbursements</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-700">Total Received</p>
              <p className="text-2xl font-bold text-emerald-900 mt-1">{formatCurrency(totalReceived)}</p>
            </div>
            <div className="p-3 bg-emerald-100 rounded-xl"><TrendingUp className="w-6 h-6 text-emerald-600" /></div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-red-700">Total Paid Out</p>
              <p className="text-2xl font-bold text-red-900 mt-1">{formatCurrency(totalPaid)}</p>
            </div>
            <div className="p-3 bg-red-100 rounded-xl"><TrendingDown className="w-6 h-6 text-red-600" /></div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search payments..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="paid">Paid Out</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        {isLoading ? (
          <CardContent className="p-6 space-y-3 animate-pulse">
            {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg" />)}
          </CardContent>
        ) : filtered.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CreditCard className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="font-medium">No payments found</p>
            <p className="text-sm text-muted-foreground">Payments are recorded when you mark invoices as paid</p>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Date</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Reference</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Method</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Type</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Notes</th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p: any) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-accent/40 transition-colors">
                    <td className="py-3 px-4 text-muted-foreground">{formatDate(p.date)}</td>
                    <td className="py-3 px-4 font-mono text-xs">{p.referenceNumber || "-"}</td>
                    <td className="py-3 px-4 capitalize">{p.mode?.replace(/_/g, " ") || "-"}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${p.type === "received" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-red-100 text-red-800 border-red-200"}`}>
                        {p.type === "received" ? "Received" : "Paid"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">{p.notes || "-"}</td>
                    <td className={`py-3 px-4 text-right font-semibold ${p.type === "received" ? "text-emerald-600" : "text-red-600"}`}>
                      {p.type === "received" ? "+" : "-"}{formatCurrency(p.amount)}
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
