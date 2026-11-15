import { router, Stack, useLocalSearchParams } from "expo-router";
import { Alert } from "react-native";
import { businessFields, EntityForm } from "@/lib/EntityForm";

/** An admin edits one of their users' business settings. */
export default function UserBusiness() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: name ? `${name}: business` : "Business details" }} />
      <EntityForm fields={businessFields} load={`/admin/users/${encodeURIComponent(id)}`} pick="business"
        target={`/admin/users/${encodeURIComponent(id)}/business`} method="PATCH" submitLabel="Save business details"
        onSaved={() => { Alert.alert("Saved", "Business details updated."); router.back(); }} />
    </>
  );
}
