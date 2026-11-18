import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

async function post(path: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  const res = await fetch(`/api${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => null) };
}

function Frame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {children}
          <p className="text-center text-sm"><Link href="/login" className="inline-flex min-h-11 items-center text-muted-foreground hover:underline">Back to sign in</Link></p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Ask for a reset link. The answer never says whether the address has an account. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const r = await post("/auth/forgot-password", { email: email.trim() }).catch(() => ({ ok: false, data: null }));
    setBusy(false);
    if (r.ok) setMessage(r.data?.message ?? "Check your email for a reset link.");
    else setError(r.data?.error ?? "Could not send the link. Try again in a few minutes.");
  };

  return (
    <Frame title="Reset your password" description="Enter the email your admin set up for you. We will send a link to choose a new password.">
      {message ? <p role="status" className="rounded-lg border p-3 text-sm">{message}</p> : (
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reset-email">Email address</Label>
            <Input id="reset-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" loading={busy} disabledReason={email.trim() ? undefined : "Enter your email first"}>Email me a reset link</Button>
        </form>
      )}
    </Frame>
  );
}

/** The emailed link carries the token in the fragment, which is never sent to a server. */
export function ResetPasswordPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token"));
  useEffect(() => { if (token) window.history.replaceState(window.history.state, "", window.location.pathname); }, [token]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const reason = !token ? "This link is incomplete. Open the full link from the email."
    : password.length < 12 ? "Use at least 12 characters"
    : password !== confirm ? "The two passwords do not match yet" : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason || !token) return;
    setBusy(true); setError("");
    const r = await post("/auth/reset-password", { token, password }).catch(() => ({ ok: false, data: null }));
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(r.data?.error ?? "Could not reset the password. Ask for a new link.");
  };

  if (done) {
    return (
      <Frame title="Password changed" description="You have been signed out everywhere. Sign in with your new password.">
        <Button asChild className="w-full"><Link href="/login">Sign in</Link></Button>
      </Frame>
    );
  }
  return (
    <Frame title="Choose a new password" description="Resetting signs you out on every device.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input id="confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {error && <p className="text-sm"><Link href="/forgot-password" className="inline-flex min-h-11 items-center hover:underline">Ask for a new link</Link></p>}
        <Button type="submit" className="w-full" loading={busy} disabledReason={reason}>Set new password</Button>
      </form>
    </Frame>
  );
}
