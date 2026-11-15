import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, Text } from "react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSave } from "@/lib/save";
import { Button, Card, Field, Form, s } from "@/lib/ui";

export default function Password() {
  const { signOut } = useAuth();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const { busy, run } = useSave();

  const change = () => {
    if (next.length < 12) return Alert.alert("Too short", "Use at least 12 characters.");
    if (next !== again) return Alert.alert("Passwords differ", "The new password and its confirmation do not match.");
    run(() => api("/auth/change-password", { method: "POST", body: { currentPassword: cur, newPassword: next } }), () => {
      setCur(""); setNext(""); setAgain("");
      Alert.alert("Password changed", "Use the new password next time you sign in.");
    });
  };
  const everywhere = () => Alert.alert("Sign out everywhere?", "Every device, including this one, will need to sign in again.", [
    { text: "Cancel", style: "cancel" },
    { text: "Sign out all", style: "destructive", onPress: () => run(() => api("/auth/logout-all", { method: "POST", body: {} }), () => signOut()) },
  ]);

  return (
    <Form>
      <Stack.Screen options={{ title: "Password and sessions" }} />
      <Card title="Change password">
        <Field label="Current password" value={cur} onChangeText={setCur} secureTextEntry autoCapitalize="none" />
        <Field label="New password (12+ characters)" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
        <Field label="Confirm new password" value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" />
        <Button title="Change password" busy={busy} onPress={change} />
      </Card>
      <Card title="Sessions">
        <Text style={s.muted}>Signs out every phone and browser using this account.</Text>
        <Button title="Sign out everywhere" variant="danger" busy={busy} onPress={everywhere} />
      </Card>
    </Form>
  );
}
