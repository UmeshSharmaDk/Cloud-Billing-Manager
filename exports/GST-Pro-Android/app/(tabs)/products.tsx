import { useState } from "react";
import { Text } from "react-native";
import { ListScreen, Line } from "@/lib/ListScreen";
import { money } from "@/lib/format";
import type { Product } from "@/lib/types";
import { Chips, colors } from "@/lib/ui";

const FILTERS = ["all", "low stock"] as const;

// Same rule as the server: a product with no threshold of its own uses 5.
export const isLow = (p: Product) => p.stockQuantity <= (p.lowStockThreshold ?? 5);

export default function Products() {
  const [f, setF] = useState<(typeof FILTERS)[number]>("all");
  return (
    <ListScreen<Product> path="/products" listKey="products" params={f === "all" ? {} : { lowStock: "true" }}
      search="Search products" empty="No products found." filters={<Chips options={FILTERS} value={f} onChange={setF} />}
      href={(p) => `/product/${p.id}`} newHref="/product/form"
      renderItem={(p) => (
        <Line title={p.name} sub={[p.sku, p.hsnCode && `HSN ${p.hsnCode}`, `GST ${p.gstRate}%`].filter(Boolean).join(" · ")}
          right={money(p.sellingPrice)}
          below={<Text style={{ color: isLow(p) ? colors.danger : colors.muted, fontSize: 13 }}>{p.stockQuantity} {p.unit}</Text>} />
      )} />
  );
}
