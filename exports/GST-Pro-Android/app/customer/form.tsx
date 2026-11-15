import { Stack, useLocalSearchParams } from "expo-router";
import { EntityForm, partyFields } from "@/lib/EntityForm";

const fields = [...partyFields, { key: "creditLimit", label: "Credit limit (₹)", kind: "number" as const }];

export default function CustomerForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: id ? "Edit customer" : "New customer" }} />
      <EntityForm fields={fields} load={id ? `/customers/${id}` : undefined} target={id ? `/customers/${id}` : "/customers"} method={id ? "PATCH" : "POST"} />
    </>
  );
}
