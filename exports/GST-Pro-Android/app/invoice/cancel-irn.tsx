import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { api } from "@/lib/api";
import { useSave } from "@/lib/save";
import { Button, Card, Field, Form, s, Select } from "@/lib/ui";

const REASONS = [
  { value: "1", label: "Duplicate" },
  { value: "2", label: "Data entry mistake" },
  { value: "3", label: "Order cancelled" },
  { value: "4", label: "Other" },
];

/** Cancels the IRN on the IRP itself. The invoice can then be edited again. */
export default function CancelIrn() {
  const { id, number } = useLocalSearchParams<{ id: string; number?: string }>();
  const [reason, setReason] = useState("2");
  const [remark, setRemark] = useState("");
  const { busy, run } = useSave();
  return (
    <Form>
      <Stack.Screen options={{ title: `Cancel IRN for ${number ?? "invoice"}` }} />
      <Card>
        <Text style={s.muted}>The IRP allows this within 24 hours of the IRN. Its e-way bill, if any, must be cancelled first.</Text>
        <Select label="Reason" value={reason} options={REASONS} onChange={setReason} />
        <Field label="Remark" value={remark} onChangeText={setRemark} maxLength={100} />
        <Button title="Cancel IRN" variant="danger" busy={busy} disabledReason={remark.trim() ? undefined : "Write a short remark first."}
          onPress={() => run(() => api(`/invoices/${encodeURIComponent(id)}/irn/cancel`, { method: "POST", body: { reason, remark: remark.trim() } }), () => router.back())} />
        <Button title="Keep IRN" variant="outline" onPress={() => router.back()} />
      </Card>
    </Form>
  );
}
