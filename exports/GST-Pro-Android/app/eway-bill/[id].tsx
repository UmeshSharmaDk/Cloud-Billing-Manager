import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { Alert, ScrollView } from "react-native";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useSave } from "@/lib/save";
import type { EwayBill } from "@/lib/types";
import { Button, Card, ErrorView, Loading, Row, s, StatusPill } from "@/lib/ui";

const MODES: Record<string, string> = { "1": "Road", "2": "Rail", "3": "Air", "4": "Ship / Water" };
const str = (v: unknown) => (v == null || v === "" ? "—" : String(v));

export default function EwayBillDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: [`/eway-bills/${id}`], queryFn: () => api<EwayBill>(`/eway-bills/${encodeURIComponent(id)}`) });
  const { busy, run } = useSave();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorView error={q.error} onRetry={q.refetch} />;
  const b = q.data!;
  const patch = (body: object) => run(() => api(`/eway-bills/${b.id}`, { method: "PATCH", body }));

  // Same as the website: a local EWB number, valid one day per 200 km (at least one day).
  const generate = () => {
    const days = Math.max(1, Math.ceil(Number(b.transDistance ?? 0) / 200));
    patch({
      status: "generated",
      ewbNo: `EWB${String(b.id).padStart(12, "0")}`,
      ewbDate: new Date().toISOString().slice(0, 10),
      validUpto: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10),
    });
  };
  const cancel = () => Alert.alert("Cancel this e-way bill?", "This cannot be undone.", [
    { text: "Keep", style: "cancel" },
    { text: "Cancel bill", style: "destructive", onPress: () => patch({ status: "cancelled" }) },
  ]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Stack.Screen options={{ title: b.ewbNo || b.docNo }} />
      <Card title={b.ewbNo || "Draft"} right={<StatusPill status={b.status} />}>
        <Row label="Document" value={`${str(b.docType)} ${b.docNo}`} />
        <Row label="Document date" value={date(b.docDate)} />
        {!!b.ewbDate && <Row label="Generated" value={date(b.ewbDate)} />}
        {!!b.validUpto && <Row label="Valid until" value={date(b.validUpto)} />}
        <Row label="Invoice value" value={money(b.totalInvValue)} />
      </Card>
      {b.status === "draft" && <Button title="Generate e-way bill" busy={busy} onPress={generate} />}
      {b.status === "generated" && <Button title="Cancel e-way bill" variant="danger" busy={busy} onPress={cancel} />}
      <Card title="From">
        <Row label="Name" value={str(b.fromTrdName)} />
        <Row label="GSTIN" value={str(b.fromGstin)} />
        <Row label="Address" value={[b.fromAddr1, b.fromCity, b.fromState, b.fromPincode].filter(Boolean).join(", ") || "—"} />
      </Card>
      <Card title="To">
        <Row label="Name" value={str(b.toTrdName)} />
        <Row label="GSTIN" value={str(b.toGstin)} />
        <Row label="Address" value={[b.toAddr1, b.toCity, b.toState, b.toPincode].filter(Boolean).join(", ") || "—"} />
      </Card>
      <Card title="Transport">
        <Row label="Mode" value={MODES[String(b.transMode)] ?? str(b.transMode)} />
        <Row label="Distance" value={b.transDistance ? `${b.transDistance} km` : "—"} />
        <Row label="Transporter" value={str(b.transporterName)} />
        <Row label="Vehicle" value={str(b.vehicleNo)} />
      </Card>
      <Card title="Tax">
        <Row label="Taxable value" value={money(b.totalValue as number)} />
        <Row label="CGST / SGST" value={`${money(b.cgstValue as number)} / ${money(b.sgstValue as number)}`} />
        <Row label="IGST" value={money(b.igstValue as number)} />
      </Card>
    </ScrollView>
  );
}
