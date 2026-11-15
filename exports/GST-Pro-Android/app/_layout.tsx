import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/lib/auth";
import { colors } from "@/lib/ui";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerTintColor: colors.primary, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="invoice/[id]" options={{ title: "Invoice" }} />
          <Stack.Screen name="customer/[id]" options={{ title: "Customer" }} />
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}
