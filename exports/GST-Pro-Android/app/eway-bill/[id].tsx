import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { Alert, ScrollView, Text } from "react-native";
import { api, apiDownload } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useSave } from "@/lib/save";
import type { EwayBill } from "@/lib/types";
import { Button, Card, ErrorView, Loading, Row, s, StatusPill, pullToRefresh } from "@/lib/ui";

const MODES: Record<string, string> = { "1": "Road", "2": "Rail", "3": "Air", "4": "Ship / Water" };
const str = (v: unknown) => (v == null || v === "" ? "—" : String(v));

export default function EwayBillDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: [`/eway-bills/${id}`], queryFn: () => api<EwayBill>(`/eway-bills/${encodeURIComponent(id)}`) });
  const irp = useQuery({ queryKey: ["/business/irp"], queryFn: () => api<{ configured: boolean }>("/business/irp") });
  const { busy, run } = useSave();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorView error={q.error} onRetry={q.refetch} />;
  const b = q.data!;
  const patch = (body: object) => run(() => api(`/eway-bills/${b.id}`, { method: "PATCH", body }));

  const shareFile = () => run(async () => {
    const uri = await apiDownload(`/eway-bills/${b.id}/json`, `EWB_${b.docNo}.json`);
    await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: "Upload at ewaybillgst.gov.in" });
  });
  const direct = !!irp.data?.configured && !!b.invoiceId;
  const generate = () => run(() => api(`/eway-bills/${b.id}/generate`, { method: "POST", body: {} }), () => Alert.alert("E-way bill generated"));
  const cancel = () => Alert.alert("Cancel this e-way bill?", "This cannot be undone.", [
    { text: "Keep", style: "cancel" },
    { text: "Cancel bill", style: "destructive", onPress: () => patch({ status: "cancelled" }) },
  ]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }} refreshControl={pullToRefresh(q)}>
      <Stack.Screen options={{ title: b.ewbNo || b.docNo }} />
      <Card title={b.ewbNo || "Draft"} right={<StatusPill status={b.status} />}>
        <Row label="Document" value={`${str(b.docType)} ${b.docNo}`} />
        <Row label="Document date" value={date(b.docDate)} />
        {!!b.ewbDate && <Row label="Generated" value={date(b.ewbDate)} />}
        {!!b.validUpto && <Row label="Valid until" value={date(b.validUpto)} />}
        <Row label="Invoice value" value={money(b.totalInvValue)} />
      </Card>
      {b.status === "draft" && (
        <Card>
          {direct && <Button title="Generate e-way bill" busy={busy} onPress={generate} />}
          <Text style={s.muted}>{direct ? "Or by hand: share the file, upload it at ewaybillgst.gov.in (Bulk Generation), then enter the number." : "Share the file to yourself, upload it at ewaybillgst.gov.in (Bulk Generation), then enter the number it gives you."}</Text>
          <Button title="Share portal file" variant="outline" busy={busy} onPress={shareFile} />
          <Button title="Enter e-way bill number" variant={direct ? "outline" : "primary"} onPress={() => router.push({ pathname: "/eway-bill/number", params: { id: String(b.id) } })} />
        </Card>
      )}
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
