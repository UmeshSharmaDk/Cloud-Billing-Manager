import { useGetAdminStats } from "@workspace/api-client-react";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { formatDate, statusBadge } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ClientsBoard } from "@/components/ClientsBoard";
import { Figure } from "@/components/Figure";
import { ToggleRow } from "@/components/ToggleRow";
import { FirstSteps } from "@/components/FirstSteps";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api-fetch";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

/** The admin's choice to require two-factor sign-in for everyone they manage. */
function TeamMfa() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const set = async (required: boolean) => {
    setBusy(true);
    try {
      const res = await authFetch("/api/users/team-mfa", { method: "PUT", body: JSON.stringify({ required }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save");
      qc.setQueryData(getGetMeQueryKey(), await res.json());
      toast({ title: required ? "Your users must now set up two-factor sign-in" : "Two-factor sign-in is now optional for your users" });
    } catch (err: any) {
      toast({ title: "Not saved", description: err.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardContent className="px-5 py-2">
        <ToggleRow id="team-mfa" label="Require two-factor sign-in for my users"
          note="Each user sets it up on their next visit before they can open their books."
          checked={Boolean((user as any)?.requireTeamMfa)} onChange={set} busy={busy} />
      </CardContent>
    </Card>
  );
}

export default function AdminDashboardPage() {
  const { data, isLoading } = useGetAdminStats();
  const { user } = useAuth();
  // API returns: totalUsers, activeUsers, inactiveUsers, expiredSubscriptions, totalBusinesses,
  //              totalInvoices, activeSubscriptions, newUsersThisMonth,
  //              monthlyCount, yearlyCount, trialCount, expiredCount, recentUsers
  const stats: any = data || {};

  if (isLoading) return <DashboardSkeleton tiles={2} />;

  const today = new Date();
  const asOf = today.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const thisMonth = today.toLocaleDateString("en-GB", { month: "short" });
  const total = stats.totalUsers || 0;
  const active = stats.activeSubscriptions || stats.activeUsers || 0;
  const share = total ? Math.round((active / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Users · as of {asOf}</h1>
        <p className="text-sm text-muted-foreground mt-1">Everyone you have added, and the plan each one is on.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <Card>
          <CardContent className="p-6 space-y-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Active users</p>
              <p className="mt-2 tabular-nums text-foreground"><span className="text-5xl font-semibold tracking-tight">{active}</span><span className="text-xl text-muted-foreground"> of {total}</span></p>
              <p className="text-sm text-muted-foreground mt-2">{share}% active · +{stats.newUsersThisMonth || 0} users added in {thisMonth}</p>
              <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${share}% of users active`}>
                <div className="h-full rounded-full bg-foreground" style={{ width: `${share}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 border-t pt-5">
              <Figure label="Monthly plan" value={String(stats.monthlyCount || 0)} />
              <Figure label="Yearly plan" value={String(stats.yearlyCount || 0)} />
              <Figure label="On trial" value={String(stats.trialCount || 0)} />
              <Figure label="Plan expired" value={String(stats.expiredCount || 0)} />
              <Figure label="Inactive" value={String(stats.inactiveUsers || 0)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 divide-y divide-border">
            <div className="px-5 py-4"><Figure label="Businesses" value={String(stats.totalBusinesses || 0)} /></div>
            <div className="px-5 py-4"><Figure label="Invoices, all time" value={String(stats.totalInvoices || 0)} note="Across all your users" /></div>
          </CardContent>
        </Card>
      </div>

      <FirstSteps steps={[
        { label: "Add your first user", href: "/admin/users", done: total > 0 },
        { label: "Set up their business details", href: "/admin/users", done: (stats.totalBusinesses ?? 0) > 0 },
        { label: "Turn on two-factor sign-in for your users (below)", href: "/admin", done: Boolean((user as any)?.requireTeamMfa) },
      ]} />

      <TeamMfa />

      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recently added users</CardTitle>
            <Link href="/admin/users">
              <Button variant="ghost" size="sm" className="text-xs">View all</Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {(stats.recentUsers || []).length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">No users yet</div>
            ) : (
              <div className="divide-y divide-border">
                {(stats.recentUsers || []).map((u: any) => (
                  <Link key={u.id} href={`/admin/users/${u.id}`}>
                    <div className="flex items-center justify-between px-4 py-3 hover:bg-accent/40 cursor-pointer transition-colors">
                      <div>
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </div>
                      <div className="text-right">
                        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusBadge(u.subscriptionStatus)}`}>{u.subscriptionStatus}</span>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatDate(u.createdAt)}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ClientsBoard />
    </div>
  );
}
