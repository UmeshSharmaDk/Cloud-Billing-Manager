import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { api } from "@/lib/api";
import { emptyLine, LineItems, lineError, toItems, type Line } from "@/lib/LineItems";
import { today, useSave } from "@/lib/save";
import type { Purchase, Vendor } from "@/lib/types";
import { Button, Card, Field, Form, Select } from "@/lib/ui";

export default function NewPurchase() {
  const vendors = useQuery({ queryKey: ["/vendors", "picker"], queryFn: () => api<{ vendors: Vendor[] }>("/vendors?limit=100") }).data?.vendors ?? [];
  const [vendorId, setVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const { busy, run } = useSave();

  const submit = () => {
    if (!vendorId) return Alert.alert("Vendor needed", "Pick the vendor who sent this bill.");
    const bad = lineError(lines);
    if (bad) return Alert.alert("Check the items", bad);
    run(
      () => api<Purchase>("/purchases", {
        method: "POST",
        body: { vendorId: Number(vendorId), billNumber: billNumber.trim() || undefined, billDate, notes: notes.trim() || null, items: toItems(lines, false) },
      }),
      (p) => router.replace(`/purchase/${p.id}`),
    );
  };

  return (
    <Form>
      <Stack.Screen options={{ title: "New purchase bill" }} />
      <Card title="Bill">
        <Select label="Vendor *" value={vendorId} onChange={setVendorId} placeholder={vendors.length ? "Select…" : "Add a vendor first"}
          options={vendors.map((v) => ({ value: String(v.id), label: v.gstin ? `${v.name} · ${v.gstin}` : v.name }))} />
        <Field label="Vendor bill number" value={billNumber} onChangeText={setBillNumber} />
        <Field label="Bill date *" value={billDate} onChangeText={setBillDate} placeholder="YYYY-MM-DD" />
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      </Card>
      <LineItems lines={lines} setLines={setLines} price="purchasePrice" withDiscount={false} />
      <Button title="Save purchase bill" busy={busy} onPress={submit} />
    </Form>
  );
}
