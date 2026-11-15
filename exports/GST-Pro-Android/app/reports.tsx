import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import type { Invoice } from "@/lib/types";
import { Button, Card, Chips, colors, ErrorView, Loading, Row, s } from "@/lib/ui";

const KINDS = ["GSTR-1", "GSTR-3B", "HSN"] as const;
type R = Record<string, number> & { invoices?: Invoice[]; items?: Record<string, string | number>[] };

export default function Reports() {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("GSTR-1");
  const [at, setAt] = useState(() => { const d = new Date(); return { month: d.getMonth() + 1, year: d.getFullYear() }; });
  const step = (n: number) => setAt(({ month, year }) => { const d = new Date(year, month - 1 + n, 1); return { month: d.getMonth() + 1, year: d.getFullYear() }; });
  const path = `/reports/${kind.toLowerCase().replace("-", "")}?month=${at.month}&year=${at.year}`;
  const q = useQuery({ queryKey: [path], queryFn: () => api<R>(path) });
  const label = new Date(at.year, at.month - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const d = q.data;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Stack.Screen options={{ title: "GST reports" }} />
      <Chips options={KINDS} value={kind} onChange={setKind} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}><Button title="‹ Prev" variant="outline" onPress={() => step(-1)} /></View>
        <Text style={[s.title, { flex: 2, textAlign: "center" }]}>{label}</Text>
        <View style={{ flex: 1 }}><Button title="Next ›" variant="outline" onPress={() => step(1)} /></View>
      </View>
      {q.isLoading ? <Loading /> : q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : d && (
        <>
          {kind === "GSTR-1" && (
            <Card title="Outward supplies">
              <Row label="Invoices" value={String(d.totalInvoices ?? 0)} />
              <Row label="Taxable value" value={money(d.totalTaxableValue)} />
              <Row label="CGST" value={money(d.totalCgst)} />
              <Row label="SGST" value={money(d.totalSgst)} />
              <Row label="IGST" value={money(d.totalIgst)} />
              <Row label="Total tax" value={money(d.totalTax)} />
              <Row label={`Intra-state (${d.intraStateCount ?? 0})`} value={money(d.intraStateTaxable)} />
              <Row label={`Inter-state (${d.interStateCount ?? 0})`} value={money(d.interStateTaxable)} />
            </Card>
          )}
          {kind === "GSTR-3B" && (
            <>
              <Card title="3.1 Outward supplies">
                <Row label="Taxable value" value={money(d.outwardTaxable)} />
                <Row label="CGST / SGST" value={`${money(d.outwardCgst)} / ${money(d.outwardSgst)}`} />
                <Row label="IGST" value={money(d.outwardIgst)} />
              </Card>
              <Card title="4 Input tax credit">
                <Row label="CGST / SGST" value={`${money(d.inputCgst)} / ${money(d.inputSgst)}`} />
                <Row label="IGST" value={money(d.inputIgst)} />
              </Card>
              <Card title="Net tax payable">
                <Row label="CGST" value={money(d.netCgst)} />
                <Row label="SGST" value={money(d.netSgst)} />
                <Row label="IGST" value={money(d.netIgst)} />
                <Row label="Total" value={money(d.totalTax)} />
              </Card>
            </>
          )}
          {kind === "HSN" && (
            <Card title="HSN summary">
              {!d.items?.length && <Text style={s.muted}>No invoice data for {label}.</Text>}
              {d.items?.map((it) => (
                <View key={String(it.hsnCode)} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Row label={`HSN ${it.hsnCode}`} value={money(Number(it.taxableValue))} />
                  <Text style={s.muted}>{it.description} · {it.quantity} {it.uqc} · tax {money(Number(it.totalTax))}</Text>
                </View>
              ))}
            </Card>
          )}
          {kind !== "HSN" && !!d.invoices?.length && (
            <Card title="Invoices">
              {d.invoices.map((inv) => (
                <Pressable key={inv.id} onPress={() => router.push(`/invoice/${inv.id}`)}>
                  <Row label={`${inv.invoiceNumber} · ${date(inv.invoiceDate)}`} value={money(inv.grandTotal)} />
                </Pressable>
              ))}
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}
