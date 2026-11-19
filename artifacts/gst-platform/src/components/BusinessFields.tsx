import { useEffect, useState } from "react";
import { authFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Building2 } from "lucide-react";
import { INDIAN_STATES } from "@/lib/states";

export type BusinessForm = Record<string, string>;

type Spec = { key: string; label: string; wide?: boolean; upper?: boolean; max?: number; placeholder?: string };
const FIELDS: Spec[] = [
  { key: "name", label: "Business name", wide: true, placeholder: "Defaults to the user's name" },
  { key: "gstin", label: "GSTIN", upper: true, max: 15, placeholder: "27AABCU9603R1ZX" },
  { key: "pan", label: "PAN", upper: true, max: 10 },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Business email" },
  { key: "address", label: "Address", wide: true },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pincode", label: "Pincode", max: 6 },
  { key: "bankName", label: "Bank name" },
  { key: "bankAccount", label: "Account number" },
  { key: "bankIfsc", label: "IFSC code", upper: true, max: 11 },
  { key: "bankBranch", label: "Branch" },
  { key: "upiId", label: "UPI ID (QR on invoices)", placeholder: "shop@okhdfcbank" },
  { key: "invoicePrefix", label: "Invoice prefix", upper: true, placeholder: "INV" },
  { key: "termsConditions", label: "Terms and conditions", wide: true },
];

/** Only what was filled in: an empty box must not overwrite or fail validation. */
export const cleanBusiness = (v: BusinessForm, keepEmpty = false) =>
  Object.fromEntries(Object.entries(v).filter(([, x]) => keepEmpty || x.trim() !== "").map(([k, x]) => [k, x.trim() === "" ? null : x.trim()]));

/** The business settings a user has under Settings, for an admin to fill in on their behalf. */
export function BusinessFields({ value, set }: { value: BusinessForm; set: (k: string, v: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {FIELDS.map((f) => (
        <div key={f.key} className={`space-y-1.5 ${f.wide ? "sm:col-span-2" : ""}`}>
          <Label htmlFor={`biz-${f.key}`}>{f.label}</Label>
          {f.key === "state" ? (
            <select id="biz-state" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={value.state ?? ""}
              onChange={(e) => { set("state", e.target.value); set("stateCode", INDIAN_STATES.find((s) => s.name === e.target.value)?.code ?? ""); }}>
              <option value="">Select state</option>
              {INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
            </select>
          ) : (
            <Input id={`biz-${f.key}`} value={value[f.key] ?? ""} maxLength={f.max} placeholder={f.placeholder}
              onChange={(e) => set(f.key, f.upper ? e.target.value.toUpperCase() : e.target.value)} />
          )}
        </div>
      ))}
    </div>
  );
}

/** An admin edits one of their users' business settings. */
export function BusinessEditor({ userId, business, onSaved }: { userId: number; business: Record<string, any>; onSaved: () => void }) {
  const [form, setForm] = useState<BusinessForm>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  useEffect(() => {
    setForm(Object.fromEntries([...FIELDS.map((f) => f.key), "stateCode"].map((k) => [k, business[k] ?? ""])));
  }, [business]);

  const save = async () => {
    if (!form.name?.trim()) { toast({ title: "Business name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await authFetch(`/api/admin/users/${userId}/business`, { method: "PATCH", body: JSON.stringify(cleanBusiness(form, true)) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not save.");
      toast({ title: "Business details saved" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Not saved", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" /> Business details</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <BusinessFields value={form} set={(k, v) => setForm((p) => ({ ...p, [k]: v }))} />
        <Button onClick={save} loading={saving}>Save business details</Button>
      </CardContent>
    </Card>
  );
}
