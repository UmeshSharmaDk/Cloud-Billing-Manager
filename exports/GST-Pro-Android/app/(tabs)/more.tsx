import * as Application from "expo-application";
import Ionicons from "@expo/vector-icons/Ionicons";
import Constants from "expo-constants";
import { router, type Href } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "@/lib/auth";
import { date } from "@/lib/format";
import { Button, colors, LanguageToggle, Row, s, ThemeToggle } from "@/lib/ui";

const LINKS: [string, keyof typeof Ionicons.glyphMap, Href][] = [
  ["Customers", "people-outline", "/customers"],
  ["Vendors", "storefront-outline", "/vendors"],
  ["Payments", "cash-outline", "/payments"],
  ["E-way bills", "car-outline", "/eway-bills"],
  ["GST reports", "bar-chart-outline", "/reports"],
  ["Business settings", "business-outline", "/settings"],
];

export function MenuLink({ title, icon, href }: { title: string; icon: keyof typeof Ionicons.glyphMap; href: Href }) {
  return (
    <Pressable style={[s.listItem, { flexDirection: "row", alignItems: "center", gap: 12 }]} onPress={() => router.push(href)}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text style={{ flex: 1, color: colors.text, fontSize: 16 }}>{title}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** Signed-in user, password change and sign-out: shared by every role's home. */
export function AccountCard() {
  const { user, signOut } = useAuth();
  return (
    <View style={{ gap: 12 }}>
      <View style={s.card}>
        <Text style={[s.title, { marginBottom: 8 }]}>{user?.name}</Text>
        <Row label="Email" value={user?.email ?? ""} />
        <Row label="Role" value={user?.role ?? ""} />
        {!!user?.subscriptionEnd && <Row label="Plan ends" value={date(user.subscriptionEnd)} />}
        <Row label="App version" value={`${Constants.expoConfig?.version ?? ""} (build ${Application.nativeBuildVersion ?? "?"})`} />
      </View>
      <View style={{ borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
        <MenuLink title="Password and sessions" icon="key-outline" href="/password" />
        <MenuLink title="Two-factor sign-in" icon="shield-checkmark-outline" href="/security" />
      </View>
      <LanguageToggle />
      <ThemeToggle />
      <Button title="Sign out" variant="outline" onPress={signOut} />
    </View>
  );
}

export default function More() {
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
        {LINKS.map(([t, i, h]) => <MenuLink key={t} title={t} icon={i} href={h} />)}
      </View>
      <AccountCard />
    </ScrollView>
  );
}
