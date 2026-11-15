import { Stack, useLocalSearchParams } from "expo-router";
import { EntityForm, type FieldSpec } from "@/lib/EntityForm";

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

export default function ProductForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: id ? "Edit product" : "New product" }} />
      <EntityForm fields={fields} defaults={{ unit: "Nos", gstRate: "18", stockQuantity: "0" }}
        load={id ? `/products/${id}` : undefined} target={id ? `/products/${id}` : "/products"} method={id ? "PATCH" : "POST"} />
    </>
  );
}
