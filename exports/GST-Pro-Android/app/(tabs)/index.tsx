import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import type { DashboardStats, Invoice } from "@/lib/types";
import { colors, ErrorView, Loading, s, StatusPill } from "@/lib/ui";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={[s.card, { flexBasis: "47%", flexGrow: 1 }]}>
      <Text style={s.muted}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: "700", color: tone ?? colors.text, marginTop: 4 }}>{value}</Text>
    </View>
  );
}

export default function Dashboard() {
  const stats = useQuery({ queryKey: ["dashboard/stats"], queryFn: () => api<DashboardStats>("/dashboard/stats") });
  const recent = useQuery({ queryKey: ["dashboard/recent"], queryFn: () => api<Invoice[]>("/dashboard/recent-invoices") });

  if (stats.isLoading) return <Loading />;
  if (stats.error) return <ErrorView error={stats.error} onRetry={stats.refetch} />;
  const d = stats.data!;
  const refresh = () => { stats.refetch(); recent.refetch(); };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={<RefreshControl refreshing={stats.isRefetching} onRefresh={refresh} />}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Stat label="Total sales" value={money(d.totalSales)} />
        <Stat label="Purchases" value={money(d.totalPurchases)} />
        <Stat label="GST payable" value={money(d.totalGstPayable)} />
        <Stat label="Outstanding" value={money(d.totalOutstanding)} tone={d.totalOutstanding > 0 ? colors.danger : undefined} />
        <Stat label="Invoices" value={String(d.invoiceCount)} />
        <Stat label="Customers" value={String(d.customerCount)} />
      </View>
      {!!d.overdueInvoiceCount && <Text style={{ color: colors.danger }}>{d.overdueInvoiceCount} invoice(s) overdue</Text>}
      <View style={s.card}>
        <Text style={[s.title, { marginBottom: 8 }]}>Recent invoices</Text>
        {(recent.data ?? []).length === 0 && <Text style={s.muted}>No invoices yet.</Text>}
        {(recent.data ?? []).map((inv) => (
          <Pressable key={inv.id} onPress={() => router.push(`/invoice/${inv.id}`)}
            style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ fontWeight: "600", color: colors.text }}>{inv.invoiceNumber}</Text>
              <Text style={s.muted} numberOfLines={1}>{inv.customerName} · {date(inv.invoiceDate)}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={{ fontWeight: "600", color: colors.text }}>{money(inv.grandTotal)}</Text>
              <StatusPill status={inv.status} />
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
