import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppUpdates } from "@/lib/AppUpdates";
import { AuthProvider } from "@/lib/auth";
import { colors } from "@/lib/ui";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  // Edge-to-edge Android draws under the navigation bar; keep stack screens above it.
  // Tabs pad their own tab bar, and login uses SafeAreaView.
  const { bottom } = useSafeAreaInsets();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerTintColor: colors.primary, contentStyle: { backgroundColor: colors.bg, paddingBottom: bottom } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
          <Stack.Screen name="invoice/[id]" options={{ title: "Invoice" }} />
          <Stack.Screen name="customer/[id]" options={{ title: "Customer" }} />
        </Stack>
        <AppUpdates />
      </AuthProvider>
    </QueryClientProvider>
  );
}
