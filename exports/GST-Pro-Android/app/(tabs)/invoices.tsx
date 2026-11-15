import { useState } from "react";
import { ListScreen, Line } from "@/lib/ListScreen";
import { date, money } from "@/lib/format";
import type { Invoice } from "@/lib/types";
import { Chips, StatusPill } from "@/lib/ui";

const FILTERS = ["all", "unpaid", "partial", "paid", "cancelled"] as const;

export default function Invoices() {
  const [status, setStatus] = useState<(typeof FILTERS)[number]>("all");
  return (
    <ListScreen<Invoice> path="/invoices" listKey="invoices" params={status === "all" ? {} : { status }}
      search="Search by invoice number" empty="No invoices found."
      filters={<Chips options={FILTERS} value={status} onChange={setStatus} />}
      href={(i) => `/invoice/${i.id}`} newHref="/invoice/new"
      renderItem={(i) => (
        <Line title={i.invoiceNumber} sub={`${i.customerName} · ${date(i.invoiceDate)}`} right={money(i.grandTotal)} below={<StatusPill status={i.status} />} />
      )} />
  );
}
