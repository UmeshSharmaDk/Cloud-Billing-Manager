import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Printer, XCircle, Truck, CheckCircle2, Clock } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { authFetch } from "@/lib/api-fetch";

const STATUS_CONFIG: Record<string, { label: string; icon: any; className: string }> = {
  draft:     { label: "Draft",     icon: Clock,        className: "text-gray-600 bg-gray-100" },
  generated: { label: "Generated", icon: CheckCircle2, className: "text-green-700 bg-green-100" },
  cancelled: { label: "Cancelled", icon: XCircle,      className: "text-red-600 bg-red-100" },
};

const TRANS_MODE_LABEL: Record<string, string> = {
  "1": "Road", "2": "Rail", "3": "Air", "4": "Ship / Water",
};

const DOC_TYPE_LABEL: Record<string, string> = {
  INV: "Tax Invoice", BIL: "Bill of Supply", BOE: "Bill of Entry",
  CHL: "Delivery Challan", OTH: "Other",
};

const SUPPLY_TYPE_LABEL: Record<string, string> = { O: "Outward", I: "Inward" };

const STATE_MAP: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & NH", "27": "Maharashtra", "28": "Andhra Pradesh", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar", "36": "Telangana",
  "37": "Andhra Pradesh (Old)", "38": "Ladakh",
};

function stateName(code: string) {
  return STATE_MAP[code] ? `${code} — ${STATE_MAP[code]}` : code;
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-1.5 border-b last:border-0 gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-right">{value}</span>
    </div>
  );
}

