import { router, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "react-native";
import { api, ApiError } from "@/lib/api";
import { businessFields, FormFields, toBody } from "@/lib/EntityForm";
import { useSave } from "@/lib/save";
import { ACCESS, type User } from "@/lib/types";
import { Button, Card, Field, Form, Select } from "@/lib/ui";

export default function NewUser() {
  const [v, setV] = useState({ name: "", email: "", password: "", businessName: "", gstin: "", joinUserId: "", accessLevel: "entry" });
  const owners = useQuery({ queryKey: ["/users", "owners"], queryFn: () => api<{ users: (User & { accessLevel?: string | null; businessId?: number | null })[] }>("/users?limit=100") });
  const hosts = (owners.data?.users ?? []).filter((u) => !u.accessLevel && u.businessId).map((u) => ({ value: String(u.id), label: `Staff of ${u.name}'s business` }));
  const set = (k: keyof typeof v) => (x: string) => setV((p) => ({ ...p, [k]: x }));
  const [biz, setBiz] = useState<Record<string, string>>({});
  // Only what the admin filled in: the server defaults the name and the invoice prefix.
  const business = () => Object.fromEntries(Object.entries(toBody(businessFields, biz)).filter(([, x]) => x !== null));
  const { busy, run } = useSave();

  const submit = () => {
    if (!v.name.trim() || !v.email.trim()) return Alert.alert("Missing details", "Name and email are required.");
    if (v.password.length < 12) return Alert.alert("Password too short", "Use at least 12 characters.");
    run(
      () => api("/users", { method: "POST", body: { name: v.name.trim(), email: v.email.trim(), password: v.password, role: "user", ...(v.joinUserId ? { joinUserId: Number(v.joinUserId), accessLevel: v.accessLevel } : { business: business() }) } }),
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
        <Select label="Business" value={v.joinUserId} options={[{ value: "", label: "A new client with their own business" }, ...hosts]} onChange={set("joinUserId")} />
        {v.joinUserId ? <Select label="Access" value={v.accessLevel} options={ACCESS} onChange={set("accessLevel")} /> : null}
      </Card>
      {!v.joinUserId && (
        <Card title="Business details (shown on their invoices)">
          <FormFields fields={businessFields.map((f) => (f.key === "name" ? { ...f, required: false, label: "Business name (defaults to their name)" } : f))}
            value={biz} set={(k, x) => setBiz((p) => ({ ...p, [k]: x }))} />
        </Card>
      )}
      <Button title="Create user" busy={busy} onPress={submit} />
    </Form>
  );
}
