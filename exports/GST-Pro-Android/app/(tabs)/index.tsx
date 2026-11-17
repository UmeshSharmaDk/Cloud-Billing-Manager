import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { PlanExpiryBanner } from "@/lib/PlanExpiry";
import type { DashboardStats, Invoice, Product } from "@/lib/types";
import { Button, Card, colors, ErrorView, Loading, Row, s, StatusPill } from "@/lib/ui";

type Month = { month: string; sales: number; purchases: number; gst: number };
type Top = { productId: number; productName: string; totalQuantity: number; totalRevenue: number };
type GstSummary = Record<"outputCgst" | "outputSgst" | "outputIgst" | "inputCgst" | "inputSgst" | "inputIgst" | "netPayable", number>;
const get = <T,>(path: string) => ({ queryKey: [path], queryFn: () => api<T>(path) });

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
  const recent = useQuery(get<Invoice[]>("/dashboard/recent-invoices"));
  const months = useQuery(get<Month[]>("/dashboard/monthly-revenue"));
  const top = useQuery(get<Top[]>("/dashboard/top-products"));
  const gst = useQuery(get<GstSummary>("/dashboard/gst-summary"));
  const low = useQuery(get<Product[]>("/dashboard/low-stock"));

  if (stats.isLoading) return <Loading layout="dashboard" />;
  if (stats.error) return <ErrorView error={stats.error} onRetry={stats.refetch} />;
  const d = stats.data!;
  const refresh = () => [stats, recent, months, top, gst, low].forEach((q) => q.refetch());
  const peak = Math.max(1, ...(months.data ?? []).map((m) => m.sales));

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={<RefreshControl refreshing={stats.isRefetching} onRefresh={refresh} />}>
      <PlanExpiryBanner />
      <Button title="New invoice" onPress={() => router.push("/invoice/new")} />
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
      {!!months.data?.length && (
        <Card title="Monthly sales">
          {months.data.map((m) => (
            <View key={m.month} style={{ gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={s.muted}>{m.month}</Text>
                <Text style={{ color: colors.text, fontWeight: "600" }}>{money(m.sales)}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.primary, width: `${(m.sales / peak) * 100}%` }} />
              </View>
            </View>
          ))}
        </Card>
      )}
      {!!gst.data && (
        <Card title="GST this month">
          <Row label="Output CGST / SGST" value={`${money(gst.data.outputCgst)} / ${money(gst.data.outputSgst)}`} />
          <Row label="Output IGST" value={money(gst.data.outputIgst)} />
          <Row label="Input CGST / SGST" value={`${money(gst.data.inputCgst)} / ${money(gst.data.inputSgst)}`} />
          <Row label="Input IGST" value={money(gst.data.inputIgst)} />
          <Row label="Net payable" value={money(gst.data.netPayable)} />
        </Card>
      )}
      {!!top.data?.length && (
        <Card title="Top products">
          {top.data.map((p) => <Row key={p.productId ?? p.productName} label={`${p.productName} (${p.totalQuantity})`} value={money(p.totalRevenue)} />)}
        </Card>
      )}
      {!!low.data?.length && (
        <Card title="Low stock">
          {low.data.map((p) => (
            <Pressable key={p.id} onPress={() => router.push(`/product/${p.id}`)}>
              <Row label={p.name} value={`${p.stockQuantity} ${p.unit}`} />
            </Pressable>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
