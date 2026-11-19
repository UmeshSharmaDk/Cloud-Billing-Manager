import { useState } from "react";
import { Link } from "wouter";
import { useListPurchases } from "@workspace/api-client-react";
import { formatCurrency, formatDate, statusBadge } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/ExportButton";
import { fetchAllPages } from "@/lib/download";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search, ShoppingCart, Upload } from "lucide-react";

export default function PurchasesPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useListPurchases();
  // API returns { purchases: [...], total: n }
  // Each purchase has: billNumber (alias for invoiceNumber), billDate, status, grandTotal, subtotal, totalGst, vendorName, vendorGstin
  const purchases: any[] = (data as any)?.purchases || [];

  const filtered = purchases.filter(p =>
    p.billNumber?.toLowerCase().includes(search.toLowerCase()) ||
    p.invoiceNumber?.toLowerCase().includes(search.toLowerCase()) ||
    p.vendorName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Purchase Bills</h1>
          <p className="text-muted-foreground text-sm">Track all supplier purchases and GST input credit</p>
        </div>
        <div className="flex gap-2">
          <ExportButton filename="Purchases" sheets={async () => [{ name: "Purchases", rows: (await fetchAllPages<any>("/purchases", "purchases")).map((r: any) => ({ "Bill no.": r.billNumber ?? r.invoiceNumber, Date: r.billDate ?? r.invoiceDate, Vendor: r.vendorName, GSTIN: r.vendorGstin ?? "", Status: r.status, Taxable: Number(r.subtotal), GST: Number(r.totalGst), TDS: Number(r.tdsAmount ?? 0), Total: Number(r.grandTotal) })) }]} />
          <Link href="/purchases/new">
            <Button variant="outline" className="gap-2"><Upload className="w-4 h-4" /> Import bill file</Button>
          </Link>
          <Link href="/purchases/new">
            <Button className="gap-2"><Plus className="w-4 h-4" /> New Purchase</Button>
          </Link>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by bill number, vendor..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        {isLoading ? (
          <CardContent className="p-6 space-y-3 animate-pulse">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg" />)}</CardContent>
        ) : filtered.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <ShoppingCart className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="font-medium">No purchase bills found</p>
            <p className="text-sm text-muted-foreground mb-4">Record your first purchase from a supplier</p>
            <Link href="/purchases/new"><Button className="gap-2"><Plus className="w-4 h-4" /> New Purchase</Button></Link>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Bill #</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Vendor</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Bill Date</th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Taxable</th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">GST (ITC)</th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Total</th>
                  <th className="text-center py-3 px-4 font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p: any) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-accent/40 transition-colors">
                    <td className="py-3 px-4">
                      <Link href={`/purchases/${p.id}`}>
                        <span className="text-primary font-semibold hover:underline cursor-pointer">
                          {p.billNumber || p.invoiceNumber}
                        </span>
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium">{p.vendorName}</div>
                      {p.vendorGstin && <div className="text-xs text-muted-foreground">{p.vendorGstin}</div>}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">{formatDate(p.billDate || p.invoiceDate)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(p.subtotal)}</td>
                    <td className="py-3 px-4 text-right text-blue-700 font-medium">{formatCurrency(p.totalGst)}</td>
                    <td className="py-3 px-4 text-right font-semibold">{formatCurrency(p.grandTotal)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusBadge(p.status || p.paymentStatus || "unpaid")}`}>
                        {p.status || p.paymentStatus || "unpaid"}
                      </span>
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
