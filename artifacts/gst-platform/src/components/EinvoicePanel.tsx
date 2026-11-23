import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileJson, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authFetch } from "@/lib/api-fetch";
import { downloadFromApi } from "@/lib/download";
import { useToast } from "@/hooks/use-toast";

const ELIGIBLE = /^\s*(tax invoice|credit note|debit note)/i;

/**
 * E-invoice for one invoice: download the IRP upload file, then save the IRN,
 * acknowledgement and signed QR the IRP gives back. They print on the invoice.
 */
export function EinvoicePanel({ inv, onChange }: { inv: any; onChange: () => void }) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ irn: "", ackNo: "", ackDate: "", signedQr: "" });
  const irp = useQuery({ queryKey: ["irp-login"], queryFn: () => authFetch("/api/business/irp").then((r) => r.json()) }).data;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancel, setCancel] = useState({ reason: "2", remark: "" });

  if (inv.status === "cancelled" || !ELIGIBLE.test(inv.type || "Tax Invoice")) return null;
  if (!inv.customerGstin && !inv.irn) {
    return <p className="text-xs text-muted-foreground border-t pt-2">E-invoice: not needed, the customer has no GSTIN.</p>;
  }

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadFromApi(`/api/invoices/${inv.id}/einvoice-json`, `EINV_${inv.invoiceNumber}.json`);
      toast({ title: "E-invoice file saved", description: "Upload it at einvoice1.gst.gov.in, then add the IRN here." });
    } catch (err: any) {
      toast({ title: "E-invoice file not made", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  const save = async (body: unknown, done: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/invoices/${inv.id}/irn`, { method: "PUT", body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save.");
      toast({ title: done });
      setOpen(false);
      onChange();
    } catch (err: any) {
      toast({ title: "Not saved", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Through the IRP API: the IRP signs the invoice and returns the IRN.
  const viaIrp = async (path: string, body: unknown, done: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/invoices/${inv.id}/irn/${path}`, { method: "POST", body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The e-invoice system did not answer.");
      toast({ title: done });
      setCancelOpen(false);
      onChange();
    } catch (err: any) {
      toast({ title: "Not done", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value })),
  });

  return (
    <div className="border-t pt-2 space-y-2">
      {inv.irn ? (
        <>
          <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400"><ShieldCheck className="w-4 h-4" /> E-invoice registered</p>
          <p className="text-xs font-mono break-all text-muted-foreground">IRN {inv.irn}</p>
          <p className="text-xs text-muted-foreground">Ack {inv.irnAckNo} · {inv.irnAckDate}</p>
          {irp?.configured ? (
            <Button variant="outline" size="sm" className="w-full" onClick={() => { setCancel({ reason: "2", remark: "" }); setCancelOpen(true); }}>
              Cancel IRN
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="w-full" loading={saving}
              onClick={() => save({ irn: null }, "IRN cleared. The invoice can be edited again.")}>
              Clear IRN after cancelling on the IRP
            </Button>
          )}
        </>
      ) : (
        <>
          {irp?.configured && (
            <Button variant="outline" size="sm" className="w-full gap-1" loading={saving}
              onClick={() => viaIrp("generate", {}, irp.sandbox ? "Test IRN generated on the NIC sandbox" : "IRN generated")}>
              <ShieldCheck className="w-4 h-4" /> Generate IRN
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{irp?.configured ? "Or by hand: download the file, upload it on the IRP, then paste the IRN." : "E-invoice: download the file, upload it on the IRP, then paste the IRN it gives you. To generate it from here, add the e-invoice login in Settings."}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={download} loading={downloading}>
              <FileJson className="w-4 h-4" /> E-invoice file
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setForm({ irn: "", ackNo: "", ackDate: "", signedQr: "" }); setOpen(true); }}>
              Add IRN
            </Button>
          </div>
        </>
      )}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="no-print sm:max-w-md">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); viaIrp("cancel", cancel, "IRN cancelled. The invoice can be edited again."); }}>
            <DialogHeader>
              <DialogTitle>Cancel the IRN for {inv.invoiceNumber}?</DialogTitle>
              <DialogDescription>The IRP allows this within 24 hours of the IRN. Its e-way bill, if any, must be cancelled first.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={cancel.reason} onValueChange={(v) => setCancel((c) => ({ ...c, reason: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Duplicate</SelectItem>
                  <SelectItem value="2">Data entry mistake</SelectItem>
                  <SelectItem value="3">Order cancelled</SelectItem>
                  <SelectItem value="4">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cnl-rem">Remark</Label>
              <Input id="cnl-rem" maxLength={100} required value={cancel.remark} onChange={(e) => setCancel((c) => ({ ...c, remark: e.target.value }))} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setCancelOpen(false)}>Keep IRN</Button>
              <Button type="submit" loading={saving}>Cancel IRN</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="no-print sm:max-w-lg">
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(form, "IRN saved. It now prints on the invoice."); }}>
            <DialogHeader>
              <DialogTitle>Add IRN for {inv.invoiceNumber}</DialogTitle>
              <DialogDescription>Copy these from the IRP after your upload. Once saved, the invoice's figures are locked.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="irn">IRN (64 characters)</Label>
              <Input id="irn" className="font-mono text-xs" required minLength={64} maxLength={64} autoFocus {...field("irn")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ack-no">Ack No.</Label>
                <Input id="ack-no" inputMode="numeric" required {...field("ackNo")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ack-date">Ack date</Label>
                <Input id="ack-date" placeholder="2026-11-22 14:05" required {...field("ackDate")} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signed-qr">Signed QR code text (optional, prints the e-invoice QR)</Label>
              <Textarea id="signed-qr" rows={3} className="font-mono text-xs" {...field("signedQr")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" loading={saving}>Save IRN</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
