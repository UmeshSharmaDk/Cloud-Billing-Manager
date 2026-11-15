import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert, Image, Linking, Share, Text } from "react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSave } from "@/lib/save";
import { Button, Card, Field, Form, s } from "@/lib/ui";

type Setup = { secret: string; otpauthUri: string; qrCodeDataUrl: string };

/** Two-factor sign-in for administrators: turn it on, or replace the recovery codes. */
export default function Security() {
  const { user, adopt, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const { busy, run } = useSave();

  const start = () => run(() => api<Setup>("/auth/mfa/setup", { method: "POST", body: { confirmPassword: password } }), (r) => { setSetup(r); setPassword(""); });
  const enable = () => run(() => api<{ recoveryCodes: string[]; token: string }>("/auth/mfa/enable", { method: "POST", body: { code: code.trim() } }),
    (r) => { setCodes(r.recoveryCodes); setNewToken(r.token); setCode(""); });
  const regenerate = () => run(() => api<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { method: "POST", body: { code: code.trim() } }),
    (r) => { setCodes(r.recoveryCodes); setCode(""); });
  const done = async () => {
    if (newToken) await adopt(newToken);
    router.replace("/");
  };

  if (codes) {
    return (
      <Form>
        <Stack.Screen options={{ title: "Recovery codes" }} />
        <Card title="Save these recovery codes">
          <Text style={s.muted}>Each code signs you in once if you lose your phone. They are shown only now.</Text>
          <Text selectable style={{ fontFamily: "monospace", fontSize: 16, lineHeight: 26 }}>{codes.join("\n")}</Text>
          <Button title="Share or save" variant="outline" onPress={() => Share.share({ message: `GST Pro recovery codes:\n${codes.join("\n")}` })} />
          <Button title="I saved them, continue" onPress={() => { Alert.alert("Continue?", "You will not see these codes again.", [{ text: "Back", style: "cancel" }, { text: "Continue", onPress: done }]); }} />
        </Card>
      </Form>
    );
  }

  if (user?.mfaEnabled) {
    return (
      <Form>
        <Stack.Screen options={{ title: "Two-factor sign-in" }} />
        <Card title="Two-factor sign-in is on">
          <Text style={s.muted}>To replace your recovery codes, enter a current code from your authenticator app.</Text>
          <Field label="Authenticator code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
          <Button title="Get new recovery codes" busy={busy} disabled={code.trim().length < 6} onPress={regenerate} />
        </Card>
      </Form>
    );
  }

  return (
    <Form>
      <Stack.Screen options={{ title: "Turn on two-factor sign-in", headerBackVisible: false }} />
      {!setup ? (
        <Card title="Protect your admin account">
          <Text style={s.muted}>Administrator accounts need an authenticator app, such as Google Authenticator or Microsoft Authenticator, before they can be used.</Text>
          <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          <Button title="Start" busy={busy} disabled={!password} onPress={start} />
          <Button title="Sign out" variant="outline" onPress={signOut} />
        </Card>
      ) : (
        <Card title="Add GST Pro to your authenticator">
          <Button title="Open authenticator app" onPress={() => Linking.openURL(setup.otpauthUri).catch(() => Alert.alert("No authenticator app found", "Install one, or type the key below into it."))} />
          <Text style={s.muted}>Or scan this code from another device, or type the key by hand:</Text>
          <Image source={{ uri: setup.qrCodeDataUrl }} style={{ width: 200, height: 200, alignSelf: "center" }} />
          <Text selectable style={{ fontFamily: "monospace", textAlign: "center", fontSize: 16 }}>{setup.secret}</Text>
          <Field label="6-digit code from the app" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
          <Button title="Turn on" busy={busy} disabled={code.trim().length < 6} onPress={enable} />
        </Card>
      )}
    </Form>
  );
}
