import Ionicons from "@expo/vector-icons/Ionicons";
import { Redirect, Tabs } from "expo-router";
import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/ui";

const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: string; size: number }) =>
  <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "user") return <Redirect href="/" />;

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border }, headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: icon("grid-outline") }} />
      <Tabs.Screen name="invoices" options={{ title: "Invoices", tabBarIcon: icon("document-text-outline") }} />
      <Tabs.Screen name="purchases" options={{ title: "Purchases", tabBarIcon: icon("cart-outline") }} />
      <Tabs.Screen name="products" options={{ title: "Inventory", tabBarIcon: icon("cube-outline") }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: icon("menu-outline") }} />
    </Tabs>
  );
}
