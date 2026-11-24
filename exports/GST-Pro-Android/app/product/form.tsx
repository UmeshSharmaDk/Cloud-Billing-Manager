import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Text } from "react-native";
import { EntityForm, type FieldSpec } from "@/lib/EntityForm";
import { ai } from "@/lib/ai";
import { Button, s } from "@/lib/ui";

const GST_RATES = ["0", "0.1", "0.25", "3", "5", "12", "18", "28", "40"].map((r) => ({ value: r, label: `${r}%` }));

const fields: FieldSpec[] = [
  { key: "name", label: "Product name", required: true },
  { key: "sku", label: "SKU", kind: "upper" },
  { key: "hsnCode", label: "HSN / SAC code", kind: "phone" },
  { key: "category", label: "Category" },
  { key: "unit", label: "Unit", required: true, placeholder: "Nos, Kg, Box…" },
  { key: "gstRate", label: "GST rate", kind: "select", numeric: true, options: GST_RATES, required: true },
  { key: "sellingPrice", label: "Selling price (₹)", kind: "number" },
  { key: "purchasePrice", label: "Purchase price (₹)", kind: "number" },
  { key: "stockQuantity", label: "Stock quantity", kind: "number" },
  { key: "lowStockThreshold", label: "Low stock alert at", kind: "number" },
  { key: "description", label: "Description", kind: "multiline" },
];

/** The AI suggests the HSN/SAC code and GST rate from the product's name. */
function HsnSuggest({ v, set }: { v: Record<string, string>; set: (k: string, x: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const suggest = async () => {
    setBusy(true);
    try {
      const r = await ai<{ hsnCode: string; gstRate: number; aiRate: number; reason: string }>("hsn", { name: v.name, description: v.description || v.category || undefined });
      if (r.hsnCode) set("hsnCode", r.hsnCode);
      set("gstRate", String(r.gstRate));
      setNote(`${r.hsnCode} · ${r.gstRate}%. ${r.reason} Check with your CA if unsure.`);
    } catch (e) {
      Alert.alert("The AI could not suggest a code", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button title="Suggest HSN and GST" variant="outline" busy={busy} onPress={suggest}
        disabledReason={(v.name ?? "").trim().length >= 2 ? undefined : "Type the product name first."} />
      {!!note && <Text style={s.muted}>{note}</Text>}
    </>
  );
}

export default function ProductForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: id ? "Edit product" : "New product" }} />
      <EntityForm fields={fields} defaults={{ unit: "Nos", gstRate: "18", stockQuantity: "0" }}
        load={id ? `/products/${id}` : undefined} target={id ? `/products/${id}` : "/products"} method={id ? "PATCH" : "POST"}
        extra={(v, set) => <HsnSuggest v={v} set={set} />} />
    </>
  );
}
