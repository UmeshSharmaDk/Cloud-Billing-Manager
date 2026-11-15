import { Stack, router } from "expo-router";
import { useState } from "react";
import { Alert, Text } from "react-native";
import { api } from "@/lib/api";
import { useSave } from "@/lib/save";
import { Button, Card, Field, Form, s } from "@/lib/ui";

export default function Register() {
  const [v, setV] = useState({ name: "", email: "", businessName: "", gstin: "" });
  const [sent, setSent] = useState<string | null>(null);
  const { busy, run } = useSave();
  const set = (k: keyof typeof v) => (x: string) => setV((p) => ({ ...p, [k]: k === "gstin" ? x.toUpperCase() : x }));

  const submit = () => {
    if (!v.name.trim() || !v.email.trim() || !v.businessName.trim()) return Alert.alert("Missing details", "Name, email and business name are required.");
    run(() => api<{ message: string }>("/auth/register", {
      method: "POST",
      body: { name: v.name.trim(), email: v.email.trim(), businessName: v.businessName.trim(), gstin: v.gstin.trim() || null },
    }), (r) => setSent(r.message));
  };

  return (
    <Form>
      <Stack.Screen options={{ title: "Create account", headerShown: true }} />
      {sent ? (
        <Card title="Check your email">
          <Text style={s.muted}>{sent}</Text>
          <Text style={s.muted}>Open the link to choose your password, then sign in here.</Text>
          <Button title="Back to sign in" onPress={() => router.back()} />
        </Card>
      ) : (
        <Card title="Start your free trial">
          <Field label="Your name *" value={v.name} onChangeText={set("name")} autoComplete="name" />
          <Field label="Email *" value={v.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          <Field label="Business name *" value={v.businessName} onChangeText={set("businessName")} />
          <Field label="GSTIN" value={v.gstin} onChangeText={set("gstin")} autoCapitalize="characters" maxLength={15} />
          <Button title="Create account" busy={busy} onPress={submit} />
        </Card>
      )}
    </Form>
  );
}
