import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateVendor } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

const INDIAN_STATES = [
  { code: "07", name: "Delhi" }, { code: "06", name: "Haryana" }, { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" }, { code: "19", name: "West Bengal" }, { code: "24", name: "Gujarat" },
  { code: "27", name: "Maharashtra" }, { code: "29", name: "Karnataka" }, { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" }, { code: "36", name: "Telangana" }, { code: "03", name: "Punjab" },
  { code: "08", name: "Rajasthan" }, { code: "23", name: "Madhya Pradesh" }, { code: "30", name: "Goa" },
];

export default function VendorNewPage() {
  const [, setLocation] = useLocation();
  const mutation = useCreateVendor();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", gstin: "", pan: "", phone: "", email: "", address: "", city: "", state: "", stateCode: "", pincode: "", paymentTerms: "" });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ data: form as any }, {
      onSuccess: () => { toast({ title: "Vendor added!" }); setLocation("/vendors"); },
      onError: () => toast({ title: "Failed to add vendor", variant: "destructive" }),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="icon" onClick={() => setLocation("/vendors")}><ArrowLeft className="w-4 h-4" /></Button>
        <div><h1 className="text-2xl font-bold">Add Vendor</h1><p className="text-muted-foreground text-sm">Add a new supplier to your account</p></div>
      </div>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Vendor Information</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 space-y-2"><Label>Business Name *</Label><Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Raw Materials Inc" required /></div>
          <div className="space-y-2"><Label>GSTIN</Label><Input value={form.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} placeholder="27AABCR4567M1Z1" maxLength={15} className="font-mono" /></div>
          <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="9123456780" /></div>
          <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div className="space-y-2"><Label>City</Label><Input value={form.city} onChange={(e) => set("city", e.target.value)} /></div>
          <div className="sm:col-span-2 space-y-2"><Label>Address</Label><Input value={form.address} onChange={(e) => set("address", e.target.value)} /></div>
          <div className="space-y-2">
            <Label>State</Label>
            <select className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={form.state} onChange={(e) => { const st = INDIAN_STATES.find(s => s.name === e.target.value); set("state", e.target.value); if (st) set("stateCode", st.code); }}>
              <option value="">Select State</option>
              {INDIAN_STATES.map(s => <option key={s.code} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div className="space-y-2"><Label>Pincode</Label><Input value={form.pincode} onChange={(e) => set("pincode", e.target.value)} maxLength={6} /></div>
          <div className="space-y-2"><Label>Payment Terms</Label><Input value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="Net 30" /></div>
          <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setLocation("/vendors")}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving..." : "Add Vendor"}</Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
