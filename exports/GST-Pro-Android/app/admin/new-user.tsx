import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { api, ApiError } from "@/lib/api";
import { useSave } from "@/lib/save";
import { Button, Card, Field, Form } from "@/lib/ui";

export default function NewUser() {
  const [v, setV] = useState({ name: "", email: "", password: "", businessName: "", gstin: "" });
  const set = (k: keyof typeof v) => (x: string) => setV((p) => ({ ...p, [k]: x }));
  const { busy, run } = useSave();

  const submit = () => {
    if (!v.name.trim() || !v.email.trim()) return Alert.alert("Missing details", "Name and email are required.");
    if (v.password.length < 12) return Alert.alert("Password too short", "Use at least 12 characters.");
    run(
      () => api("/users", { method: "POST", body: { name: v.name.trim(), email: v.email.trim(), password: v.password, role: "user", businessName: v.businessName.trim() || undefined, gstin: v.gstin.trim().toUpperCase() || undefined } }),
      () => { Alert.alert("User created", "They can sign in with this email and password."); router.back(); },
      (e) => {
        if (!(e instanceof ApiError) || e.code !== "user_limit_reached") return false;
        Alert.alert("User limit reached", e.message, [
          { text: "Not now", style: "cancel" },
          { text: "Request more users", onPress: () => router.replace({ pathname: "/admin", params: { request: "1" } }) },
        ]);
        return true;
      },
    );
  };

  return (
    <Form>
      <Stack.Screen options={{ title: "Add a user" }} />
      <Card title="New business user">
        <Field label="Name *" value={v.name} onChangeText={set("name")} />
        <Field label="Email *" value={v.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Password (12+ characters) *" value={v.password} onChangeText={set("password")} secureTextEntry autoCapitalize="none" />
        <Field label="Business name (defaults to their name)" value={v.businessName} onChangeText={set("businessName")} />
        <Field label="GSTIN" value={v.gstin} onChangeText={set("gstin")} autoCapitalize="characters" maxLength={15} />
        <Button title="Create user" busy={busy} onPress={submit} />
      </Card>
    </Form>
  );
}
