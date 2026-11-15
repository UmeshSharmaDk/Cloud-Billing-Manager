import { Stack, useLocalSearchParams } from "expo-router";
import { ListScreen, Line } from "@/lib/ListScreen";
import { date, money } from "@/lib/format";
import type { Purchase } from "@/lib/types";
import { StatusPill } from "@/lib/ui";

/** An admin's read-only list of one user's purchase bills. */
export default function UserPurchases() {
  const { asUser, name } = useLocalSearchParams<{ asUser: string; name?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: `${name ?? "User"} · purchases` }} />
      <ListScreen<Purchase> path="/purchases" listKey="purchases" params={{ asUser }} search="Search by bill number" empty="No purchase bills yet."
        href={(p) => ({ pathname: "/purchase/[id]", params: { id: String(p.id), asUser } })}
        renderItem={(p) => (
          <Line title={p.vendorName} sub={`${p.invoiceNumber} · ${date(p.invoiceDate)}`} right={money(p.grandTotal)} below={<StatusPill status={p.status} />} />
        )} />
    </>
  );
}
