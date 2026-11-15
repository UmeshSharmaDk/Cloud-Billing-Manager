import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Loading } from "@/lib/ui";

export default function Index() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  return <Redirect href={user ? "/(tabs)" : "/login"} />;
}
