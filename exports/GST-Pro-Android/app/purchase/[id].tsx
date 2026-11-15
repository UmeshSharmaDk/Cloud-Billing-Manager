import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { api, viewAs } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useSave } from "@/lib/save";
import type { Purchase } from "@/lib/types";
import { Button, Card, colors, ErrorView, Loading, Row, s, StatusPill } from "@/lib/ui";

const STATUSES = ["unpaid", "partial", "paid"] as const;

export default function PurchaseDetail() {
  const { id, asUser } = useLocalSearchParams<{ id: string; asUser?: string }>();
  const path = viewAs(`/purchases/${encodeURIComponent(id)}`, asUser);
  const q = useQuery({ queryKey: [path], queryFn: () => api<Purchase>(path) });
  const { busy, run } = useSave();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorView error={q.error} onRetry={q.refetch} />;
  const p = q.data!;
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Stack.Screen options={{ title: p.invoiceNumber }} />
      <Card title={p.vendorName} right={<StatusPill status={p.status} />}>
        {!!p.vendorGstin && <Row label="GSTIN" value={p.vendorGstin} />}
        <Row label="Bill number" value={p.invoiceNumber} />
        <Row label="Bill date" value={date(p.invoiceDate)} />
      </Card>
      {!asUser && p.status !== "cancelled" && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {STATUSES.filter((x) => x !== p.status).map((x) => (
            <View key={x} style={{ flex: 1 }}>
              <Button title={`Mark ${x}`} variant={x === "paid" ? "primary" : "outline"} busy={busy}
                onPress={() => run(() => api(`/purchases/${p.id}`, { method: "PATCH", body: { paymentStatus: x } }))} />
            </View>
          ))}
        </View>
      )}
      <Card title="Items">
        {p.items.map((it, i) => (
          <View key={it.id ?? i} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <Text style={{ color: colors.text, fontWeight: "500", flexShrink: 1 }}>{it.description}</Text>
              <Text style={{ color: colors.text, fontWeight: "600" }}>{money(it.totalAmount)}</Text>
            </View>
            <Text style={s.muted}>{it.quantity} {it.unit ?? ""} × {money(it.unitPrice)} · GST {it.gstRate}%{it.hsnCode ? ` · HSN ${it.hsnCode}` : ""}</Text>
          </View>
        ))}
      </Card>
      <Card>
        <Row label="Taxable value" value={money(p.subtotal)} />
        {p.igst ? <Row label="IGST" value={money(p.igst)} /> : (
          <>
            <Row label="CGST" value={money(p.cgst)} />
            <Row label="SGST" value={money(p.sgst)} />
          </>
        )}
        <Row label="Grand total" value={money(p.grandTotal)} />
        {Number((p as any).tdsAmount) > 0 && (
          <>
            <Row label={`TDS ${(p as any).tdsSection ? `u/s ${(p as any).tdsSection} ` : ""}@ ${(p as any).tdsRate}%`} value={`− ${money((p as any).tdsAmount)}`} />
            <Row label="Net payable" value={money((p as any).netPayable)} />
          </>
        )}
      </Card>
      {!!p.notes && <Card><Text style={s.muted}>{p.notes}</Text></Card>}
    </ScrollView>
  );
}
