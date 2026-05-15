import { useGetAdminStats } from "@workspace/api-client-react";
import { formatCurrency, statusBadge, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Building2, FileText, TrendingUp, Shield } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

const COLORS = ["hsl(217,91%,50%)", "hsl(160,60%,45%)", "hsl(30,80%,55%)", "hsl(340,75%,55%)"];

export default function AdminDashboardPage() {
  const { data, isLoading } = useGetAdminStats();
  const stats: any = data || {};

  if (isLoading) return (
    <div className="space-y-4 animate-pulse">
      {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}
    </div>
  );

  const subPieData = [
    { name: "Monthly", value: stats.monthlyCount || 0 },
    { name: "Yearly", value: stats.yearlyCount || 0 },
    { name: "Trial", value: stats.trialCount || 0 },
    { name: "Expired", value: stats.expiredCount || 0 },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-primary/10 rounded-xl"><Shield className="w-6 h-6 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground text-sm">Platform overview and management</p>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-blue-100 rounded-xl"><Users className="w-5 h-5 text-blue-600" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Users</p>
              <p className="text-2xl font-bold">{stats.totalUsers || 0}</p>
              <p className="text-xs text-emerald-600 font-medium">+{stats.newUsersThisMonth || 0} this month</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-indigo-100 rounded-xl"><Building2 className="w-5 h-5 text-indigo-600" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Businesses</p>
              <p className="text-2xl font-bold">{stats.totalBusinesses || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-emerald-100 rounded-xl"><FileText className="w-5 h-5 text-emerald-600" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Total Invoices</p>
              <p className="text-2xl font-bold">{stats.totalInvoices || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-amber-100 rounded-xl"><TrendingUp className="w-5 h-5 text-amber-600" /></div>
            <div>
              <p className="text-xs text-muted-foreground">Active Subscriptions</p>
              <p className="text-2xl font-bold">{stats.activeSubscriptions || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {subPieData.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Subscription Distribution</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={subPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {subPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Registrations</CardTitle>
            <Link href="/admin/users"><Button variant="ghost" size="sm" className="text-primary text-xs">View all</Button></Link>
          </CardHeader>
          <CardContent className="p-0">
            {(stats.recentUsers || []).length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">No users yet</div>
            ) : (
              <div className="divide-y divide-border">
                {(stats.recentUsers || []).map((u: any) => (
                  <div key={u.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusBadge(u.subscriptionStatus)}`}>{u.subscriptionStatus}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatDate(u.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
