import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { PlanExpiryBanner } from "@/lib/PlanExpiry";
import type { Business, DashboardStats, Invoice, Product } from "@/lib/types";
import { reminderLink } from "@/lib/whatsapp";
import { Button, Card, colors, ErrorView, Loading, Row, s, StatusPill } from "@/lib/ui";

type Month = { month: string; sales: number; purchases: number; gst: number };
type Top = { productId: number; productName: string; totalQuantity: number; totalRevenue: number };
type GstSummary = Record<"outputCgst" | "outputSgst" | "outputIgst" | "inputCgst" | "inputSgst" | "inputIgst" | "netPayable", number>;
const get = <T,>(path: string) => ({ queryKey: [path], queryFn: () => api<T>(path) });
type ToDo = Invoice & { phone?: string | null };
type Summary = {
  stats: DashboardStats & { productCount?: number }; recentInvoices: Invoice[]; monthlyRevenue: Month[];
  lowStock: Product[]; gstSummary: GstSummary; repeatDue: ToDo[]; overdue: ToDo[];
};

/** A short getting-started list, shown until every step is done. */
function FirstSteps({ steps }: { steps: { label: string; href: string; done: boolean }[] }) {
  const left = steps.filter((x) => !x.done).length;
  if (left === 0) return null;
  return (
    <Card title={`Get started · ${steps.length - left} of ${steps.length} done`}>
      {steps.map((x) => (
        <Pressable key={x.label} onPress={() => router.push(x.href as any)} accessibilityRole="link"
          style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={{ color: x.done ? colors.success : colors.muted, fontSize: 16 }}>{x.done ? "\u2713" : "\u25CB"}</Text>
          <Text style={{ color: x.done ? colors.muted : colors.text, textDecorationLine: x.done ? "line-through" : "none", flexShrink: 1 }}>{x.label}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

/** A small muted label above its number, with an optional note under it. */
export function Figure({ label, value, note, tone }: { label: string; value: string; note?: string | null; tone?: string }) {
  return (
    <View style={{ flexBasis: "47%", flexGrow: 1 }}>
      <Text style={s.muted}>{label}</Text>
      <Text style={{ fontSize: 16, fontWeight: "600", color: tone ?? colors.text, marginTop: 2 }}>{value}</Text>
      {!!note && <Text style={[s.muted, { fontSize: 12 }]}>{note}</Text>}
    </View>
  );
}

/** "+12.5% vs Oct". Says what it compares with; null when there is nothing to compare. */
export function deltaText(current: number, previous: number, against: string) {
  if (!previous) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return `${pct >= 0 ? "+" : "\u2212"}${Math.abs(pct).toFixed(1)}% vs ${against}`;
}

/** Six thin columns, one per month, scaled to the busiest. */
function Sparkline({ values }: { values: number[] }) {
  const top = Math.max(1, ...values);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 32 }} accessibilityLabel="Sales, last six months">
      {values.map((v, i) => <View key={i} style={{ width: 6, height: Math.max(2, (v / top) * 32), borderRadius: 1, backgroundColor: i === values.length - 1 ? colors.text : colors.muted }} />)}
    </View>
  );
}

export default function Dashboard() {
  // One request for the whole screen instead of five.
  const summary = useQuery(get<Summary>("/dashboard/summary"));
  const top = useQuery(get<Top[]>("/dashboard/top-products"));
  const business = useQuery(get<Business>("/business")).data;

  if (summary.isLoading) return <Loading layout="dashboard" />;
  if (summary.error) return <ErrorView error={summary.error} onRetry={summary.refetch} />;
  const { stats: d, repeatDue, overdue } = summary.data!;
  const recent = { data: summary.data!.recentInvoices };
  const months = { data: summary.data!.monthlyRevenue };
  const gst = { data: summary.data!.gstSummary };
  const low = { data: summary.data!.lowStock };
  const refresh = () => [summary, top].forEach((q) => q.refetch());
  const peak = Math.max(1, ...(months.data ?? []).map((m) => m.sales));
  // The revenue series is built on UTC months, the last row being this month.
  const now = new Date();
  const monthName = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const series = months.data ?? [];
  const cur = series[series.length - 1];
  const prev = series[series.length - 2];

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={<RefreshControl refreshing={summary.isRefetching} onRefresh={refresh} />}>
      <PlanExpiryBanner />
      <Text style={s.title}>Revenue · 1 {monthName(0)} to {now.getUTCDate()} {monthName(0)} {now.getUTCFullYear()}</Text>
      <Button title="New invoice" onPress={() => router.push("/invoice/new")} />
      <FirstSteps steps={[
        { label: "Add your GSTIN and address", href: "/settings", done: !!business?.gstin },
        { label: "Add your UPI ID so customers can pay by QR", href: "/settings", done: !!business?.upiId },
        { label: "Add your first product", href: "/product/form", done: (d.productCount ?? 0) > 0 },
        { label: "Add your first customer", href: "/customer/form", done: (d.customerCount ?? 0) > 0 },
        { label: "Create your first invoice", href: "/invoice/new", done: (d.invoiceCount ?? 0) > 0 },
      ]} />
      {(repeatDue.length > 0 || overdue.length > 0) && (
        <Card title="To do">
          {repeatDue.map((inv) => (
            <View key={`r${inv.id}`} style={{ gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: "600" }}>Repeat {inv.invoiceNumber} for {inv.customerName}</Text>
              <Text style={s.muted}>Monthly invoice, last sent {date(inv.invoiceDate)} · {money(inv.grandTotal)}</Text>
              <Button title="Create this month's invoice" variant="outline"
                onPress={() => router.push({ pathname: "/invoice/new", params: { from: String(inv.id), repeat: "1" } })} />
            </View>
          ))}
          {overdue.map((inv) => {
            const wa = reminderLink(inv, inv.phone, { name: business?.name, upiId: business?.upiId as string }, money, date);
            return (
              <View key={`o${inv.id}`} style={{ gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Pressable onPress={() => router.push(`/invoice/${inv.id}`)}>
                  <Text style={{ color: colors.text, fontWeight: "600" }}>{inv.customerName} owes {money(inv.grandTotal - (inv.paidAmount ?? 0))}</Text>
                  <Text style={s.muted}>{inv.invoiceNumber} was due {date(inv.dueDate!)}</Text>
                </Pressable>
                {wa && <Button title="Send WhatsApp reminder" variant="outline" onPress={() => Linking.openURL(wa).catch(() => Alert.alert("WhatsApp is not installed"))} />}
              </View>
            );
          })}
        </Card>
      )}
      <View style={[s.card, { gap: 12 }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={s.muted}>Sales this month</Text>
            <Text style={{ fontSize: 32, fontWeight: "700", color: colors.text, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{money(cur?.sales ?? 0)}</Text>
            <Text style={s.muted}>{(prev && deltaText(cur.sales, prev.sales, monthName(-1))) ?? `No sales in ${monthName(-1)} to compare with`}</Text>
          </View>
          {series.length > 1 && <Sparkline values={series.map((m) => m.sales)} />}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
          <Figure label="Purchases this month" value={money(cur?.purchases ?? 0)} note={prev ? deltaText(cur.purchases, prev.purchases, monthName(-1)) : null} />
          <Figure label="GST this month" value={money(cur?.gst ?? 0)} />
        </View>
      </View>
      <View style={[s.card, { flexDirection: "row", flexWrap: "wrap", gap: 12 }]}>
        <Figure label="Outstanding" value={money(d.totalOutstanding)} note={`${d.overdueInvoiceCount} invoices overdue`} tone={d.totalOutstanding > 0 ? colors.danger : undefined} />
        <Figure label="GST payable, all time" value={money(d.totalGstPayable)} />
        <Figure label="Sales, all time" value={money(d.totalSales)} note={`${d.invoiceCount} invoices`} />
        <Figure label="Purchases, all time" value={money(d.totalPurchases)} />
      </View>
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
        <Card title={`Sales by month · ${series[0]?.month ?? ""} to ${cur?.month ?? ""}`}>
          {months.data.map((m) => (
            <View key={m.month} style={{ gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={s.muted}>{m.month}</Text>
                <Text style={{ color: colors.text, fontWeight: "600" }}>{money(m.sales)}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border }}>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.text, width: `${(m.sales / peak) * 100}%` }} />
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
