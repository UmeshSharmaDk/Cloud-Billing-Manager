import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useSave } from "@/lib/save";
import type { User } from "@/lib/types";
import { Button, Card, colors, ErrorView, Loading, Prompt, Row, s, StatusPill } from "@/lib/ui";
import { AccountCard, MenuLink } from "../(tabs)/more";
import { Figure } from "../(tabs)/index";

type Stats = Record<string, number> & { recentUsers: User[] };
export type CapacityRequest = { id: number; adminName: string; adminEmail: string; additionalUsers: number; amountInr: number; status: string; createdAt: string; grantedUserLimit?: number | null };

type Client = { id: number; name: string; business: { name: string; lockDate: string | null } | null; sales?: number; invoices?: number; netGst?: number; receivable?: number;
  overdue?: number; filings?: Record<string, { filedAt: string } | undefined> };
const FORMS = ["GSTR-1", "GSTR-3B"] as const;

/** Consultant view: each client's month at a glance; tap to open the client. */
export function Clients() {
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 7));
  const step = (n: number) => setAt((m) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const q = useQuery({ queryKey: ["/admin/clients", at], queryFn: () => api<{ clients: Client[] }>(`/admin/clients?month=${at}`) });
  const label = new Date(Number(at.slice(0, 4)), Number(at.slice(5)) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return (
    <Card title={`Clients · ${label}`}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Button title="‹ Prev" variant="outline" onPress={() => step(-1)} /></View>
        <View style={{ flex: 1 }}><Button title="Next ›" variant="outline" onPress={() => step(1)} /></View>
      </View>
      {q.isLoading ? <Loading layout="rows" /> : q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : !q.data?.clients.length ? <Text style={s.muted}>No clients yet.</Text> :
        q.data.clients.map((c) => (
          <Pressable key={c.id} onPress={() => router.push(`/admin/user/${c.id}`)} style={{ paddingVertical: 8, minHeight: 44, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 }}>
            <Row label={c.business?.name ?? c.name} value={money(c.sales ?? 0)} />
            <Text style={s.muted}>{c.invoices ?? 0} invoices · GST {money(c.netGst ?? 0)} · owed {money(c.receivable ?? 0)}{c.overdue ? ` (${c.overdue} overdue)` : ""}{c.business?.lockDate ? ` · frozen to ${date(c.business.lockDate)}` : ""}</Text>
            {c.business && <Text style={s.muted}>{FORMS.map((f) => `${f} ${c.filings?.[f] ? "filed" : "not filed"}`).join(" · ")}</Text>}
          </Pressable>
        ))}
    </Card>
  );
}

export default function AdminHome() {
  const { request } = useLocalSearchParams<{ request?: string }>();
  const stats = useQuery({ queryKey: ["/admin/stats"], queryFn: () => api<Stats>("/admin/stats") });
  const reqs = useQuery({ queryKey: ["/superadmin/capacity-requests"], queryFn: () => api<{ requests: CapacityRequest[]; additionalUserPriceInr: number }>("/superadmin/capacity-requests") });
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (request) setAsking(true); }, [request]);
  const { busy, run } = useSave();

  if (stats.isLoading) return <Loading layout="dashboard" />;
  if (stats.error) return <ErrorView error={stats.error} onRetry={stats.refetch} />;
  const d = stats.data!;
  const price = reqs.data?.additionalUserPriceInr ?? 1000;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={<RefreshControl refreshing={stats.isRefetching} onRefresh={() => { stats.refetch(); reqs.refetch(); }} />}>
      <Stack.Screen options={{ title: "Admin", headerBackVisible: false }} />
      <Text style={s.title}>Users · as of {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Text>
      <View style={[s.card, { gap: 12 }]}>
        <View>
          <Text style={s.muted}>Active users</Text>
          <Text style={{ color: colors.text, marginTop: 2 }}><Text style={{ fontSize: 32, fontWeight: "700" }}>{d.activeUsers}</Text><Text style={{ fontSize: 16, color: colors.muted }}> of {d.totalUsers}</Text></Text>
          <Text style={s.muted}>+{d.newUsersThisMonth ?? 0} users added in {new Date().toLocaleDateString("en-GB", { month: "short" })}</Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
          <Figure label="Monthly plan" value={String(d.monthlyCount ?? 0)} />
          <Figure label="Yearly plan" value={String(d.yearlyCount ?? 0)} />
          <Figure label="On trial" value={String(d.trialCount ?? 0)} />
          <Figure label="Plan expired" value={String(d.expiredSubscriptions ?? 0)} />
          <Figure label="Inactive" value={String(d.inactiveUsers ?? 0)} />
        </View>
      </View>
      <View style={[s.card, { flexDirection: "row", gap: 12 }]}>
        <Figure label="Invoices, all time" value={String(d.totalInvoices ?? 0)} note="Across all your users" />
      </View>
      <Clients />
      <View style={{ borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
        <MenuLink title="Manage users" icon="people-outline" href="/admin/users" />
        <MenuLink title="Add a user" icon="person-add-outline" href="/admin/new-user" />
      </View>
      {!!d.recentUsers?.length && (
        <Card title="Recent users">
          {d.recentUsers.map((u) => (
            <Pressable key={u.id} onPress={() => router.push(`/admin/user/${u.id}`)} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, minHeight: 44 }}>
              <View style={{ flexShrink: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>{u.name}</Text>
                <Text style={s.muted}>{u.email}</Text>
              </View>
              <StatusPill status={u.subscriptionStatus ?? "trial"} />
            </Pressable>
          ))}
        </Card>
      )}
      <Card title="Extra user capacity">
        <Text style={s.muted}>Each extra user costs {money(price)}. Requests are reviewed by the platform owner.</Text>
        {reqs.data?.requests.map((r) => (
          <Row key={r.id} label={`+${r.additionalUsers} users · ${date(r.createdAt)}`} value={r.status} />
        ))}
        <Button title="Request more users" variant="outline" onPress={() => setAsking(true)} />
      </Card>
      <AccountCard />
      <Prompt visible={asking} numeric busy={busy} title="Request more users" placeholder="Number of users"
        message={`How many extra users do you need? Each costs ${money(price)}.`}
        onCancel={() => setAsking(false)}
        onSubmit={(v) => run(() => api("/superadmin/capacity-requests", { method: "POST", body: { additionalUsers: Number(v) } }), () => setAsking(false))} />
    </ScrollView>
  );
}
