import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { api } from "@/lib/api";
import { useSave } from "@/lib/save";
import { Button, Card, Field, Form, s } from "@/lib/ui";

/** Save what the IRP returned after the e-invoice upload. It then prints on the invoice. */
export default function SaveIrn() {
  const { id, number } = useLocalSearchParams<{ id: string; number?: string }>();
  const [v, setV] = useState({ irn: "", ackNo: "", ackDate: "", signedQr: "" });
  const set = (k: keyof typeof v) => (t: string) => setV((p) => ({ ...p, [k]: t }));
  const { busy, run } = useSave();
  const why = v.irn.trim().length !== 64 ? "The IRN is 64 characters." : !v.ackNo.trim() || !v.ackDate.trim() ? "Fill in the Ack number and date." : undefined;
  return (
    <Form>
      <Stack.Screen options={{ title: `IRN for ${number ?? "invoice"}` }} />
      <Card>
        <Text style={s.muted}>Copy these from the IRP after your upload. Once saved, the invoice's figures are locked.</Text>
        <Field label="IRN (64 characters)" value={v.irn} onChangeText={set("irn")} autoCapitalize="none" autoCorrect={false} />
        <Field label="Ack number" value={v.ackNo} onChangeText={set("ackNo")} keyboardType="number-pad" />
        <Field label="Ack date" value={v.ackDate} onChangeText={set("ackDate")} placeholder="2026-11-22 14:05" />
        <Field label="Signed QR code text (optional)" value={v.signedQr} onChangeText={set("signedQr")} multiline autoCapitalize="none" autoCorrect={false} />
        <Button title="Save IRN" busy={busy} disabledReason={why}
          onPress={() => run(() => api(`/invoices/${encodeURIComponent(id)}/irn`, { method: "PUT", body: { ...v, signedQr: v.signedQr.trim() || null } }), () => router.back())} />
      </Card>
    </Form>
  );
}
