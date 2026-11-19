import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { Alert, View } from "react-native";
import { api } from "@/lib/api";
import { businessFields, EntityForm } from "@/lib/EntityForm";
import { useSave } from "@/lib/save";
import type { Business } from "@/lib/types";
import { Card, ToggleRow } from "@/lib/ui";

/** Saves on its own, like the website's switch, so it doesn't wait for the long form below. */
function AutoReminders() {
  const biz = useQuery({ queryKey: ["/business"], queryFn: () => api<Business>("/business") });
  const { busy, run } = useSave();
  if (!biz.data) return null;
  return (
    <View style={{ padding: 16, paddingBottom: 0 }}>
      <Card>
        <ToggleRow label="Email payment reminders automatically"
          note="Once a week while an invoice is overdue, to customers with an email address."
          value={!!biz.data.autoReminders} busy={busy}
          onChange={(autoReminders) => run(() => api("/business", { method: "PATCH", body: { autoReminders } }))} />
      </Card>
    </View>
  );
}

export default function Settings() {
  return (
    <>
      <Stack.Screen options={{ title: "Business settings" }} />
      <AutoReminders />
      <EntityForm fields={businessFields} load="/business" target="/business" method="PATCH" submitLabel="Save settings"
        onSaved={() => Alert.alert("Saved", "Business details updated.")} />
    </>
  );
}
