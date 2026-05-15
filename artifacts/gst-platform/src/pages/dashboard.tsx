import { useGetDashboardStats, useGetRecentInvoices, useGetMonthlyRevenue, useGetLowStockAlerts, useGetGstSummary } from "@workspace/api-client-react";
import { formatCurrency, formatDate, statusBadge } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { TrendingUp, TrendingDown, FileText, ShoppingCart, Package, AlertTriangle, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from "recharts";

function StatCard({ title, value, sub, icon: Icon, trend, color = "blue" }: {
  title: string; value: string; sub?: string; icon: React.ComponentType<any>; trend?: number; color?: string;
}) {
  const colors: Record<string, string> = { blue: "bg-blue-100 text-blue-600", green: "bg-emerald-100 text-emerald-600", amber: "bg-amber-100 text-amber-600", violet: "bg-violet-100 text-violet-600" };
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`p-3 rounded-xl ${colors[color] || colors.blue}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        {trend !== undefined && (
          <div className="mt-3 flex items-center gap-1 text-xs">
            {trend >= 0 ? <TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> : <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
            <span className={trend >= 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>{Math.abs(trend)}% vs last month</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: statsData, isLoading } = useGetDashboardStats();
  const { data: recentInvData } = useGetRecentInvoices();
  const { data: revenueData } = useGetMonthlyRevenue();
  const { data: lowStockData } = useGetLowStockAlerts();
  const { data: gstData } = useGetGstSummary();

  const stats: any = statsData || {};
  const recentInvoices: any[] = (recentInvData as any) || [];
  const salesTrend: any[] = (revenueData as any) || [];
  const lowStockProducts: any[] = (lowStockData as any) || [];
  const gstSummary: any = gstData || {};

  if (isLoading) return (
    <div className="space-y-4 animate-pulse">
      {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-muted rounded-xl" />)}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Total Sales (Month)" value={formatCurrency(stats.monthlySales)} sub={`${stats.invoiceCount || 0} invoices`} icon={FileText} trend={12} color="blue" />
        <StatCard title="Total Purchases" value={formatCurrency(stats.monthlyPurchases)} sub={`${stats.purchaseCount || 0} bills`} icon={ShoppingCart} trend={-5} color="amber" />
        <StatCard title="Receivables" value={formatCurrency(stats.totalReceivables)} sub="Outstanding from customers" icon={TrendingUp} color="green" />
        <StatCard title="Products in Stock" value={String(stats.productCount || 0)} sub={`${stats.lowStockCount || 0} low stock alerts`} icon={Package} color="violet" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-blue-200 bg-blue-50/50">
          <CardContent className="p-5">
            <p className="text-sm font-medium text-blue-700">Total CGST Collected</p>
            <p className="text-2xl font-bold text-blue-900 mt-1">{formatCurrency(gstSummary.totalCgst)}</p>
          </CardContent>
        </Card>
        <Card className="border-indigo-200 bg-indigo-50/50">
          <CardContent className="p-5">
            <p className="text-sm font-medium text-indigo-700">Total SGST Collected</p>
            <p className="text-2xl font-bold text-indigo-900 mt-1">{formatCurrency(gstSummary.totalSgst)}</p>
          </CardContent>
        </Card>
        <Card className="border-violet-200 bg-violet-50/50">
          <CardContent className="p-5">
            <p className="text-sm font-medium text-violet-700">Total IGST Collected</p>
            <p className="text-2xl font-bold text-violet-900 mt-1">{formatCurrency(gstSummary.totalIgst)}</p>
          </CardContent>
        </Card>
      </div>

      {salesTrend.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Monthly Sales Trend</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={salesTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => formatCurrency(v)} />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="hsl(var(--primary)/0.1)" strokeWidth={2} name="Sales" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Revenue by Month</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={salesTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => formatCurrency(v)} />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" name="Revenue" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Invoices</CardTitle>
            <Link href="/invoices">
              <Button variant="ghost" size="sm" className="text-primary gap-1">View all <ArrowRight className="w-3.5 h-3.5" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentInvoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <FileText className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No invoices yet</p>
                <Link href="/invoices/new"><Button size="sm" className="mt-3 gap-1"><Plus className="w-3.5 h-3.5" /> Create Invoice</Button></Link>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentInvoices.slice(0, 5).map((inv: any) => (
                  <Link key={inv.id} href={`/invoices/${inv.id}`}>
                    <div className="flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors cursor-pointer">
                      <div>
                        <p className="text-sm font-medium">{inv.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">{inv.customerName} · {formatDate(inv.invoiceDate)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatCurrency(inv.totalAmount)}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusBadge(inv.paymentStatus)}`}>{inv.paymentStatus}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> Low Stock Alerts
            </CardTitle>
            <Link href="/inventory">
              <Button variant="ghost" size="sm" className="text-primary gap-1">View all <ArrowRight className="w-3.5 h-3.5" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {lowStockProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <Package className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">All products are well stocked</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {lowStockProducts.slice(0, 5).map((p: any) => (
                  <Link key={p.id} href={`/inventory/${p.id}`}>
                    <div className="flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors cursor-pointer">
                      <div>
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.sku} · Min: {p.lowStockThreshold}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${p.stockQuantity <= 0 ? "text-red-600" : "text-amber-600"}`}>{p.stockQuantity} {p.unit}</p>
                        <span className="text-xs text-muted-foreground">{p.stockQuantity <= 0 ? "Out of stock" : "Low stock"}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
