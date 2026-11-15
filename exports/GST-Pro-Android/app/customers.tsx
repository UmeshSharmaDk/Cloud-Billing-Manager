import { Stack } from "expo-router";
import { ListScreen, Line } from "@/lib/ListScreen";
import { money } from "@/lib/format";
import type { Customer } from "@/lib/types";
import { colors } from "@/lib/ui";
import { Text } from "react-native";

/** Customers and vendors share this list; `kind` picks the endpoint. */
export function PartyList({ kind }: { kind: "customer" | "vendor" }) {
  const plural = kind === "customer" ? "customers" : "vendors";
  return (
    <>
      <Stack.Screen options={{ title: kind === "customer" ? "Customers" : "Vendors" }} />
      <ListScreen<Customer> path={`/${plural}`} listKey={plural} search={`Search ${plural}`} empty={`No ${plural} found.`}
        href={(c) => `/${kind}/${c.id}`} newHref={`/${kind}/form`}
        renderItem={(c) => (
          <Line title={c.name} sub={[c.gstin, c.city].filter(Boolean).join(" · ") || "—"}
            right={c.outstandingBalance ? <Text style={{ color: colors.danger, fontWeight: "600" }}>{money(c.outstandingBalance)}</Text> : undefined} />
        )} />
    </>
  );
}

export default function Customers() {
  return <PartyList kind="customer" />;
}
