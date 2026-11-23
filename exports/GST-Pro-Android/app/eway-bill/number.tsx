import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { api } from "@/lib/api";
import { today, useSave } from "@/lib/save";
import { Button, Card, Field, Form, s } from "@/lib/ui";

/** The 12-digit number the e-way bill portal issued. We never make one up. */
export default function EwayNumber() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [v, setV] = useState({ ewbNo: "", ewbDate: today(), validUpto: "" });
  const set = (k: keyof typeof v) => (t: string) => setV((p) => ({ ...p, [k]: k === "ewbNo" ? t.replace(/\D/g, "") : t }));
  const { busy, run } = useSave();
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const why = v.ewbNo.length !== 12 ? "The e-way bill number is 12 digits." : !date.test(v.ewbDate) || !date.test(v.validUpto) ? "Enter both dates as YYYY-MM-DD." : undefined;
  return (
    <Form>
      <Stack.Screen options={{ title: "E-way bill number" }} />
      <Card>
        <Text style={s.muted}>Copy it from ewaybillgst.gov.in after uploading the file or filling the form there.</Text>
        <Field label="E-way bill number (12 digits)" value={v.ewbNo} onChangeText={set("ewbNo")} keyboardType="number-pad" maxLength={12} />
        <Field label="Generated on (YYYY-MM-DD)" value={v.ewbDate} onChangeText={set("ewbDate")} />
        <Field label="Valid up to (YYYY-MM-DD)" value={v.validUpto} onChangeText={set("validUpto")} />
        <Button title="Save number" busy={busy} disabledReason={why}
          onPress={() => run(() => api(`/eway-bills/${encodeURIComponent(id)}`, { method: "PATCH", body: { status: "generated", ...v } }), () => router.back())} />
      </Card>
    </Form>
  );
}
