import { Stack, useLocalSearchParams } from "expo-router";
import { EntityForm, partyFields } from "@/lib/EntityForm";

export default function VendorForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: id ? "Edit vendor" : "New vendor" }} />
      <EntityForm fields={partyFields} load={id ? `/vendors/${id}` : undefined} target={id ? `/vendors/${id}` : "/vendors"} method={id ? "PATCH" : "POST"} />
    </>
  );
}
