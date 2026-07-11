import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Truck, FileText, MapPin, Package } from "lucide-react";
import { Link } from "wouter";
import { formatCurrency } from "@/lib/utils";

function authFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("gst_token");
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
}

const SUPPLY_TYPES = [
  { value: "O", label: "Outward" },
  { value: "I", label: "Inward" },
];

const SUB_SUPPLY_TYPES = [
  { value: "1", label: "Supply" },
  { value: "3", label: "Export" },
  { value: "4", label: "Job Work" },
  { value: "5", label: "For Own Use" },
  { value: "6", label: "Job Work Returns" },
  { value: "7", label: "Sales Return" },
  { value: "8", label: "Others" },
];

const DOC_TYPES = [
  { value: "INV", label: "Tax Invoice" },
  { value: "BIL", label: "Bill of Supply" },
  { value: "BOE", label: "Bill of Entry" },
  { value: "CHL", label: "Delivery Challan" },
  { value: "OTH", label: "Other" },
];

const TRANS_MODES = [
  { value: "1", label: "Road" },
  { value: "2", label: "Rail" },
  { value: "3", label: "Air" },
  { value: "4", label: "Ship / Water" },
];

const VEHICLE_TYPES = [
  { value: "R", label: "Regular" },
  { value: "O", label: "Over Dimensional Cargo (ODC)" },
];

