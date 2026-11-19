import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { api } from "./api";
import { money } from "./format";
import type { Product } from "./types";
import { Card, colors, Field, Row, s, Select } from "./ui";

export type Line = {
  productId: number | null;
  description: string;
  hsnCode: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  gstRate: string;
  discount: string;
};

export const emptyLine = (): Line => ({ productId: null, description: "", hsnCode: "", quantity: "1", unit: "Nos", unitPrice: "", gstRate: "18", discount: "0" });

const GST = ["0", "3", "5", "12", "18", "28", "40"].map((r) => ({ value: r, label: `${r}%` }));
const n = (v: string) => Number(v) || 0;

/** Same arithmetic as the website's preview; the server recomputes the stored figures. */
export function calcLine(l: Line) {
  const taxable = n(l.quantity) * n(l.unitPrice) * (1 - n(l.discount) / 100);
  const gst = (taxable * n(l.gstRate)) / 100;
  return { taxable, gst, total: taxable + gst };
}

export const lineError = (lines: Line[]) =>
  lines.some((l) => !l.description.trim() || n(l.unitPrice) <= 0 || n(l.quantity) <= 0) ? "Every line needs a description, quantity and price." : null;

export const toItems = (lines: Line[], withDiscount: boolean) =>
  lines.map((l) => ({
    productId: l.productId, description: l.description.trim(), hsnCode: l.hsnCode.trim() || null,
    quantity: n(l.quantity), unit: l.unit.trim() || null, unitPrice: n(l.unitPrice), gstRate: n(l.gstRate),
    ...(withDiscount ? { discount: n(l.discount) } : {}),
  }));

// ponytail: the product picker lists the first 100 products; add server search if catalogs grow past that.
export const useAllProducts = () =>
  useQuery({ queryKey: ["/products", "picker"], queryFn: () => api<{ products: Product[] }>("/products?limit=100") });

export function LineItems({ lines, setLines, price, withDiscount }: {
  lines: Line[]; setLines: (f: (l: Line[]) => Line[]) => void; price: "sellingPrice" | "purchasePrice"; withDiscount: boolean;
}) {
  const products = useAllProducts().data?.products ?? [];
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, id: string) => {
    const p = products.find((x) => String(x.id) === id);
    if (p) set(i, { productId: p.id, description: p.name, hsnCode: p.hsnCode ?? "", unit: p.unit || "Nos", unitPrice: String(p[price] ?? ""), gstRate: String(p.gstRate) });
  };
  const totals = lines.map(calcLine).reduce((a, c) => ({ taxable: a.taxable + c.taxable, gst: a.gst + c.gst, total: a.total + c.total }), { taxable: 0, gst: 0, total: 0 });

  return (
    <>
      {lines.map((l, i) => (
        <Card key={i} title={`Item ${i + 1}`} right={lines.length > 1 && (
          <Pressable onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Remove item ${i + 1}`}><Text style={{ color: colors.danger }}>Remove item</Text></Pressable>
        )}>
          {products.length > 0 && (
            <Select label="Product (optional)" value={l.productId ? String(l.productId) : ""} placeholder="Pick from inventory"
              options={products.map((p) => ({ value: String(p.id), label: `${p.name} · ${p.stockQuantity} ${p.unit}` }))} onChange={(v) => pick(i, v)} />
          )}
          <Field label="Description *" value={l.description} onChangeText={(v) => set(i, { description: v })} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Field label="Qty *" value={l.quantity} keyboardType="decimal-pad" onChangeText={(v) => set(i, { quantity: v })} /></View>
            <View style={{ flex: 1 }}><Field label="Unit" value={l.unit} onChangeText={(v) => set(i, { unit: v })} /></View>
            <View style={{ flex: 1.4 }}><Field label="Price ₹ *" value={l.unitPrice} keyboardType="decimal-pad" onChangeText={(v) => set(i, { unitPrice: v })} /></View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Field label="HSN" value={l.hsnCode} keyboardType="number-pad" onChangeText={(v) => set(i, { hsnCode: v })} /></View>
            <View style={{ flex: 1 }}><Select label="GST" value={l.gstRate} options={GST} onChange={(v) => set(i, { gstRate: v })} /></View>
            {withDiscount && <View style={{ flex: 1 }}><Field label="Disc %" value={l.discount} keyboardType="decimal-pad" onChangeText={(v) => set(i, { discount: v })} /></View>}
          </View>
          <Text style={[s.muted, { textAlign: "right" }]}>Line total {money(calcLine(l).total)}</Text>
        </Card>
      ))}
      <Pressable onPress={() => setLines((ls) => [...ls, emptyLine()])} style={{ padding: 8, minHeight: 44, justifyContent: "center" }} accessibilityRole="button">
        <Text style={{ color: colors.primary, fontWeight: "600", textAlign: "center" }}>+ Add another item</Text>
      </Pressable>
      <Card>
        <Row label="Taxable value" value={money(totals.taxable)} />
        <Row label="GST" value={money(totals.gst)} />
        <Row label="Total (before round off)" value={money(totals.total)} />
      </Card>
    </>
  );
}
