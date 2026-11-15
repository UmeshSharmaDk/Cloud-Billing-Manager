import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Loading } from "@/lib/ui";

export default function Index() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  // Same split as the website: business users, administrators and the superadmin each get their own area.
  // Administrators must turn on two-factor sign-in before the server lets them in (same as the website).
  if (user.role !== "user" && !user.mfaEnabled) return <Redirect href="/security" />;
  if (user.role === "superadmin") return <Redirect href="/superadmin" />;
  if (user.role === "admin") return <Redirect href="/admin" />;
  return <Redirect href="/(tabs)" />;
}