const STATE_CODES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu & Kashmir" }, { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" }, { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" }, { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" }, { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" }, { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" }, { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" }, { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" }, { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra & Nagar Haveli and Daman & Diu" }, { code: "27", name: "Maharashtra" },
  { code: "28", name: "Andhra Pradesh (New)" }, { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" }, { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" }, { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" }, { code: "35", name: "Andaman & Nicobar" },
  { code: "36", name: "Telangana" }, { code: "37", name: "Andhra Pradesh (Old)" },
  { code: "38", name: "Ladakh" },
];

function today() {
  return new Date().toISOString().split("T")[0];
}

interface FormState {
  supplyType: string;
  subSupplyType: string;
  docType: string;
  docNo: string;
  docDate: string;
  invoiceId: string;
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromCity: string;
  fromState: string;
  fromPincode: string;
  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toCity: string;
  toState: string;
  toPincode: string;
  transMode: string;
  transDistance: string;
  transporterName: string;
  transporterId: string;
  transDocNo: string;
  transDocDate: string;
  vehicleNo: string;
  vehicleType: string;
}

export default function EwayBillNewPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>({
    supplyType: "O", subSupplyType: "1", docType: "INV",
    docNo: "", docDate: today(), invoiceId: "",
    fromGstin: "", fromTrdName: "", fromAddr1: "", fromCity: "", fromState: "", fromPincode: "",
    toGstin: "", toTrdName: "", toAddr1: "", toCity: "", toState: "", toPincode: "",
    transMode: "1", transDistance: "", transporterName: "", transporterId: "",
    transDocNo: "", transDocDate: "", vehicleNo: "", vehicleType: "R",
  });

  const { data: businessData } = useQuery({
    queryKey: ["business"],
    queryFn: () => authFetch("/api/business").then(r => r.json()),
  });

  const { data: invoicesData } = useQuery({
    queryKey: ["invoices-for-ewb"],
    queryFn: () => authFetch("/api/invoices").then(r => r.json()),
  });

  const { data: invoiceDetail, isLoading: invoiceLoading } = useQuery({
    queryKey: ["invoice-detail-ewb", form.invoiceId],
    queryFn: () => authFetch(`/api/invoices/${form.invoiceId}`).then(r => r.json()),
    enabled: !!form.invoiceId,
  });

  const { data: customersData } = useQuery({
    queryKey: ["customers"],
    queryFn: () => authFetch("/api/customers").then(r => r.json()),
  });

  useEffect(() => {
    const biz = businessData?.business;
    if (!biz) return;
    setForm(f => ({
      ...f,
      fromGstin: biz.gstin ?? f.fromGstin,
      fromTrdName: biz.name ?? f.fromTrdName,
      fromAddr1: biz.address ?? f.fromAddr1,
    }));
  }, [businessData]);

  useEffect(() => {
    if (!invoiceDetail) return;
    const inv = invoiceDetail;
    const customer = (customersData?.customers ?? []).find((c: any) => c.id === inv.customerId);
    setForm(f => ({
      ...f,
      docNo: inv.invoiceNumber ?? f.docNo,
      docDate: inv.date ?? f.docDate,
      toGstin: customer?.gstin ?? f.toGstin,
      toTrdName: customer?.name ?? f.toTrdName,
    }));
  }, [invoiceDetail, customersData]);

  const set = (field: keyof FormState) => (val: string) => setForm(f => ({ ...f, [field]: val }));
  const inp = (field: keyof FormState) => ({
    value: form[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [field]: e.target.value })),
  });

  const invoices: any[] = invoicesData?.invoices ?? [];
  const selectedInvoice = form.invoiceId ? invoiceDetail : null;

  const totalValue = selectedInvoice ? parseFloat(selectedInvoice.taxableAmount ?? "0") : 0;
  const cgstValue = selectedInvoice ? parseFloat(selectedInvoice.cgst ?? "0") : 0;
  const sgstValue = selectedInvoice ? parseFloat(selectedInvoice.sgst ?? "0") : 0;
  const igstValue = selectedInvoice ? parseFloat(selectedInvoice.igst ?? "0") : 0;
  const totalInvValue = selectedInvoice ? parseFloat(selectedInvoice.grandTotal ?? "0") : 0;
  const items = selectedInvoice?.items ?? [];

  const createMutation = useMutation({
    mutationFn: (body: any) => authFetch("/api/eway-bills", { method: "POST", body: JSON.stringify(body) }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.error) { toast({ title: "Error", description: data.error, variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: ["eway-bills"] });
      toast({ title: "E-Way Bill created", description: `Document: ${form.docNo}` });
      navigate(`/eway-bills/${data.bill.id}`);
    },
    onError: () => toast({ title: "Error", description: "Failed to create E-Way Bill", variant: "destructive" }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.docNo) { toast({ title: "Document number required", variant: "destructive" }); return; }
    createMutation.mutate({
      ...form,
      invoiceId: form.invoiceId ? parseInt(form.invoiceId) : undefined,
      totalValue, cgstValue, sgstValue, igstValue, totalInvValue,
      items,
    });
  }

  const SectionHeader = ({ icon: Icon, title }: { icon: any; title: string }) => (
    <div className="flex items-center gap-2 mb-4">
      <div className="p-1.5 rounded-md bg-primary/10"><Icon className="w-4 h-4 text-primary" /></div>
      <h3 className="font-semibold text-sm text-foreground">{title}</h3>
    </div>
  );

  const Field = ({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) => (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
      {children}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link href="/eway-bills"><Button variant="ghost" size="icon" type="button"><ArrowLeft className="w-4 h-4" /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold">New E-Way Bill</h1>
          <p className="text-sm text-muted-foreground">Fill in details for goods movement (required for consignments &gt; ₹50,000)</p>
        </div>
      </div>

      {/* ── Link Invoice (optional) ── */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Link Existing Invoice (Optional)</CardTitle></CardHeader>
        <CardContent>
          <Field label="Select Invoice">
            <Select value={form.invoiceId} onValueChange={set("invoiceId")}>
              <SelectTrigger><SelectValue placeholder="Choose an invoice to auto-fill details…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None — fill manually</SelectItem>
                {invoices.map((inv: any) => (
                  <SelectItem key={inv.id} value={String(inv.id)}>
                    {inv.invoiceNumber} — {inv.customerName ?? "Customer"} — {formatCurrency(inv.grandTotal)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.invoiceId && invoiceLoading && <p className="text-xs text-muted-foreground mt-2">Loading invoice details…</p>}
          {selectedInvoice && (
            <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div><p className="text-xs text-muted-foreground">Invoice #</p><p className="font-mono font-semibold">{selectedInvoice.invoiceNumber}</p></div>
              <div><p className="text-xs text-muted-foreground">Taxable</p><p className="font-semibold">{formatCurrency(selectedInvoice.taxableAmount)}</p></div>
              <div><p className="text-xs text-muted-foreground">GST</p><p className="font-semibold">{formatCurrency((cgstValue + sgstValue + igstValue))}</p></div>
              <div><p className="text-xs text-muted-foreground">Total</p><p className="font-semibold text-primary">{formatCurrency(selectedInvoice.grandTotal)}</p></div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Document Details ── */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Document Details</CardTitle></CardHeader>
        <CardContent>
          <SectionHeader icon={FileText} title="Supply & Document Information" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Supply Type" required>
              <Select value={form.supplyType} onValueChange={set("supplyType")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SUPPLY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Sub Supply Type" required>
              <Select value={form.subSupplyType} onValueChange={set("subSupplyType")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SUB_SUPPLY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Document Type" required>
              <Select value={form.docType} onValueChange={set("docType")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Document / Invoice Number" required>
              <Input placeholder="e.g. INV-2024-001" {...inp("docNo")} />
            </Field>
            <Field label="Document Date" required>
              <Input type="date" {...inp("docDate")} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* ── From / To ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">From (Supplier / Consignor)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <SectionHeader icon={MapPin} title="Dispatch Address" />
            <Field label="GSTIN">
              <Input placeholder="22AAAAA0000A1Z5" {...inp("fromGstin")} />
            </Field>
            <Field label="Trade / Legal Name">
              <Input placeholder="Business legal name" {...inp("fromTrdName")} />
            </Field>
            <Field label="Address">
              <Input placeholder="Building, Street" {...inp("fromAddr1")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <Input placeholder="City" {...inp("fromCity")} />
              </Field>
              <Field label="Pincode">
                <Input placeholder="400001" {...inp("fromPincode")} />
              </Field>
            </div>
            <Field label="State">
              <Select value={form.fromState} onValueChange={set("fromState")}>
                <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>{STATE_CODES.map(s => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">To (Recipient / Consignee)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <SectionHeader icon={MapPin} title="Delivery Address" />
            <Field label="GSTIN">
              <Input placeholder="27BBBBB0000B1Z0" {...inp("toGstin")} />
            </Field>
            <Field label="Trade / Legal Name">
              <Input placeholder="Recipient legal name" {...inp("toTrdName")} />
            </Field>
            <Field label="Address">
              <Input placeholder="Building, Street" {...inp("toAddr1")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <Input placeholder="City" {...inp("toCity")} />
              </Field>
              <Field label="Pincode">
                <Input placeholder="400001" {...inp("toPincode")} />
              </Field>
            </div>
            <Field label="State">
              <Select value={form.toState} onValueChange={set("toState")}>
                <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                <SelectContent>{STATE_CODES.map(s => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>
      </div>

      {/* ── Transport Details ── */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Transportation Details</CardTitle></CardHeader>
        <CardContent>
          <SectionHeader icon={Truck} title="Vehicle & Transporter Information" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="Transport Mode" required>
              <Select value={form.transMode} onValueChange={set("transMode")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TRANS_MODES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Vehicle Type">
              <Select value={form.vehicleType} onValueChange={set("vehicleType")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{VEHICLE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Vehicle Number">
              <Input placeholder="MH01AB1234" {...inp("vehicleNo")} />
            </Field>
            <Field label="Approximate Distance (KM)">
              <Input type="number" placeholder="e.g. 150" {...inp("transDistance")} />
            </Field>
            <Field label="Transporter Name">
              <Input placeholder="Transporter name" {...inp("transporterName")} />
            </Field>
            <Field label="Transporter GSTIN / ID">
              <Input placeholder="Transporter GSTIN" {...inp("transporterId")} />
            </Field>
            <Field label="Transport Document No.">
              <Input placeholder="LR / RR / Air Waybill No." {...inp("transDocNo")} />
            </Field>
            <Field label="Transport Document Date">
              <Input type="date" {...inp("transDocDate")} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* ── Items Preview ── */}
      {items.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Items from Invoice</CardTitle></CardHeader>
          <CardContent className="p-0">
            <SectionHeader icon={Package} title="Goods Details" />
            <div className="overflow-x-auto px-6 pb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 font-medium">Item</th>
                    <th className="text-left py-2 font-medium">HSN / SAC</th>
                    <th className="text-right py-2 font-medium">Qty</th>
                    <th className="text-right py-2 font-medium">Rate</th>
                    <th className="text-right py-2 font-medium">Taxable Value</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-4">{item.description}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{item.hsnCode ?? "—"}</td>
                      <td className="py-2 pr-4 text-right">{item.quantity}</td>
                      <td className="py-2 pr-4 text-right">{formatCurrency(item.unitPrice)}</td>
                      <td className="py-2 text-right font-medium">{formatCurrency(item.quantity * item.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Actions ── */}
      <div className="flex gap-3 justify-end pb-8">
        <Link href="/eway-bills"><Button variant="outline" type="button">Cancel</Button></Link>
        <Button type="submit" disabled={createMutation.isPending} className="gap-2">
          <Truck className="w-4 h-4" />
          {createMutation.isPending ? "Creating…" : "Create E-Way Bill"}
        </Button>
      </div>
    </form>
  );
}
