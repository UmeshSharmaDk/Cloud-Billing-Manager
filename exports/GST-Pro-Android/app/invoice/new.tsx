import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { api, isNetworkError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { enqueue, newRef } from "@/lib/offline";
import { emptyLine, LineItems, lineError, toItems, type Line } from "@/lib/LineItems";
import { today, useSave } from "@/lib/save";
import { stateOptions } from "@/lib/states";
import type { Customer, Invoice } from "@/lib/types";
import { Button, Card, Field, Form, Select } from "@/lib/ui";

const TYPES = ["Tax Invoice", "Bill of Supply", "Proforma Invoice", "Credit Note", "Debit Note"].map((t) => ({ value: t, label: t }));
const WALK_IN = "walk-in";

export default function NewInvoice() {
  // ponytail: the picker lists the first 100 customers; a walk-in name covers anyone else.
  const customers = useQuery({ queryKey: ["/customers", "picker"], queryFn: () => api<{ customers: Customer[] }>("/customers?limit=100") }).data?.customers ?? [];
  const [customerId, setCustomerId] = useState(WALK_IN);
  const [walkIn, setWalkIn] = useState("");
  const [type, setType] = useState("Tax Invoice");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [placeOfSupply, setPlace] = useState("");
  const [notes, setNotes] = useState("");
  const [tcs, setTcs] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const { busy, run } = useSave();
  const { user } = useAuth();
  // One id per screen: pressing Create twice, or a resend after a lost reply, makes one invoice.
  const [clientRef] = useState(newRef);

  // "Duplicate invoice" opens this screen with ?from=<id>, and the dashboard's
  // monthly repeat adds &repeat=1: same customer and lines, today's date, a new number.
  const { from, repeat } = useLocalSearchParams<{ from?: string; repeat?: string }>();
  const source = useQuery({ queryKey: [`/invoices/${from}`], queryFn: () => api<Invoice>(`/invoices/${encodeURIComponent(from!)}`), enabled: !!from }).data;
  useEffect(() => {
    if (!source) return;
    if (source.customerId) setCustomerId(String(source.customerId));
    setWalkIn(source.customerName ?? ""); // used if the customer is past the picker's first 100
    setType(source.type || "Tax Invoice");
    setPlace(source.placeOfSupply ?? "");
    setNotes(source.notes ?? "");
    setLines((source.items ?? []).map((it) => ({
      productId: it.productId ?? null, description: it.description ?? "", hsnCode: it.hsnCode ?? "",
      quantity: String(it.quantity ?? 1), unit: it.unit ?? "Nos", unitPrice: String(it.unitPrice ?? ""),
      gstRate: String(it.gstRate ?? 18), discount: String(it.discount ?? 0),
    })));
  }, [source]);

  const customer = customers.find((c) => String(c.id) === customerId);
  const place = placeOfSupply || customer?.stateCode || "";

  const submit = () => {
    if (!customer && !walkIn.trim()) return Alert.alert("Customer needed", "Pick a customer or type a walk-in name.");
    const bad = lineError(lines);
    if (bad) return Alert.alert("Check the items", bad);
    const body = {
      type, invoiceDate, dueDate: dueDate || null, placeOfSupply: place || null, notes: notes.trim() || null, ...(Number(tcs) > 0 ? { tcsRate: Number(tcs) } : {}),
      ...(customer ? { customerId: customer.id } : { customerName: walkIn.trim() }),
      items: toItems(lines, true),
      ...(repeat === "1" && from ? { repeatOf: Number(from) } : {}),
      clientRef,
    };
    run(
      () => api<{ invoice: Invoice }>("/invoices", { method: "POST", body }),
      (r) => router.replace(`/invoice/${r.invoice.id}`),
      (e) => {
        if (!isNetworkError(e) || !user) return false;
        // No signal: keep it on the phone and send it when the connection is back.
        void enqueue({ ref: clientRef, userId: user.id, path: "/invoices", body, label: `${type} for ${customer?.name ?? walkIn.trim()}, ${invoiceDate}` }).then(() => {
          Alert.alert("Saved on this phone", "You are offline. The invoice will be sent, and get its number, when you are back online.");
          router.back();
        });
        return true;
      },
    );
  };

  return (
    <Form>
      <Stack.Screen options={{ title: "New invoice" }} />
      <Card title="Bill to">
        <Select label="Customer" value={customerId} onChange={setCustomerId}
          options={[{ value: WALK_IN, label: "Walk-in customer" }, ...customers.map((c) => ({ value: String(c.id), label: c.gstin ? `${c.name} · ${c.gstin}` : c.name }))]} />
        {!customer && <Field label="Walk-in customer name *" value={walkIn} onChangeText={setWalkIn} />}
        <Select label="Place of supply" value={place} options={stateOptions} onChange={setPlace} placeholder="Your own state" />
      </Card>
      <Card title="Invoice">
        <Select label="Type" value={type} options={TYPES} onChange={setType} />
        <Field label="Invoice date *" value={invoiceDate} onChangeText={setInvoiceDate} placeholder="YYYY-MM-DD" />
        <Field label="Due date" value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" />
        <Field label="TCS % (s.206C, optional)" value={tcs} onChangeText={setTcs} keyboardType="decimal-pad" />
        <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
      </Card>
      <LineItems lines={lines} setLines={setLines} price="sellingPrice" withDiscount />
      <Button title="Create invoice" busy={busy} onPress={submit} />
    </Form>
  );
}
