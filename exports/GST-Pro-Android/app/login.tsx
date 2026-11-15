import { Redirect } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { colors, s } from "@/lib/ui";

export default function Login() {
  const { user, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Redirect href="/(tabs)" />;

  const submit = async () => {
    if (!email.trim() || !password) return setError("Enter your email and password.");
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: 24, gap: 14 }}>
        <Text style={{ fontSize: 32, fontWeight: "800", color: colors.primary }}>GST Pro</Text>
        <Text style={s.muted}>Sign in to your business account</Text>
        <TextInput style={s.input} placeholder="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address"
          value={email} onChangeText={setEmail} placeholderTextColor={colors.muted} />
        <TextInput style={s.input} placeholder="Password" secureTextEntry autoComplete="password"
          value={password} onChangeText={setPassword} onSubmitEditing={submit} placeholderTextColor={colors.muted} />
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        <Pressable style={[s.button, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} accessibilityRole="button">
          <Text style={s.buttonText}>{busy ? "Signing in…" : "Sign in"}</Text>
        </Pressable>
        <View style={{ height: 8 }} />
        <Text style={[s.muted, { textAlign: "center" }]}>New accounts and password resets are on the website.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
