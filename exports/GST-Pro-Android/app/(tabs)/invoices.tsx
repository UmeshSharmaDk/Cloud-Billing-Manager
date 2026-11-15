import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { date, money } from "@/lib/format";
import type { Invoice } from "@/lib/types";
import { usePaged } from "@/lib/usePaged";
import { colors, ErrorView, Loading, s, StatusPill } from "@/lib/ui";

const FILTERS = ["all", "unpaid", "partial", "paid"] as const;

export default function Invoices() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof FILTERS)[number]>("all");
  const params: Record<string, string> = {};
  if (search.trim()) params.search = search.trim();
  if (status !== "all") params.status = status;
  const q = usePaged<Invoice>("/invoices", "invoices", params);

  return (
    <View style={s.screen}>
      <View style={{ padding: 12, gap: 10, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TextInput style={s.input} placeholder="Search by invoice number" value={search} onChangeText={setSearch}
          autoCapitalize="characters" placeholderTextColor={colors.muted} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {FILTERS.map((f) => (
            <Pressable key={f} onPress={() => setStatus(f)}
              style={[s.pill, { borderColor: status === f ? colors.primary : colors.border, backgroundColor: status === f ? colors.primary : "transparent", paddingHorizontal: 12, paddingVertical: 6 }]}>
              <Text style={[s.pillText, { color: status === f ? "#fff" : colors.muted }]}>{f}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {q.isLoading ? <Loading /> : q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : (
        <FlatList
          data={q.items}
          keyExtractor={(i) => String(i.id)}
          refreshing={q.isRefetching}
          onRefresh={q.refetch}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          ListEmptyComponent={<Text style={[s.muted, { padding: 24, textAlign: "center" }]}>No invoices found.</Text>}
          renderItem={({ item }) => (
            <Pressable style={[s.listItem, { flexDirection: "row", justifyContent: "space-between" }]} onPress={() => router.push(`/invoice/${item.id}`)}>
              <View style={{ flexShrink: 1 }}>
                <Text style={{ fontWeight: "600", color: colors.text }}>{item.invoiceNumber}</Text>
                <Text style={s.muted} numberOfLines={1}>{item.customerName}</Text>
                <Text style={s.muted}>{date(item.invoiceDate)}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Text style={{ fontWeight: "700", color: colors.text }}>{money(item.grandTotal)}</Text>
                <StatusPill status={item.status} />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
