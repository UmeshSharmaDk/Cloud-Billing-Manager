import { Stack } from "expo-router";
import { Alert } from "react-native";
import { EntityForm, type FieldSpec } from "@/lib/EntityForm";

const fields: FieldSpec[] = [
  { key: "name", label: "Business name", required: true },
  { key: "gstin", label: "GSTIN", kind: "upper" },
  { key: "pan", label: "PAN", kind: "upper" },
  { key: "phone", label: "Phone", kind: "phone" },
  { key: "email", label: "Email", kind: "email" },
  { key: "website", label: "Website", kind: "email" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State", kind: "state" },
  { key: "pincode", label: "Pincode", kind: "phone" },
  { key: "bankName", label: "Bank name" },
  { key: "bankAccount", label: "Account number", kind: "phone" },
  { key: "bankIfsc", label: "IFSC code", kind: "upper" },
  { key: "bankBranch", label: "Branch" },
  { key: "invoicePrefix", label: "Invoice prefix", kind: "upper", placeholder: "INV" },
  { key: "termsConditions", label: "Terms & conditions", kind: "multiline" },
];

export default function Settings() {
  return (
    <>
      <Stack.Screen options={{ title: "Business settings" }} />
      <EntityForm fields={fields} load="/business" target="/business" method="PATCH" submitLabel="Save settings"
        onSaved={() => Alert.alert("Saved", "Business details updated.")} />
    </>
  );
}
