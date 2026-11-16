import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import { useState, type ReactNode } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { usePaged } from "./usePaged";
import { colors, ErrorView, Loading, s } from "./ui";

/** Searchable, paged list over a `{ <key>: T[], total }` endpoint, with an optional "new" button. */
export function ListScreen<T extends { id: number }>({ path, listKey, params = {}, search = "Search", filters, renderItem, href, newHref, empty }: {
  path: string; listKey: string; params?: Record<string, string>; search?: string | false; filters?: ReactNode;
  renderItem: (item: T) => ReactNode; href: (item: T) => Href | null; newHref?: Href; empty: string;
}) {
  const [term, setTerm] = useState("");
  const q = usePaged<T>(path, listKey, term.trim() ? { ...params, search: term.trim() } : params);
  return (
    <View style={s.screen}>
      {(search || filters) && (
        <View style={{ padding: 12, gap: 10, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          {search && <TextInput style={s.input} placeholder={search} value={term} onChangeText={setTerm} placeholderTextColor={colors.muted} />}
          {filters}
        </View>
      )}
      {q.isLoading ? <Loading /> : q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : (
        <FlatList
          data={q.items}
          keyExtractor={(i) => String(i.id)}
          refreshing={q.isRefetching}
          onRefresh={q.refetch}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          ListEmptyComponent={<Text style={[s.muted, { padding: 24, textAlign: "center" }]}>{empty}</Text>}
          contentContainerStyle={{ paddingBottom: 96 }}
          renderItem={({ item }) => {
            const to = href(item);
            return (
              <Pressable disabled={!to} style={[s.listItem, { flexDirection: "row", justifyContent: "space-between", gap: 12 }]}
                onPress={() => to && router.push(to)}>
                {renderItem(item)}
              </Pressable>
            );
          }}
        />
      )}
      {newHref && <Fab onPress={() => router.push(newHref)} />}
    </View>
  );
}

export function Fab({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Add new"
      style={{ position: "absolute", right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", elevation: 4 }}>
      <Ionicons name="add" size={30} color={colors.onPrimary} />
    </Pressable>
  );
}

/** The usual two-column list row: title and subtitle on the left, a value on the right. */
export function Line({ title, sub, right, below }: { title: string; sub?: string; right?: ReactNode; below?: ReactNode }) {
  return (
    <>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ fontWeight: "600", color: colors.text }}>{title}</Text>
        {!!sub && <Text style={s.muted} numberOfLines={1}>{sub}</Text>}
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        {typeof right === "string" ? <Text style={{ fontWeight: "700", color: colors.text }}>{right}</Text> : right}
        {below}
      </View>
    </>
  );
}