export default function EwayBillDetailPage() {
  const [, params] = useRoute("/eway-bills/:id");
  const id = params?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: bill, isLoading } = useQuery({
    queryKey: ["eway-bill", id],
    queryFn: () => authFetch(`/api/eway-bills/${id}`).then(r => r.json()),
    enabled: !!id,
  });

  const cancelMutation = useMutation({
    mutationFn: () => authFetch(`/api/eway-bills/${id}`, { method: "PATCH", body: JSON.stringify({ status: "cancelled" }) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eway-bill", id] });
      queryClient.invalidateQueries({ queryKey: ["eway-bills"] });
      toast({ title: "E-Way Bill cancelled" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => authFetch(`/api/eway-bills/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "generated",
        ewbNo: `EWB${String(id).padStart(12, "0")}`,
        ewbDate: new Date().toISOString().split("T")[0],
        validUpto: new Date(Date.now() + bill?.transDistance && parseInt(bill.transDistance) > 200 ? 2 : 1 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      }),
    }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["eway-bill", id] });
      queryClient.invalidateQueries({ queryKey: ["eway-bills"] });
      toast({ title: "E-Way Bill generated", description: `EWB No: ${data.ewbNo}` });
    },
  });

  if (isLoading) return (
    <div className="space-y-4 animate-pulse max-w-4xl">
      <div className="h-8 w-48 bg-muted rounded" />
      {[...Array(4)].map((_, i) => <div key={i} className="h-40 bg-muted rounded-xl" />)}
    </div>
  );

  if (!bill || bill.error) return (
    <div className="text-center py-20">
      <p className="text-muted-foreground">E-Way Bill not found.</p>
      <Link href="/eway-bills"><Button variant="outline" className="mt-4">Go Back</Button></Link>
    </div>
  );

  const stConfig = STATUS_CONFIG[bill.status] ?? STATUS_CONFIG.draft;
  const StatusIcon = stConfig.icon;
  const items: any[] = bill.items ?? [];

  return (
    <div className="max-w-4xl space-y-5" id="ewb-print-area">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/eway-bills"><Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button></Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">E-Way Bill</h1>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${stConfig.className}`}>
                <StatusIcon className="w-3.5 h-3.5" />{stConfig.label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">Document: <span className="font-mono font-semibold">{bill.docNo}</span>{bill.ewbNo && <> · EWB: <span className="font-mono font-semibold text-primary">{bill.ewbNo}</span></>}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {bill.status === "draft" && (
            <Button variant="default" className="gap-2" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
              <Truck className="w-4 h-4" />{generateMutation.isPending ? "Generating…" : "Generate EWB"}
            </Button>
          )}
          {bill.status === "generated" && (
            <Button variant="outline" className="gap-2 text-red-600 border-red-200 hover:bg-red-50" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              <XCircle className="w-4 h-4" />{cancelMutation.isPending ? "Cancelling…" : "Cancel EWB"}
            </Button>
          )}
          <Button variant="outline" className="gap-2" onClick={() => window.print()}>
            <Printer className="w-4 h-4" />Print
          </Button>
        </div>
      </div>

      {/* EWB Info Banner (when generated) */}
      {bill.status === "generated" && bill.ewbNo && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-4 flex flex-wrap gap-6 items-center">
            <div><p className="text-xs text-green-700 font-medium">EWB Number</p><p className="text-xl font-bold text-green-800 font-mono">{bill.ewbNo}</p></div>
            <div><p className="text-xs text-green-700 font-medium">Generated On</p><p className="font-semibold text-green-800">{bill.ewbDate}</p></div>
            <div><p className="text-xs text-green-700 font-medium">Valid Up To</p><p className="font-semibold text-green-800">{bill.validUpto ?? "—"}</p></div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Document Details */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase tracking-wide">Document Details</CardTitle></CardHeader>
          <CardContent className="space-y-0">
            <Row label="Supply Type" value={SUPPLY_TYPE_LABEL[bill.supplyType] ?? bill.supplyType} />
            <Row label="Document Type" value={DOC_TYPE_LABEL[bill.docType] ?? bill.docType} />
            <Row label="Document Number" value={bill.docNo} />
            <Row label="Document Date" value={bill.docDate} />
          </CardContent>
        </Card>

        {/* Value Details */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase tracking-wide">Value Details</CardTitle></CardHeader>
          <CardContent className="space-y-0">
            <Row label="Taxable Value" value={formatCurrency(bill.totalValue)} />
            <Row label="CGST" value={formatCurrency(bill.cgstValue)} />
            <Row label="SGST / UTGST" value={formatCurrency(bill.sgstValue)} />
            <Row label="IGST" value={formatCurrency(bill.igstValue)} />
            <div className="flex justify-between py-2 mt-1 border-t">
              <span className="text-sm font-semibold">Total Invoice Value</span>
              <span className="text-sm font-bold text-primary">{formatCurrency(bill.totalInvValue)}</span>
            </div>
          </CardContent>
        </Card>

        {/* From */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase tracking-wide">From — Supplier / Consignor</CardTitle></CardHeader>
          <CardContent className="space-y-0">
            <Row label="GSTIN" value={bill.fromGstin} />
            <Row label="Trade Name" value={bill.fromTrdName} />
            <Row label="Address" value={bill.fromAddr1} />
            <Row label="City" value={bill.fromCity} />
            <Row label="State" value={stateName(bill.fromState)} />
            <Row label="Pincode" value={bill.fromPincode} />
          </CardContent>
        </Card>

        {/* To */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase tracking-wide">To — Recipient / Consignee</CardTitle></CardHeader>
          <CardContent className="space-y-0">
            <Row label="GSTIN" value={bill.toGstin} />
            <Row label="Trade Name" value={bill.toTrdName} />
            <Row label="Address" value={bill.toAddr1} />
            <Row label="City" value={bill.toCity} />
            <Row label="State" value={stateName(bill.toState)} />
            <Row label="Pincode" value={bill.toPincode} />
          </CardContent>
        </Card>
      </div>

      {/* Transport Details */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase tracking-wide">Transportation Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div><p className="text-xs text-muted-foreground">Mode</p><p className="font-semibold">{TRANS_MODE_LABEL[bill.transMode] ?? bill.transMode}</p></div>
          <div><p className="text-xs text-muted-foreground">Vehicle No.</p><p className="font-semibold font-mono">{bill.vehicleNo || "—"}</p></div>
          <div><p className="text-xs text-muted-foreground">Vehicle Type</p><p className="font-semibold">{bill.vehicleType === "O" ? "ODC" : "Regular"}</p></div>
          <div><p className="text-xs text-muted-foreground">Approx. Distance</p><p className="font-semibold">{bill.transDistance ? `${bill.transDistance} KM` : "—"}</p></div>
          {bill.transporterName && <div><p className="text-xs text-muted-foreground">Transporter</p><p className="font-semibold">{bill.transporterName}</p></div>}
          {bill.transporterId && <div><p className="text-xs text-muted-foreground">Transporter GSTIN</p><p className="font-mono text-xs font-semibold">{bill.transporterId}</p></div>}
          {bill.transDocNo && <div><p className="text-xs text-muted-foreground">LR / RR No.</p><p className="font-semibold">{bill.transDocNo}</p></div>}
          {bill.transDocDate && <div><p className="text-xs text-muted-foreground">LR / RR Date</p><p className="font-semibold">{bill.transDocDate}</p></div>}
        </CardContent>
      </Card>

      {/* Items */}
      {items.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground uppercase tracking-wide">Goods Details</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th className="text-left py-2.5 px-4 font-medium">#</th>
                    <th className="text-left py-2.5 px-4 font-medium">Description</th>
                    <th className="text-left py-2.5 px-3 font-medium">HSN / SAC</th>
                    <th className="text-right py-2.5 px-3 font-medium">Qty</th>
                    <th className="text-right py-2.5 px-3 font-medium">Rate</th>
                    <th className="text-right py-2.5 px-3 font-medium">GST %</th>
                    <th className="text-right py-2.5 px-4 font-medium">Taxable Value</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any, i: number) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-accent/30">
                      <td className="py-2 px-4 text-muted-foreground">{i + 1}</td>
                      <td className="py-2 px-4">{item.description}</td>
                      <td className="py-2 px-3 font-mono text-xs">{item.hsnCode ?? "—"}</td>
                      <td className="py-2 px-3 text-right">{item.quantity}</td>
                      <td className="py-2 px-3 text-right">{formatCurrency(item.unitPrice)}</td>
                      <td className="py-2 px-3 text-right">{item.gstRate ?? "—"}%</td>
                      <td className="py-2 px-4 text-right font-semibold">{formatCurrency(item.quantity * item.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Print Footer */}
      <div className="text-xs text-muted-foreground text-center pb-4 print:block hidden">
        Generated by GST Pro · E-Way Bill · {bill.docNo} · {new Date().toLocaleDateString("en-IN")}
      </div>
    </div>
  );
}
