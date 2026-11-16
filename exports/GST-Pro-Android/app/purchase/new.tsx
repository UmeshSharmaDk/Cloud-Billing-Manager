import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { annotateResult } from "@/lib/bill-text";
import { chooseFile, choosePdf, fileText, takePhoto } from "@/lib/importFile";
import { api } from "@/lib/api";
import { emptyLine, LineItems, lineError, toItems, useAllProducts, type Line } from "@/lib/LineItems";
import { today, useSave } from "@/lib/save";
import type { Purchase, Vendor } from "@/lib/types";
import { Button, Card, colors, Field, Form, Select } from "@/lib/ui";

export default function NewPurchase() {
  const vendors = useQuery({ queryKey: ["/vendors", "picker"], queryFn: () => api<{ vendors: Vendor[] }>("/vendors?limit=100") }).data?.vendors ?? [];
  const [vendorId, setVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [tds, setTds] = useState({ section: "", rate: "" });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const { busy, run } = useSave();
  const products = useAllProducts().data?.products ?? [];
  const [reading, setReading] = useState(false);
  const [imported, setImported] = useState<string | null>(null);

  /** Fill the form from a photo or file of the vendor's bill, the same way the website does. */
  const importBill = async (pick: () => ReturnType<typeof takePhoto>) => {
    try {
      const file = await pick();
      if (!file) return;
      setReading(true);
      const result = annotateResult(await fileText(file), [], "image");
      if (!result.items.length) return Alert.alert("No items found", "The bill could not be read. Try a sharper, straight-on photo, or add the items by hand.");
      const next = result.items.map((it) => {
        const match = products.find((p) => p.name.toLowerCase().trim() === it.description.toLowerCase().trim());
        return {
          productId: match?.id ?? null, description: it.description, hsnCode: it.hsnCode || match?.hsnCode || "",
          quantity: String(it.quantity), unit: it.unit || match?.unit || "Nos", unitPrice: String(it.unitPrice),
          gstRate: String(it.gstRate ?? (match ? Number(match.gstRate) : 18)), discount: "0",
        };
      });
      setLines(next);
      if (result.detected.billNumber) setBillNumber(result.detected.billNumber);
      if (result.detected.billDate) setBillDate(result.detected.billDate);
      // Saving moves stock exactly as on the website: the server matches each line to a product by name, or adds it.
      const known = next.filter((l) => l.productId).length;
      const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
      setImported(`${count(next.length, "item")} read from ${file.name}. Check every line before saving. On save, stock goes up for ${count(known, "existing product")}`
        + (next.length > known ? `, and ${count(next.length - known, "new product")} will be added to your inventory.` : "."));
    } catch (e) {
      Alert.alert("Could not import", e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  const submit = () => {
    if (!vendorId) return Alert.alert("Vendor needed", "Pick the vendor who sent this bill.");
    const bad = lineError(lines);
    if (bad) return Alert.alert("Check the items", bad);
    run(
      () => api<Purchase>("/purchases", {
        method: "POST",
        body: { vendorId: Number(vendorId), billNumber: billNumber.trim() || undefined, billDate, notes: notes.trim() || null, ...(Number(tds.rate) > 0 ? { tdsSection: tds.section.trim().toUpperCase() || undefined, tdsRate: Number(tds.rate) } : {}), items: toItems(lines, false) },
      }),
      (p) => router.replace(`/purchase/${p.id}`),
    );
  };

  return (
    <Form>
      <Stack.Screen options={{ title: "New purchase bill" }} />
      <Card title="Import bill">
        <Text style={{ color: colors.muted, fontSize: 13 }}>Photograph the vendor's bill, or pick its PDF, an image, Excel or CSV file. The items are filled in for you, and saving the bill updates your inventory.</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Button title="Take photo" variant="outline" busy={reading} onPress={() => importBill(takePhoto)} /></View>
          <View style={{ flex: 1 }}><Button title="Choose PDF" variant="outline" busy={reading} onPress={() => importBill(choosePdf)} /></View>
        </View>
        <Button title="Choose image, Excel or CSV" variant="outline" busy={reading} onPress={() => importBill(chooseFile)} />
        {imported && <Text style={{ color: colors.text, fontSize: 13 }}>{imported}</Text>}
      </Card>
      <Card title="Bill">
        <Select label="Vendor *" value={vendorId} onChange={setVendorId} placeholder={vendors.length ? "Select…" : "Add a vendor first"}
          options={vendors.map((v) => ({ value: String(v.id), label: v.gstin ? `${v.name} · ${v.gstin}` : v.name }))} />
        <Field label="Vendor bill number" value={billNumber} onChangeText={setBillNumber} />
        <Field label="Bill date *" value={billDate} onChangeText={setBillDate} placeholder="YYYY-MM-DD" />
        <Field label="TDS section (optional, e.g. 194C)" value={tds.section} onChangeText={(v) => setTds((p) => ({ ...p, section: v }))} autoCapitalize="characters" />
        <Field label="TDS %" value={tds.rate} onChangeText={(v) => setTds((p) => ({ ...p, rate: v }))} keyboardType="decimal-pad" />
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      </Card>
      <LineItems lines={lines} setLines={setLines} price="purchasePrice" withDiscount={false} />
      <Button title="Save purchase bill" busy={busy} onPress={submit} />
    </Form>
  );
}
