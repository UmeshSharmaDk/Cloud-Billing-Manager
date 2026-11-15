import { ListScreen, Line } from "@/lib/ListScreen";
import { date, money } from "@/lib/format";
import type { Purchase } from "@/lib/types";
import { StatusPill } from "@/lib/ui";

export default function Purchases() {
  return (
    <ListScreen<Purchase> path="/purchases" listKey="purchases" search="Search by bill number" empty="No purchase bills yet."
      href={(p) => `/purchase/${p.id}`} newHref="/purchase/new"
      renderItem={(p) => (
        <Line title={p.vendorName} sub={`${p.invoiceNumber} · ${date(p.invoiceDate)}`} right={money(p.grandTotal)} below={<StatusPill status={p.status} />} />
      )} />
  );
}
