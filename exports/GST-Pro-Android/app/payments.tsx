import { Stack } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";
import { ListScreen, Line } from "@/lib/ListScreen";
import { date, money } from "@/lib/format";
import type { Payment } from "@/lib/types";
import { Chips, colors } from "@/lib/ui";

const TYPES = ["all", "received", "paid"] as const;
const incoming = (t: string) => t === "received" || t === "in";

export default function Payments() {
  const [type, setType] = useState<(typeof TYPES)[number]>("all");
  return (
    <>
      <Stack.Screen options={{ title: "Payments" }} />
      <ListScreen<Payment> path="/payments" listKey="payments" params={type === "all" ? {} : { type }} search={false}
        filters={<Chips options={TYPES} value={type} onChange={setType} />} empty="No payments recorded." href={() => null}
        renderItem={(p) => (
          <Line title={`${incoming(p.type) ? "Received" : "Paid out"} · ${p.mode.replace(/_/g, " ")}`}
            sub={[date(p.date), p.referenceNumber, p.notes].filter(Boolean).join(" · ")}
            right={<Text style={{ fontWeight: "700", color: incoming(p.type) ? "#16a34a" : colors.danger }}>{money(p.amount)}</Text>} />
        )} />
    </>
  );
}
