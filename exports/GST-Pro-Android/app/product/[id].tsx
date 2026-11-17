import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, Text } from "react-native";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { Product } from "@/lib/types";
import { Button, Card, colors, ErrorView, Loading, Row, s, pullToRefresh } from "@/lib/ui";
import { isLow } from "../(tabs)/products";

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: [`/products/${id}`], queryFn: () => api<Product>(`/products/${encodeURIComponent(id)}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorView error={q.error} onRetry={q.refetch} />;
  const p = q.data!;
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }} refreshControl={pullToRefresh(q)}>
      <Stack.Screen options={{ title: p.name }} />
      <Card title={p.name}>
        {isLow(p) && <Text style={{ color: colors.danger, fontWeight: "600" }}>Low stock</Text>}
        <Row label="In stock" value={`${p.stockQuantity} ${p.unit}`} />
        <Row label="Low stock alert at" value={String(p.lowStockThreshold ?? 5)} />
        <Row label="Selling price" value={money(p.sellingPrice)} />
        <Row label="Purchase price" value={money(p.purchasePrice)} />
        <Row label="GST rate" value={`${p.gstRate}%`} />
        <Row label="HSN / SAC" value={p.hsnCode || "—"} />
        <Row label="SKU" value={p.sku || "—"} />
        <Row label="Category" value={p.category || "—"} />
        {!!p.description && <Text style={s.muted}>{p.description}</Text>}
      </Card>
      <Button title="Edit" variant="outline" onPress={() => router.push({ pathname: "/product/form", params: { id } })} />
    </ScrollView>
  );
}
