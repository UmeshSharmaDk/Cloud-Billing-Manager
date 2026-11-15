import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import type { Customer, Invoice } from "@/lib/types";
import { colors, ErrorView, Loading, Row, s, StatusPill } from "@/lib/ui";

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ["customer", id], queryFn: () => api<Customer>(`/customers/${encodeURIComponent(id)}`) });
  const invoices = useQuery({
    queryKey: ["/invoices", { customerId: id }],
    queryFn: () => api<{ invoices: Invoice[] }>(`/invoices?customerId=${encodeURIComponent(id)}&limit=20`),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorView error={q.error} onRetry={q.refetch} />;
  const c = q.data!;
  const address = [c.address, c.city, c.state, c.pincode].filter(Boolean).join(", ");

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Stack.Screen options={{ title: c.name }} />
      <View style={s.card}>
        <Text style={[s.title, { marginBottom: 8 }]}>{c.name}</Text>
        <Row label="GSTIN" value={c.gstin || "—"} />
        <Row label="Outstanding" value={money(c.outstandingBalance)} />
        {!!address && <Row label="Address" value={address} />}
        {!!c.phone && (
          <Pressable onPress={() => Linking.openURL(`tel:${c.phone}`)}><Row label="Phone" value={c.phone} /></Pressable>
        )}
        {!!c.email && (
          <Pressable onPress={() => Linking.openURL(`mailto:${c.email}`)}><Row label="Email" value={c.email} /></Pressable>
        )}
      </View>
      <View style={s.card}>
        <Text style={[s.title, { marginBottom: 8 }]}>Invoices</Text>
        {invoices.isLoading && <Text style={s.muted}>Loading…</Text>}
        {invoices.data?.invoices.length === 0 && <Text style={s.muted}>No invoices for this customer.</Text>}
        {invoices.data?.invoices.map((inv) => (
          <Pressable key={inv.id} onPress={() => router.push(`/invoice/${inv.id}`)}
            style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View>
              <Text style={{ fontWeight: "600", color: colors.text }}>{inv.invoiceNumber}</Text>
              <Text style={s.muted}>{date(inv.invoiceDate)}</Text>
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
