import { Stack } from "expo-router";
import { ListScreen, Line } from "@/lib/ListScreen";
import { date, money } from "@/lib/format";
import type { EwayBill } from "@/lib/types";
import { StatusPill } from "@/lib/ui";

export default function EwayBills() {
  return (
    <>
      <Stack.Screen options={{ title: "E-way bills" }} />
      <ListScreen<EwayBill> path="/eway-bills" listKey="bills" search={false} empty="No e-way bills yet."
        href={(b) => `/eway-bill/${b.id}`} newHref="/eway-bill/new"
        renderItem={(b) => (
          <Line title={b.ewbNo || b.docNo} sub={[b.ewbNo && b.docNo, date(b.docDate), b.vehicleNo].filter(Boolean).join(" · ")}
            right={money(b.totalInvValue)} below={<StatusPill status={b.status} />} />
        )} />
    </>
  );
}
