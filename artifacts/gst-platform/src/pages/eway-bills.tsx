import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Search, Truck, FileText, Eye } from "lucide-react";
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

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-700" },
  generated: { label: "Generated", className: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-600" },
};

const TRANS_MODE: Record<string, string> = {
  "1": "Road", "2": "Rail", "3": "Air", "4": "Ship",
};

const DOC_TYPE: Record<string, string> = {
  INV: "Tax Invoice", BIL: "Bill of Supply", BOE: "Bill of Entry",
  CHL: "Delivery Challan", OTH: "Other",
};

export default function EwayBillsPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["eway-bills"],
    queryFn: () => authFetch("/api/eway-bills").then(r => r.json()),
  });

  const bills: any[] = (data?.bills ?? []).filter((b: any) => {
    const q = search.toLowerCase();
    return !q || b.docNo?.toLowerCase().includes(q) || b.toTrdName?.toLowerCase().includes(q)
      || b.ewbNo?.toLowerCase().includes(q) || b.vehicleNo?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">E-Way Bills</h1>
          <p className="text-muted-foreground text-sm">Generate and manage E-Way Bills for goods movement</p>
        </div>
        <Link href="/eway-bills/new">
          <Button className="gap-2"><Plus className="w-4 h-4" /> New E-Way Bill</Button>
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {["draft", "generated", "cancelled", "all"].map((s) => {
          const count = s === "all" ? bills.length : (data?.bills ?? []).filter((b: any) => b.status === s).length;
          const label = s === "all" ? "Total" : STATUS_LABELS[s]?.label ?? s;
          return (
            <Card key={s}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground font-medium capitalize">{label}</p>
                <p className="text-2xl font-bold mt-1">{count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search by document #, EWB No, party..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3 animate-pulse">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl" />)}</div>
      ) : bills.length === 0 ? (
        <Card>
          <CardContent className="p-12 flex flex-col items-center gap-3 text-center">
            <Truck className="w-12 h-12 text-muted-foreground/40" />
            <div>
              <p className="font-semibold text-muted-foreground">No E-Way Bills yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create your first E-Way Bill for goods movement above ₹50,000</p>
            </div>
            <Link href="/eway-bills/new"><Button variant="outline" className="mt-2 gap-2"><Plus className="w-4 h-4" /> Create E-Way Bill</Button></Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
                    <th className="text-left py-3 px-4 font-semibold">EWB No. / Doc No.</th>
                    <th className="text-left py-3 px-4 font-semibold">Recipient</th>
                    <th className="text-left py-3 px-4 font-semibold">Type</th>
                    <th className="text-left py-3 px-3 font-semibold">Mode</th>
                    <th className="text-left py-3 px-3 font-semibold">Vehicle No.</th>
                    <th className="text-right py-3 px-4 font-semibold">Invoice Value</th>
                    <th className="text-left py-3 px-4 font-semibold">Valid Upto</th>
                    <th className="text-center py-3 px-4 font-semibold">Status</th>
                    <th className="py-3 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill: any) => {
                    const st = STATUS_LABELS[bill.status] ?? STATUS_LABELS.draft;
                    return (
                      <tr key={bill.id} className="border-b last:border-0 hover:bg-accent/40">
                        <td className="py-3 px-4">
                          {bill.ewbNo ? (
                            <span className="font-mono text-xs font-semibold text-primary block">{bill.ewbNo}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground block">Not generated</span>
                          )}
                          <span className="font-mono text-xs text-muted-foreground">{bill.docNo}</span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium">{bill.toTrdName || "—"}</div>
                          <div className="text-xs text-muted-foreground">{bill.toGstin || bill.toCity || ""}</div>
                        </td>
                        <td className="py-3 px-4 text-xs">{DOC_TYPE[bill.docType] || bill.docType}</td>
                        <td className="py-3 px-3 text-xs">{TRANS_MODE[bill.transMode] || bill.transMode}</td>
                        <td className="py-3 px-3 font-mono text-xs">{bill.vehicleNo || "—"}</td>
                        <td className="py-3 px-4 text-right font-semibold">{formatCurrency(bill.totalInvValue)}</td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">{bill.validUpto || "—"}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${st.className}`}>{st.label}</span>
                        </td>
                        <td className="py-3 px-4">
                          <Link href={`/eway-bills/${bill.id}`}>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><Eye className="w-4 h-4" /></Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
