import { Stack } from "expo-router";
import { Alert } from "react-native";
import { businessFields, EntityForm } from "@/lib/EntityForm";


export default function Settings() {
  return (
    <>
      <Stack.Screen options={{ title: "Business settings" }} />
      <EntityForm fields={businessFields} load="/business" target="/business" method="PATCH" submitLabel="Save settings"
        onSaved={() => Alert.alert("Saved", "Business details updated.")} />
    </>
  );
}
