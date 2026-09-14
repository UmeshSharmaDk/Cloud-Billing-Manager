import { useState, useEffect } from "react";
import { useChangePassword, useGetBusiness, useLogoutAll, useUpdateBusiness } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Building2, CreditCard, FileText, Save, KeyRound } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const INDIAN_STATES = [
  { code: "01", name: "Jammu & Kashmir" }, { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" }, { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" }, { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" }, { code: "10", name: "Bihar" },
  { code: "19", name: "West Bengal" }, { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" }, { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" }, { code: "24", name: "Gujarat" },
  { code: "27", name: "Maharashtra" }, { code: "28", name: "Andhra Pradesh" },
  { code: "29", name: "Karnataka" }, { code: "30", name: "Goa" },
  { code: "32", name: "Kerala" }, { code: "33", name: "Tamil Nadu" },
  { code: "36", name: "Telangana" },
];

export default function SettingsPage() {
  const { data: biz, isLoading } = useGetBusiness();
  const mutation = useUpdateBusiness();
  const { toast } = useToast();
  const [form, setForm] = useState<any>({});

  useEffect(() => { if (biz) setForm(biz as any); }, [biz]);
  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleSave = () => {
    mutation.mutate({ data: form }, {
      onSuccess: () => toast({ title: "Settings saved!", description: "Business profile updated." }),
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    });
  };

  if (isLoading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-10 bg-muted rounded w-48" />
      <div className="h-64 bg-muted rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Business Settings</h1>
        <p className="text-muted-foreground text-sm">Configure your business profile, GST details, and invoice settings</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="grid grid-cols-4 w-full max-w-xl">
          <TabsTrigger value="profile"><Building2 className="w-4 h-4 mr-1.5" />Profile</TabsTrigger>
          <TabsTrigger value="bank"><CreditCard className="w-4 h-4 mr-1.5" />Bank</TabsTrigger>
          <TabsTrigger value="invoice"><FileText className="w-4 h-4 mr-1.5" />Invoice</TabsTrigger>
          <TabsTrigger value="security"><KeyRound className="w-4 h-4 mr-1.5" />Security</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Business Profile</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-2"><Label>Business Name *</Label><Input value={form.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="Acme India Pvt Ltd" /></div>
              <div className="space-y-2"><Label>GSTIN</Label><Input value={form.gstin || ""} onChange={(e) => set("gstin", e.target.value.toUpperCase())} placeholder="27AABCU9603R1ZX" maxLength={15} className="font-mono" /></div>
              <div className="space-y-2"><Label>PAN</Label><Input value={form.pan || ""} onChange={(e) => set("pan", e.target.value.toUpperCase())} placeholder="AABCU9603R" maxLength={10} className="font-mono" /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} placeholder="9876543210" /></div>
              <div className="space-y-2"><Label>Email</Label><Input type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} placeholder="info@company.com" /></div>
              <div className="sm:col-span-2 space-y-2"><Label>Address</Label><Input value={form.address || ""} onChange={(e) => set("address", e.target.value)} placeholder="123, MG Road" /></div>
              <div className="space-y-2"><Label>City</Label><Input value={form.city || ""} onChange={(e) => set("city", e.target.value)} placeholder="Mumbai" /></div>
              <div className="space-y-2">
                <Label>State</Label>
                <select className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={form.state || ""} onChange={(e) => { const st = INDIAN_STATES.find(s => s.name === e.target.value); set("state", e.target.value); if (st) set("stateCode", st.code); }}>
                  <option value="">Select State</option>
                  {INDIAN_STATES.map(s => <option key={s.code} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-2"><Label>State Code</Label><Input value={form.stateCode || ""} readOnly className="bg-muted" /></div>
              <div className="space-y-2"><Label>Pincode</Label><Input value={form.pincode || ""} onChange={(e) => set("pincode", e.target.value)} placeholder="400058" maxLength={6} /></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bank" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Bank Account Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-2"><Label>Bank Name</Label><Input value={form.bankName || ""} onChange={(e) => set("bankName", e.target.value)} placeholder="HDFC Bank" /></div>
              <div className="space-y-2"><Label>Account Number</Label><Input value={form.bankAccount || ""} onChange={(e) => set("bankAccount", e.target.value)} className="font-mono" /></div>
              <div className="space-y-2"><Label>IFSC Code</Label><Input value={form.bankIfsc || ""} onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())} maxLength={11} className="font-mono" /></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoice" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Invoice Settings</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Invoice Prefix</Label>
                <Input value={form.invoicePrefix || ""} onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())} placeholder="INV" maxLength={10} />
                <p className="text-xs text-muted-foreground">e.g. INV → INV-2024-001</p>
              </div>
              <div className="sm:col-span-2 space-y-2">
                <Label>Terms & Conditions</Label>
                <Textarea value={form.termsConditions || ""} onChange={(e) => set("termsConditions", e.target.value)} rows={4} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4 space-y-4">
          <ChangePasswordCard />
          <SignOutEverywhereCard />
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={mutation.isPending} className="gap-2 min-w-[140px]">
          <Save className="w-4 h-4" />
          {mutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Changing your own password. Until now the only route to a new password was
 * asking an administrator to reset it — which meant a third party chose it and
 * knew what it was.
 */
function ChangePasswordCard() {
  const { toast } = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const mutation = useChangePassword();

  const tooShort = form.newPassword.length > 0 && form.newPassword.length < 12;
  const mismatch = form.confirm.length > 0 && form.newPassword !== form.confirm;
  const canSubmit =
    form.currentPassword.length > 0 && form.newPassword.length >= 12 && !mismatch;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(
      { data: { currentPassword: form.currentPassword, newPassword: form.newPassword } },
      {
        onSuccess: () => {
          toast({ title: "Password changed" });
          setForm({ currentPassword: "", newPassword: "", confirm: "" });
        },
        onError: (err: any) =>
          toast({
            title: "Could not change password",
            // The server explains exactly why — too short, too common, or
            // found in a breach corpus. Repeat it rather than inventing one.
            description: err?.data?.error ?? "Please try again.",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Change password</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input id="current-password" type="password" autoComplete="current-password"
              value={form.currentPassword}
              onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" autoComplete="new-password" minLength={12}
              value={form.newPassword}
              onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} />
            <p className={`text-xs ${tooShort ? "text-destructive" : "text-muted-foreground"}`}>
              At least 12 characters. A short phrase of a few words is easier to remember and harder
              to guess than a short jumble.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">Confirm new password</Label>
            <Input id="confirm-new-password" type="password" autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
            {mismatch && <p className="text-xs text-destructive">These do not match.</p>}
          </div>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? "Changing..." : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Revoking every session. Ordinary sign-out ends only this device's session;
 * this one invalidates them all, which is what you want after losing a device.
 */
function SignOutEverywhereCard() {
  const { toast } = useToast();
  const mutation = useLogoutAll();

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Sign out everywhere</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground max-w-prose">
          Ends every session on every device, including this one. Use it if a phone or laptop goes
          missing, or if you think someone else has your password. You will need to sign in again.
        </p>
        <Button
          variant="destructive"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate(undefined as never, {
              onSuccess: () => {
                toast({ title: "Signed out everywhere" });
                window.location.href = "/login";
              },
              onError: () =>
                toast({ title: "Could not sign out everywhere", variant: "destructive" }),
            })
          }
        >
          {mutation.isPending ? "Signing out..." : "Sign out on all devices"}
        </Button>
      </CardContent>
    </Card>
  );
}
