import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import { Pressable, Text } from "react-native";
import { useAuth } from "@/lib/auth";
import { colors, s } from "@/lib/ui";
import { SafeAreaView } from "react-native-safe-area-context";

const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: string; size: number }) =>
  <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  const { user, signOut } = useAuth();
  if (!user) return <Redirect href="/login" />;

  // Business data belongs to "user" accounts; admin and superadmin tools stay on the website for now.
  if (user.role !== "user") {
    return (
      <SafeAreaView style={[s.center, { gap: 16 }]}>
        <Text style={s.title}>Signed in as {user.role}</Text>
        <Text style={[s.muted, { textAlign: "center" }]}>The app covers business accounts. Use the website for admin tools.</Text>
        <Pressable style={s.button} onPress={signOut}><Text style={s.buttonText}>Sign out</Text></Pressable>
      </SafeAreaView>
    );
  }

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerTintColor: colors.text }}>
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: icon("grid-outline") }} />
      <Tabs.Screen name="invoices" options={{ title: "Invoices", tabBarIcon: icon("document-text-outline") }} />
      <Tabs.Screen name="customers" options={{ title: "Customers", tabBarIcon: icon("people-outline") }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: icon("person-circle-outline") }} />
    </Tabs>
  );
}
