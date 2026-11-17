import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppUpdates } from "@/lib/AppUpdates";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PlanExpiryNotifications } from "@/lib/PlanExpiry";
import { SwipeNav } from "@/lib/SwipeNav";
import { colors, isDark } from "@/lib/ui";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/**
 * Every screen but the login needs a session. Only the tabs checked for one,
 * so signing out (or a session ending) on the admin, superadmin or any detail
 * screen left it showing, and the next refresh failed with an error.
 */
function SessionGuard() {
  const { user, ready } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const onLogin = segments[0] === "login";
  useEffect(() => {
    if (!ready || user || onLogin) return;
    if (router.canDismiss()) router.dismissAll();
    router.replace("/login");
  }, [ready, user, onLogin, router]);
  return null;
}

export default function RootLayout() {
  // Edge-to-edge Android draws under the navigation bar; keep stack screens above it.
  // Tabs pad their own tab bar, and login uses SafeAreaView.
  const { bottom } = useSafeAreaInsets();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style={isDark ? "light" : "dark"} />
        <SwipeNav>
          <Stack screenOptions={{ headerTintColor: colors.primary, headerStyle: { backgroundColor: colors.card }, headerTitleStyle: { color: colors.text }, contentStyle: { backgroundColor: colors.bg, paddingBottom: bottom } }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
            <Stack.Screen name="invoice/[id]" options={{ title: "Invoice" }} />
            <Stack.Screen name="customer/[id]" options={{ title: "Customer" }} />
          </Stack>
        </SwipeNav>
        <SessionGuard />
        <AppUpdates />
        <PlanExpiryNotifications />
      </AuthProvider>
    </QueryClientProvider>
  );
}
