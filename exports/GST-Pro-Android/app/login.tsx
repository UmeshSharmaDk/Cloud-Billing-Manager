import { Redirect } from "expo-router";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { colors, s } from "@/lib/ui";

export default function Login() {
  const { user, signIn, finishMfa } = useAuth();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Redirect href="/" />;

  const submit = async () => {
    if (mfaToken ? !code.trim() : !email.trim() || !password) return setError(mfaToken ? "Enter the code." : "Enter your email and password.");
    setBusy(true);
    setError(null);
    try {
      if (mfaToken) await finishMfa(mfaToken, code.trim());
      else setMfaToken(await signIn(email.trim(), password));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: 24, gap: 14 }}>
        {/* The logo's dark lettering needs a white plate to stay readable in dark mode. */}
        <View style={{ backgroundColor: "#ffffff", borderRadius: 16, padding: 12 }}>
          <Image source={require("../assets/images/logo.png")} accessibilityLabel="Billing Pilot" resizeMode="contain"
            style={{ width: "100%", height: undefined, aspectRatio: 900 / 303 }} />
        </View>
        <Text style={s.muted}>Sign in to your business account</Text>
        {mfaToken ? (
          <>
            <Text style={s.muted}>Enter the 6-digit code from your authenticator app, or one of your recovery codes.</Text>
            <TextInput style={s.input} placeholder="123456" autoFocus autoCapitalize="none" autoComplete="one-time-code" maxLength={32}
              value={code} onChangeText={setCode} onSubmitEditing={submit} placeholderTextColor={colors.muted} />
          </>
        ) : (
          <>
            <TextInput style={s.input} placeholder="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address"
              value={email} onChangeText={setEmail} placeholderTextColor={colors.muted} />
            <TextInput style={s.input} placeholder="Password" secureTextEntry autoComplete="password"
              value={password} onChangeText={setPassword} onSubmitEditing={submit} placeholderTextColor={colors.muted} />
          </>
        )}
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        <Pressable style={[s.button, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} accessibilityRole="button">
          <Text style={s.buttonText}>{busy ? "Signing in…" : "Sign in"}</Text>
        </Pressable>
        <View style={{ height: 8 }} />
        <Text style={[s.muted, { textAlign: "center" }]}>Accounts are created by your administrator.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
