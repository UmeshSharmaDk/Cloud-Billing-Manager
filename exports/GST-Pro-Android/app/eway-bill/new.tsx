import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { api } from "@/lib/api";
import { FormFields, missing, type FieldSpec } from "@/lib/EntityForm";
import { money } from "@/lib/format";
import { today, useSave } from "@/lib/save";
import { stateOptions } from "@/lib/states";
import type { Business, Customer, EwayBill, Invoice } from "@/lib/types";
import { Button, Card, Form, Row, Select } from "@/lib/ui";

const opts = (pairs: string[][]) => pairs.map(([value, label]) => ({ value, label }));

const DOC: FieldSpec[] = [
  { key: "supplyType", label: "Supply type", kind: "select", options: opts([["O", "Outward"], ["I", "Inward"]]) },
  { key: "subSupplyType", label: "Sub type", kind: "select", options: opts([["1", "Supply"], ["3", "Export"], ["4", "Job Work"], ["5", "For Own Use"], ["6", "Job Work Returns"], ["7", "Sales Return"], ["8", "Others"]]) },
  { key: "docType", label: "Document type", kind: "select", options: opts([["INV", "Tax Invoice"], ["BIL", "Bill of Supply"], ["BOE", "Bill of Entry"], ["CHL", "Delivery Challan"], ["OTH", "Other"]]) },
  { key: "docNo", label: "Document number", required: true },
  { key: "docDate", label: "Document date", kind: "date", required: true },
];
const party = (p: "from" | "to"): FieldSpec[] => [
  { key: `${p}Gstin`, label: "GSTIN", kind: "upper" },
  { key: `${p}TrdName`, label: "Trade name" },
  { key: `${p}Addr1`, label: "Address" },
  { key: `${p}City`, label: "City" },
  { key: `${p}State`, label: "State", kind: "select", options: stateOptions },
  { key: `${p}Pincode`, label: "Pincode", kind: "phone" },
];
const TRANSPORT: FieldSpec[] = [
  { key: "transMode", label: "Mode", kind: "select", options: opts([["1", "Road"], ["2", "Rail"], ["3", "Air"], ["4", "Ship / Water"]]) },
  { key: "transDistance", label: "Distance (km)", kind: "number" },
  { key: "transporterName", label: "Transporter name" },
  { key: "transporterId", label: "Transporter ID", kind: "upper" },
  { key: "transDocNo", label: "Transport doc number" },
  { key: "transDocDate", label: "Transport doc date", kind: "date" },
  { key: "vehicleNo", label: "Vehicle number", kind: "upper" },
  { key: "vehicleType", label: "Vehicle type", kind: "select", options: opts([["R", "Regular"], ["O", "Over Dimensional Cargo (ODC)"]]) },
];
const ALL = [...DOC, ...party("from"), ...party("to"), ...TRANSPORT];

export default function NewEwayBill() {
  const params = useLocalSearchParams<{ invoiceId?: string }>();
  const [invoiceId, setInvoiceId] = useState(params.invoiceId ?? "");
  const [v, setV] = useState<Record<string, string>>({ supplyType: "O", subSupplyType: "1", docType: "INV", docDate: today(), transMode: "1", vehicleType: "R" });
  const set = (k: string, x: string) => setV((p) => ({ ...p, [k]: x }));
  const { busy, run } = useSave();

  const biz = useQuery({ queryKey: ["/business"], queryFn: () => api<Business>("/business") }).data;
  const invoices = useQuery({ queryKey: ["/invoices", "picker"], queryFn: () => api<{ invoices: Invoice[] }>("/invoices?limit=100") }).data?.invoices ?? [];
  const inv = useQuery({ queryKey: [`/invoices/${invoiceId}`], queryFn: () => api<Invoice>(`/invoices/${invoiceId}`), enabled: !!invoiceId }).data;
  const cust = useQuery({ queryKey: [`/customers/${inv?.customerId}`], queryFn: () => api<Customer>(`/customers/${inv!.customerId}`), enabled: !!inv?.customerId }).data;

  // Prefill the sender from the business, and the document and recipient from the chosen invoice.
  useEffect(() => {
    if (biz) setV((p) => ({ ...p, fromGstin: String(biz.gstin ?? ""), fromTrdName: biz.name, fromAddr1: String(biz.address ?? ""), fromCity: String(biz.city ?? ""), fromState: String(biz.stateCode ?? ""), fromPincode: String(biz.pincode ?? "") }));
  }, [biz]);
  useEffect(() => {
    if (inv) setV((p) => ({ ...p, docNo: inv.invoiceNumber, docDate: inv.invoiceDate.slice(0, 10), toGstin: inv.customerGstin ?? "", toTrdName: inv.customerName }));
  }, [inv]);
  useEffect(() => {
    if (cust) setV((p) => ({ ...p, toAddr1: cust.address ?? "", toCity: cust.city ?? "", toState: cust.stateCode ?? "", toPincode: cust.pincode ?? "" }));
  }, [cust]);

  const submit = () => {
    const gap = missing(ALL, v);
    if (gap) return Alert.alert("Missing field", `${gap.label} is required.`);
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim() !== ""));
    if (v.transDistance) body.transDistance = Number(v.transDistance);
    if (inv) Object.assign(body, {
      invoiceId: inv.id, totalValue: inv.subtotal, cgstValue: inv.cgst ?? 0, sgstValue: inv.sgst ?? 0, igstValue: inv.igst ?? 0,
      totalInvValue: inv.grandTotal, items: inv.items ?? [],
    });
    run(() => api<{ bill: EwayBill }>("/eway-bills", { method: "POST", body }), (r) => router.replace(`/eway-bill/${r.bill.id}`));
  };

  return (
    <Form>
      <Stack.Screen options={{ title: "New e-way bill" }} />
      <Card title="From invoice">
        <Select label="Invoice (optional)" value={invoiceId} onChange={setInvoiceId} placeholder="Fill in by hand"
          options={invoices.map((i) => ({ value: String(i.id), label: `${i.invoiceNumber} · ${i.customerName}` }))} />
        {inv && <Row label="Invoice value" value={money(inv.grandTotal)} />}
      </Card>
      <Card title="Document"><FormFields fields={DOC} value={v} set={set} /></Card>
      <Card title="From (consignor)"><FormFields fields={party("from")} value={v} set={set} /></Card>
      <Card title="To (consignee)"><FormFields fields={party("to")} value={v} set={set} /></Card>
      <Card title="Transport"><FormFields fields={TRANSPORT} value={v} set={set} /></Card>
      <Button title="Save draft" busy={busy} onPress={submit} />
    </Form>
  );
}
