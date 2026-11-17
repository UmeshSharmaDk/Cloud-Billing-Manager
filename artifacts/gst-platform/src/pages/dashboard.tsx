import { useGetDashboardStats, useGetRecentInvoices, useGetMonthlyRevenue, useGetLowStockAlerts, useGetGstSummary } from "@workspace/api-client-react";
import { DashboardSkeleton, Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate, statusBadge } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { FileText, Package, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Figure, deltaText } from "@/components/Figure";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, LineChart, Line } from "recharts";

export default function DashboardPage() {
  const { data: statsRaw, isLoading } = useGetDashboardStats();
  const { data: recentInvData } = useGetRecentInvoices();
  const { data: revenueData, isLoading: revenueLoading } = useGetMonthlyRevenue();
  const { data: lowStockData } = useGetLowStockAlerts();
  const { data: gstData } = useGetGstSummary();

  // API returns: totalSales, totalPurchases, totalOutstanding, invoiceCount, customerCount, vendorCount, productCount, lowStockCount, overdueInvoiceCount, totalGstPayable
  // These are all-time totals, not this month's.
  const stats: any = statsRaw || {};
  const recentInvoices: any[] = Array.isArray(recentInvData) ? recentInvData : [];
  // Monthly revenue API returns six rows, oldest first, the last being the current month: [{ month, sales, purchases, gst }]
  const salesTrend: any[] = Array.isArray(revenueData) ? revenueData : [];
  const lowStockProducts: any[] = Array.isArray(lowStockData) ? lowStockData : [];
  // GST summary returns: { outputCgst, outputSgst, outputIgst, inputCgst, inputSgst, inputIgst, netPayable }
  const gstSummary: any = gstData || {};

  if (isLoading) return <DashboardSkeleton />;

  // The revenue series is built on UTC months, so the period is named the same way.
  const now = new Date();
  const monthName = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const period = `1 ${monthName(0)} to ${now.getUTCDate()} ${monthName(0)} ${now.getUTCFullYear()}`;
  const current = salesTrend[salesTrend.length - 1];
  const previous = salesTrend[salesTrend.length - 2];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Revenue · {period}</h1>
          <p className="text-sm text-muted-foreground mt-1">Month to date. Changes compare with the whole of {monthName(-1)}.</p>
        </div>
        <Link href="/invoices/new">
          <Button className="gap-1"><Plus className="w-4 h-4" /> New invoice</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        {/* The one figure that matters: this month's sales */}
        <Card>
          <CardContent className="p-6 h-full flex flex-col justify-between gap-6">
            {revenueLoading ? (
              <div role="status" aria-label="Loading" className="space-y-3"><Skeleton className="h-3 w-28" /><Skeleton className="h-12 w-64 max-w-full" /><Skeleton className="h-3 w-24" /><Skeleton className="h-16 w-full" /></div>
            ) : (
              <>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">Sales this month</p>
                  <p className="text-5xl font-semibold tracking-tight tabular-nums text-foreground mt-2">{formatCurrency(current?.sales ?? 0)}</p>
                  <p className="text-sm text-muted-foreground mt-2 tabular-nums">
                    {(previous && deltaText(current.sales, previous.sales, monthName(-1))) ?? `No sales in ${monthName(-1)} to compare with`}
                    {previous ? ` (${formatCurrency(previous.sales)})` : ""}
                  </p>
                </div>
                {salesTrend.length > 1 && (
                  <figure className="flex-1 min-h-24 flex flex-col">
                    {/* Inline sparkline: the same six months as the chart below, no axes */}
                    <div className="flex-1 min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={salesTrend} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                          <Line type="monotone" dataKey="sales" stroke="hsl(var(--foreground))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <figcaption className="text-xs text-muted-foreground">Sales by month, {salesTrend[0].month} to {current.month}</figcaption>
                  </figure>
                )}
              </>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border-t pt-5">
              <Figure label="CGST collected" value={formatCurrency(gstSummary.outputCgst)} />
              <Figure label="SGST collected" value={formatCurrency(gstSummary.outputSgst)} />
              <Figure label="IGST collected" value={formatCurrency(gstSummary.outputIgst)} />
              <Figure label="Purchases this month" value={formatCurrency(current?.purchases ?? 0)}
                note={previous ? deltaText(current.purchases, previous.purchases, monthName(-1)) : null} />
            </div>
          </CardContent>
        </Card>

        {/* Everything else, smaller */}
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            <div className="px-5 py-4"><Figure label="Outstanding receivables" value={formatCurrency(stats.totalOutstanding)} note={`${stats.overdueInvoiceCount || 0} invoices overdue`} /></div>
            <div className="px-5 py-4"><Figure label="Sales, all time" value={formatCurrency(stats.totalSales)} note={`${stats.invoiceCount || 0} invoices`} /></div>
            <div className="px-5 py-4"><Figure label="Purchases, all time" value={formatCurrency(stats.totalPurchases)} note={`${stats.vendorCount || 0} vendors`} /></div>
            <div className="px-5 py-4"><Figure label="Products in stock" value={String(stats.productCount || 0)} note={`${stats.lowStockCount || 0} running low`} /></div>
          </CardContent>
        </Card>
      </div>

      {salesTrend.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Sales and purchases · {salesTrend[0].month} to {salesTrend[salesTrend.length - 1].month}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={salesTrend}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => `\u20b9${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => formatCurrency(v)} cursor={{ fill: "hsl(var(--muted))" }} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--popover-foreground))" }} />
                <Bar dataKey="sales" fill="hsl(var(--foreground))" name="Sales" radius={[3, 3, 0, 0]} />
                <Bar dataKey="purchases" fill="hsl(var(--muted-foreground) / 0.35)" name="Purchases" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent Invoices + Low Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent invoices</CardTitle>
            <Link href="/invoices">
              <Button variant="ghost" size="sm" className="gap-1">View all <ArrowRight className="w-3.5 h-3.5" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentInvoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <FileText className="w-8 h-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No invoices yet</p>
                <Link href="/invoices/new">
                  <Button size="sm" variant="outline" className="mt-3 gap-1"><Plus className="w-3.5 h-3.5" /> Create invoice</Button>
                </Link>
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
                        <p className="text-sm font-semibold">{formatCurrency(inv.grandTotal)}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusBadge(inv.status)}`}>{inv.status}</span>
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
            <CardTitle className="text-base">Low stock</CardTitle>
            <Link href="/inventory">
              <Button variant="ghost" size="sm" className="gap-1">View all <ArrowRight className="w-3.5 h-3.5" /></Button>
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
                        <p className={`text-sm font-bold ${p.stockQuantity <= 0 ? "text-danger" : "text-warning"}`}>
                          {p.stockQuantity} {p.unit}
                        </p>
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
