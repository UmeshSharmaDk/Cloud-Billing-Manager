import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { money } from "@/lib/format";
import type { Customer } from "@/lib/types";
import { usePaged } from "@/lib/usePaged";
import { colors, ErrorView, Loading, s } from "@/lib/ui";

export default function Customers() {
  const [search, setSearch] = useState("");
  const params: Record<string, string> = search.trim() ? { search: search.trim() } : {};
  const q = usePaged<Customer>("/customers", "customers", params);

  return (
    <View style={s.screen}>
      <View style={{ padding: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TextInput style={s.input} placeholder="Search customers" value={search} onChangeText={setSearch} placeholderTextColor={colors.muted} />
      </View>
      {q.isLoading ? <Loading /> : q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : (
        <FlatList
          data={q.items}
          keyExtractor={(c) => String(c.id)}
          refreshing={q.isRefetching}
          onRefresh={q.refetch}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          ListEmptyComponent={<Text style={[s.muted, { padding: 24, textAlign: "center" }]}>No customers found.</Text>}
          renderItem={({ item }) => (
            <Pressable style={[s.listItem, { flexDirection: "row", justifyContent: "space-between" }]} onPress={() => router.push(`/customer/${item.id}`)}>
              <View style={{ flexShrink: 1 }}>
                <Text style={{ fontWeight: "600", color: colors.text }}>{item.name}</Text>
                <Text style={s.muted} numberOfLines={1}>{[item.gstin, item.city].filter(Boolean).join(" · ") || "—"}</Text>
              </View>
              {!!item.outstandingBalance && (
                <Text style={{ color: colors.danger, fontWeight: "600" }}>{money(item.outstandingBalance)}</Text>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
