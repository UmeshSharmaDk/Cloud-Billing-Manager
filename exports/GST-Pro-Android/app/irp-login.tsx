import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, Text } from "react-native";
import { api } from "@/lib/api";
import { useSave } from "@/lib/save";
import { Button, Card, ErrorView, Field, Form, Loading, Row, s } from "@/lib/ui";

type IrpLogin = { configured: boolean; sandbox?: boolean; baseUrl?: string; gstin?: string; clientId?: string; username?: string };
const EMPTY = { baseUrl: "", clientId: "", clientSecret: "", username: "", password: "", publicKey: "" };

/** The e-invoice (IRP) API login, so IRNs and e-way bills are made from the app. Secrets are never sent back. */
export default function IrpLoginScreen() {
  const q = useQuery({ queryKey: ["/business/irp"], queryFn: () => api<IrpLogin>("/business/irp") });
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(EMPTY);
  const set = (k: keyof typeof v) => (t: string) => setV((p) => ({ ...p, [k]: t }));
  const { busy, run } = useSave();
  if (q.isLoading) return <Loading layout="form" />;
  if (q.error) return <ErrorView error={q.error} onRetry={q.refetch} />;
  const login = q.data!;

  const why = !v.clientId.trim() || !v.clientSecret.trim() ? "Fill in the client ID and secret."
    : !v.username.trim() || !v.password ? "Fill in the API username and password."
    : v.publicKey.trim().length < 100 ? "Paste the whole public key." : undefined;
  const save = () => run(
    () => api("/business/irp", { method: "PUT", body: { ...v, baseUrl: v.baseUrl.trim() || undefined } }),
    () => { setEditing(false); setV(EMPTY); Alert.alert("Login saved", "The e-invoice system accepted it."); },
  );
  const remove = () => Alert.alert("Remove the e-invoice login?", "IRNs can still be added by hand.", [
    { text: "Keep", style: "cancel" },
    { text: "Remove login", style: "destructive", onPress: () => run(() => api("/business/irp", { method: "DELETE" })) },
  ]);

  return (
    <Form>
      <Stack.Screen options={{ title: "E-invoice API login" }} />
      {login.configured && !editing ? (
        <Card title={login.sandbox ? "Connected to the NIC sandbox" : "Connected"}>
          <Text style={s.muted}>{login.sandbox ? "Test IRNs only. They are not valid for real invoices." : "IRNs made here are real."}</Text>
          <Row label="GSTIN" value={login.gstin ?? ""} />
          <Row label="API user" value={login.username ?? ""} />
          <Button title="Change login" variant="outline" onPress={() => setEditing(true)} />
          <Button title="Remove login" variant="danger" busy={busy} onPress={remove} />
        </Card>
      ) : (
        <Card>
          <Text style={s.muted}>Get these from the e-invoice portal (API registration). Leave the address empty to use NIC's free sandbox.</Text>
          <Field label="API address (optional)" value={v.baseUrl} onChangeText={set("baseUrl")} autoCapitalize="none" autoCorrect={false} placeholder="https://einv-apisandbox.nic.in" />
          <Field label="Client ID" value={v.clientId} onChangeText={set("clientId")} autoCapitalize="none" autoCorrect={false} />
          <Field label="Client secret" value={v.clientSecret} onChangeText={set("clientSecret")} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Field label="API username" value={v.username} onChangeText={set("username")} autoCapitalize="none" autoCorrect={false} />
          <Field label="API password" value={v.password} onChangeText={set("password")} secureTextEntry />
          <Field label="Public key" value={v.publicKey} onChangeText={set("publicKey")} multiline autoCapitalize="none" autoCorrect={false} />
          <Button title="Save and test login" busy={busy} disabledReason={why} onPress={save} />
          {editing && <Button title="Cancel" variant="outline" onPress={() => { setEditing(false); setV(EMPTY); }} />}
        </Card>
      )}
    </Form>
  );
}
