import { Stack, useLocalSearchParams } from "expo-router";
import { ListScreen, Line } from "@/lib/ListScreen";
import { date, money } from "@/lib/format";
import type { Invoice } from "@/lib/types";
import { StatusPill } from "@/lib/ui";

/** An admin's read-only list of one user's invoices. */
export default function UserInvoices() {
  const { asUser, name } = useLocalSearchParams<{ asUser: string; name?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: `${name ?? "User"} · invoices` }} />
      <ListScreen<Invoice> path="/invoices" listKey="invoices" params={{ asUser }} search="Search by invoice number" empty="No invoices yet."
        href={(i) => ({ pathname: "/invoice/[id]", params: { id: String(i.id), asUser } })}
        renderItem={(i) => (
          <Line title={i.invoiceNumber} sub={`${i.customerName} · ${date(i.invoiceDate)}`} right={money(i.grandTotal)} below={<StatusPill status={i.status} />} />
        )} />
    </>
  );
}
