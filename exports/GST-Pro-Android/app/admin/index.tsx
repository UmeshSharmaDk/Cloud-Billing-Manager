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

type Stats = Record<string, number> & { recentUsers: User[] };
export type CapacityRequest = { id: number; adminName: string; adminEmail: string; additionalUsers: number; amountInr: number; status: string; createdAt: string; grantedUserLimit?: number | null };

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={[s.card, { flexBasis: "47%", flexGrow: 1 }]}>
      <Text style={s.muted}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text, marginTop: 4 }}>{value}</Text>
    </View>
  );
}

export default function AdminHome() {
  const { request } = useLocalSearchParams<{ request?: string }>();
  const stats = useQuery({ queryKey: ["/admin/stats"], queryFn: () => api<Stats>("/admin/stats") });
  const reqs = useQuery({ queryKey: ["/superadmin/capacity-requests"], queryFn: () => api<{ requests: CapacityRequest[]; additionalUserPriceInr: number }>("/superadmin/capacity-requests") });
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (request) setAsking(true); }, [request]);
  const { busy, run } = useSave();

  if (stats.isLoading) return <Loading />;
  if (stats.error) return <ErrorView error={stats.error} onRetry={stats.refetch} />;
  const d = stats.data!;
  const price = reqs.data?.additionalUserPriceInr ?? 1000;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={<RefreshControl refreshing={stats.isRefetching} onRefresh={() => { stats.refetch(); reqs.refetch(); }} />}>
      <Stack.Screen options={{ title: "Admin", headerBackVisible: false }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Stat label="Users" value={d.totalUsers} />
        <Stat label="Active" value={d.activeUsers} />
        <Stat label="Inactive" value={d.inactiveUsers} />
        <Stat label="Expired plans" value={d.expiredSubscriptions} />
        <Stat label="Trial / monthly / yearly" value={`${d.trialCount ?? 0} / ${d.monthlyCount ?? 0} / ${d.yearlyCount ?? 0}`} />
        <Stat label="Invoices" value={d.totalInvoices ?? 0} />
      </View>
      <View style={{ borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
        <MenuLink title="Manage users" icon="people-outline" href="/admin/users" />
        <MenuLink title="Add a user" icon="person-add-outline" href="/admin/new-user" />
      </View>
      {!!d.recentUsers?.length && (
        <Card title="Recent users">
          {d.recentUsers.map((u) => (
            <Pressable key={u.id} onPress={() => router.push(`/admin/user/${u.id}`)} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 }}>
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
