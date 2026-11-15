import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { api } from "@/lib/api";
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

  const customer = customers.find((c) => String(c.id) === customerId);
  const place = placeOfSupply || customer?.stateCode || "";

  const submit = () => {
    if (!customer && !walkIn.trim()) return Alert.alert("Customer needed", "Pick a customer or type a walk-in name.");
    const bad = lineError(lines);
    if (bad) return Alert.alert("Check the items", bad);
    run(
      () => api<{ invoice: Invoice }>("/invoices", {
        method: "POST",
        body: {
          type, invoiceDate, dueDate: dueDate || null, placeOfSupply: place || null, notes: notes.trim() || null, ...(Number(tcs) > 0 ? { tcsRate: Number(tcs) } : {}),
          ...(customer ? { customerId: customer.id } : { customerName: walkIn.trim() }),
          items: toItems(lines, true),
        },
      }),
      (r) => router.replace(`/invoice/${r.invoice.id}`),
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
