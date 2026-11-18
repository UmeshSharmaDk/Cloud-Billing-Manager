import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const TYPES = ["CA or accounting firm", "Business with branches", "Single business", "Other"] as const;

/**
 * Public "Book a free demo" page, the call to action of the launch campaign.
 * It creates no account: there is no public sign-up.
 */
export default function DemoPage() {
  const [form, setForm] = useState({ name: "", phone: "", email: "", city: "", businessType: "", clientCount: "", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const reason = !form.name.trim() ? "Enter your name first"
    : form.phone.replace(/\D/g, "").length < 7 ? "Enter a phone number we can call"
    : !form.businessType ? "Choose what describes you" : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason) return;
    setBusy(true); setError("");
    const body = {
      name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), city: form.city.trim() || undefined,
      businessType: form.businessType, clientCount: form.clientCount ? Number(form.clientCount) : undefined,
      message: form.message.trim() || undefined, website: form.website || undefined,
    };
    try {
      const res = await fetch("/api/demo-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (res.ok) setDone(data?.message ?? "Thank you. We will call you soon.");
      else setError(data?.error ?? "Could not send your request. Please try again.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto grid w-full max-w-5xl gap-8 md:grid-cols-[1fr_1.1fr] md:items-start">
        <section className="space-y-5 pt-2">
          <img src="/logo.png" alt="Billing Pilot" width={900} height={303} className="h-14 w-auto rounded-xl bg-white px-3 py-2" />
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">One login, all your clients' books.</h1>
          <p className="text-muted-foreground">GST invoices, purchases, stock, e-way bills and GSTR-1, 3B and HSN reports for every client or branch, on the web and on Android.</p>
          <ul className="space-y-2 text-sm">
            <li>See every client's month on one screen: sales, purchases, GST due and money owed.</li>
            <li>Your team gets their own logins. You see their books, they never see each other's.</li>
            <li>UPI QR on every invoice and WhatsApp payment reminders.</li>
          </ul>
          <p className="text-sm text-muted-foreground">A 20-minute call on your own data. No card, no commitment.</p>
        </section>

        <Card className="border-border/50">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Book a free demo</CardTitle>
            <CardDescription>Leave your number and we will call you within one working day.</CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="space-y-4">
                <p role="status" className="rounded-lg border p-3 text-sm">{done}</p>
                <p className="text-center text-sm"><Link href="/login" className="inline-flex min-h-11 items-center text-muted-foreground hover:underline">Already a customer? Sign in</Link></p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2"><Label htmlFor="demo-name">Your name</Label><Input id="demo-name" autoComplete="name" value={form.name} onChange={set("name")} required maxLength={120} /></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="demo-phone">Phone (WhatsApp is fine)</Label><Input id="demo-phone" type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} required maxLength={20} /></div>
                  <div className="space-y-2"><Label htmlFor="demo-city">City</Label><Input id="demo-city" autoComplete="address-level2" value={form.city} onChange={set("city")} maxLength={80} /></div>
                </div>
                <div className="space-y-2"><Label htmlFor="demo-email">Email (optional)</Label><Input id="demo-email" type="email" autoComplete="email" value={form.email} onChange={set("email")} maxLength={320} /></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="demo-type">What describes you</Label>
                    <select id="demo-type" value={form.businessType} onChange={set("businessType")} required className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="">Choose one</option>
                      {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2"><Label htmlFor="demo-count">Clients or branches</Label><Input id="demo-count" type="number" inputMode="numeric" min={0} max={100000} value={form.clientCount} onChange={set("clientCount")} /></div>
                </div>
                <div className="space-y-2"><Label htmlFor="demo-message">Anything we should know (optional)</Label><Textarea id="demo-message" value={form.message} onChange={set("message")} maxLength={1000} rows={3} /></div>
                {/* Hidden from people and screen readers; form-filling bots complete it. */}
                <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                  <label htmlFor="demo-website">Website</label>
                  <input id="demo-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
                </div>
                {error && <p role="alert" className="text-sm text-danger">{error}</p>}
                <Button type="submit" className="w-full" loading={busy} disabledReason={reason}>Book my free demo</Button>
                <p className="text-center text-sm"><Link href="/login" className="inline-flex min-h-11 items-center text-muted-foreground hover:underline">Already a customer? Sign in</Link></p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
