import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";

const EMPTY = { baseUrl: "", clientId: "", clientSecret: "", username: "", password: "", publicKey: "" };

/** The e-invoice system (IRP) API login, so IRNs and e-way bills are made from here. */
export function IrpLoginCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["irp-login"], queryFn: () => authFetch("/api/business/irp").then((r) => r.json()) });
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const field = (k: keyof typeof EMPTY) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
  });
  const send = async (method: "PUT" | "DELETE") => {
    if (saving) return;
    setSaving(true);
    try {
      const body = method === "PUT" ? JSON.stringify({ ...form, baseUrl: form.baseUrl.trim() || undefined }) : undefined;
      const res = await authFetch("/api/business/irp", { method, body });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Not saved.");
      toast({ title: method === "PUT" ? "Logged in to the e-invoice system. Login saved." : "E-invoice login removed" });
      setForm(EMPTY);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["irp-login"] });
    } catch (err: any) {
      toast({ title: "Not saved", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const missing = !form.clientId || !form.clientSecret || !form.username || !form.password || !form.publicKey
    ? "Fill in all five fields from your NIC registration first." : undefined;

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">E-invoice API login</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {data?.configured && !editing ? (
          <>
            <p className="text-sm">
              Connected to the {data.sandbox ? "NIC sandbox (test IRNs only)" : "e-invoice system"} as <span className="font-mono">{data.username}</span> for GSTIN <span className="font-mono">{data.gstin}</span>.
              Invoices and e-way bills can now be generated from their pages.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(true)}>Change login</Button>
              <Button variant="ghost" loading={saving} onClick={() => send("DELETE")}>Remove login</Button>
            </div>
          </>
        ) : (
          <form className="grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); if (!missing) send("PUT"); }}>
            <p className="sm:col-span-2 text-sm text-muted-foreground">
              Register for API access at einvoice1.gst.gov.in (or the sandbox at einvoice1-trial.nic.in) with your GSTIN. NIC gives you the five values below.
              The password and client secret are stored encrypted.
            </p>
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="irp-url">API address</Label>
              <Input id="irp-url" placeholder={data?.sandboxUrl ?? "https://einv-apisandbox.nic.in"} {...field("baseUrl")} />
              <p className="text-xs text-muted-foreground">Leave empty for the free NIC sandbox. For live IRNs, enter the production address NIC gave you.</p>
            </div>
            <div className="space-y-2"><Label htmlFor="irp-cid">Client ID</Label><Input id="irp-cid" autoComplete="off" {...field("clientId")} /></div>
            <div className="space-y-2"><Label htmlFor="irp-csec">Client secret</Label><Input id="irp-csec" type="password" autoComplete="off" {...field("clientSecret")} /></div>
            <div className="space-y-2"><Label htmlFor="irp-user">API username</Label><Input id="irp-user" autoComplete="off" {...field("username")} /></div>
            <div className="space-y-2"><Label htmlFor="irp-pass">API password</Label><Input id="irp-pass" type="password" autoComplete="new-password" {...field("password")} /></div>
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="irp-key">Public key</Label>
              <Textarea id="irp-key" rows={4} className="font-mono text-xs" placeholder="Paste the public key file's contents" {...field("publicKey")} />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <Button type="submit" variant="outline" loading={saving} disabledReason={missing}>Save and test login</Button>
              {editing && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
