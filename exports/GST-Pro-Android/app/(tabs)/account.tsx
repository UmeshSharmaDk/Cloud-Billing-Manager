import Constants from "expo-constants";
import { Pressable, Text, View } from "react-native";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date } from "@/lib/format";
import { Row, s } from "@/lib/ui";

export default function Account() {
  const { user, signOut } = useAuth();
  return (
    <View style={[s.screen, { padding: 16, gap: 16 }]}>
      <View style={s.card}>
        <Text style={[s.title, { marginBottom: 8 }]}>{user?.name}</Text>
        <Row label="Email" value={user?.email ?? ""} />
        <Row label="Plan ends" value={date(user?.subscriptionEnd)} />
        <Row label="Server" value={API_BASE.replace("https://", "")} />
        <Row label="App version" value={Constants.expoConfig?.version ?? ""} />
      </View>
      <Pressable style={s.button} onPress={signOut} accessibilityRole="button">
        <Text style={s.buttonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}
