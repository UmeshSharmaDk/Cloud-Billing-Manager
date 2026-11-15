import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import type { Invoice } from "@/lib/types";
import { colors, ErrorView, Loading, Row, s, StatusPill } from "@/lib/ui";

export default function InvoiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ["invoice", id], queryFn: () => api<Invoice>(`/invoices/${encodeURIComponent(id)}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorView error={q.error} onRetry={q.refetch} />;
  const inv = q.data!;
  const due = inv.grandTotal - (inv.paidAmount ?? 0);

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Stack.Screen options={{ title: inv.invoiceNumber }} />
      <View style={s.card}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <Text style={s.title}>{inv.customerName}</Text>
          <StatusPill status={inv.status} />
        </View>
        {!!inv.customerGstin && <Row label="GSTIN" value={inv.customerGstin} />}
        <Row label="Type" value={inv.type.replace(/_/g, " ")} />
        <Row label="Invoice date" value={date(inv.invoiceDate)} />
        <Row label="Due date" value={date(inv.dueDate)} />
        {!!inv.placeOfSupply && <Row label="Place of supply" value={inv.placeOfSupply} />}
      </View>

      <View style={s.card}>
        <Text style={[s.title, { marginBottom: 8 }]}>Items</Text>
        {(inv.items ?? []).map((it, i) => (
          <View key={it.id ?? i} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <Text style={{ color: colors.text, fontWeight: "500", flexShrink: 1 }}>{it.description}</Text>
              <Text style={{ color: colors.text, fontWeight: "600" }}>{money(it.totalAmount)}</Text>
            </View>
            <Text style={s.muted}>
              {it.quantity} {it.unit ?? ""} × {money(it.unitPrice)} · GST {it.gstRate}%{it.hsnCode ? ` · HSN ${it.hsnCode}` : ""}
            </Text>
          </View>
        ))}
      </View>

      <View style={s.card}>
        <Row label="Taxable value" value={money(inv.subtotal)} />
        {inv.isInterstate ? <Row label="IGST" value={money(inv.igst)} /> : (
          <>
            <Row label="CGST" value={money(inv.cgst)} />
            <Row label="SGST" value={money(inv.sgst)} />
          </>
        )}
        {!!inv.roundOff && <Row label="Round off" value={money(inv.roundOff)} />}
        <Row label="Grand total" value={money(inv.grandTotal)} />
        <Row label="Paid" value={money(inv.paidAmount)} />
        {inv.status !== "cancelled" && due > 0 && <Row label="Balance due" value={money(due)} />}
      </View>
      {!!inv.notes && <View style={s.card}><Text style={s.muted}>{inv.notes}</Text></View>}
    </ScrollView>
  );
}
