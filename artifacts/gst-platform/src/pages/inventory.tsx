import { useState } from "react";
import { Link } from "wouter";
import { useListProducts } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search, Package, AlertTriangle } from "lucide-react";

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useListProducts();
  const products: any[] = (data as any)?.products || (Array.isArray(data) ? data : []);

  const filtered = products.filter(p =>
    p.name?.toLowerCase().includes(search.toLowerCase()) ||
    p.sku?.toLowerCase().includes(search.toLowerCase()) ||
    p.hsnCode?.includes(search) ||
    p.category?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory / Products</h1>
          <p className="text-muted-foreground text-sm">Manage your products, stock, and pricing</p>
        </div>
        <Link href="/inventory/new">
          <Button className="gap-2"><Plus className="w-4 h-4" /> Add Product</Button>
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by name, SKU, HSN code..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        {isLoading ? (
          <CardContent className="p-6">
            <div className="space-y-3 animate-pulse">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg" />)}</div>
          </CardContent>
        ) : filtered.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Package className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="font-medium">No products found</p>
            <p className="text-sm text-muted-foreground mb-4">Add products to your inventory</p>
            <Link href="/inventory/new"><Button className="gap-2"><Plus className="w-4 h-4" /> Add Product</Button></Link>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Product</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">SKU / HSN</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Category</th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Purchase</th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Selling</th>
                  <th className="text-center py-3 px-4 font-semibold text-muted-foreground">GST %</th>
                  <th className="text-right py-3 px-4 font-semibold text-muted-foreground">Stock</th>
                  <th className="text-center py-3 px-4 font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p: any) => {
                  const isLow = p.stockQuantity <= p.lowStockThreshold;
                  const isOut = p.stockQuantity <= 0;
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-accent/40 transition-colors">
                      <td className="py-3 px-4">
                        <Link href={`/inventory/${p.id}`}>
                          <span className="font-medium text-foreground hover:text-primary cursor-pointer">{p.name}</span>
                        </Link>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-mono text-xs">{p.sku}</div>
                        {p.hsnCode && <div className="text-xs text-muted-foreground">HSN: {p.hsnCode}</div>}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">{p.category || "-"}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(p.purchasePrice)}</td>
                      <td className="py-3 px-4 text-right font-medium">{formatCurrency(p.sellingPrice)}</td>
                      <td className="py-3 px-4 text-center">
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-medium">{p.gstRate}%</span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isLow && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                          <span className={isOut ? "text-red-600 font-bold" : isLow ? "text-amber-600 font-semibold" : "text-foreground"}>
                            {p.stockQuantity}
                          </span>
                          <span className="text-muted-foreground text-xs">{p.unit}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${isOut ? "bg-red-100 text-red-800 border-red-200" : isLow ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-emerald-100 text-emerald-800 border-emerald-200"}`}>
                          {isOut ? "Out of Stock" : isLow ? "Low Stock" : "In Stock"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
