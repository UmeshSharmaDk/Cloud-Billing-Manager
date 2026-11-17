import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import type { Customer } from "@/lib/types";
import { Button, Card, colors, ErrorView, Loading, Row, s, StatusPill } from "@/lib/ui";

type Doc = { id: number; invoiceNumber: string; invoiceDate: string; grandTotal: number; status: string };

/** Customer or vendor detail, with that party's invoices or purchase bills. */
export function PartyDetail({ kind }: { kind: "customer" | "vendor" }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const plural = kind === "customer" ? "customers" : "vendors";
  const docs = kind === "customer" ? "invoices" : "purchases";
  const q = useQuery({ queryKey: [`/${plural}/${id}`], queryFn: () => api<Customer>(`/${plural}/${encodeURIComponent(id)}`) });
  const related = useQuery({
    queryKey: [`/${docs}`, { [`${kind}Id`]: id }],
    queryFn: () => api<Record<string, Doc[]>>(`/${docs}?${kind}Id=${encodeURIComponent(id)}&limit=20`),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorView error={q.error} onRetry={q.refetch} />;
  const c = q.data!;
  const address = [c.address, c.city, c.state, c.pincode].filter(Boolean).join(", ");
  const list = related.data?.[docs] ?? [];

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Stack.Screen options={{ title: c.name }} />
      <Card title={c.name}>
        <Row label="GSTIN" value={c.gstin || "—"} />
        <Row label="Outstanding" value={money(c.outstandingBalance)} />
        {c.creditLimit != null && <Row label="Credit limit" value={money(c.creditLimit)} />}
        {!!address && <Row label="Address" value={address} />}
        {!!c.phone && <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`)}><Row label="Phone" value={c.phone} /></Pressable>}
        {!!c.email && <Pressable onPress={() => Linking.openURL(`mailto:${c.email}`)}><Row label="Email" value={c.email} /></Pressable>}
      </Card>
      <Button title="Edit" variant="outline" onPress={() => router.push({ pathname: `/${kind}/form`, params: { id } })} />
      <Card title={kind === "customer" ? "Invoices" : "Purchase bills"}>
        {related.isLoading && <Loading layout="rows" />}
        {related.data && list.length === 0 && <Text style={s.muted}>Nothing yet.</Text>}
        {list.map((d) => (
          <Pressable key={d.id} onPress={() => router.push(`/${kind === "customer" ? "invoice" : "purchase"}/${d.id}`)}
            style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View>
              <Text style={{ fontWeight: "600", color: colors.text }}>{d.invoiceNumber}</Text>
              <Text style={s.muted}>{date(d.invoiceDate)}</Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={{ fontWeight: "600", color: colors.text }}>{money(d.grandTotal)}</Text>
              <StatusPill status={d.status} />
            </View>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}

export default function CustomerDetail() {
  return <PartyDetail kind="customer" />;
}
