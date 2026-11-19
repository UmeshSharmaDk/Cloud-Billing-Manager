import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAcceptAdminInvitation } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BadgeCheck, CircleAlert, ShieldCheck, KeyRound, ArrowRight } from "lucide-react";

function getError(error: any) {
  return error?.data?.error ?? error?.data?.message ?? error?.message ?? "This invitation could not be accepted. Contact the person who invited you.";
}

/**
 * The emailed link carries the token in the URL fragment (`#token=...`), which browsers never send to a
 * server, so it stays out of host and CDN access logs. `?token=` is still accepted for links already sent.
 */
function readInvitationToken(): string | null {
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
  return fromHash || new URLSearchParams(window.location.search).get("token");
}

export default function AcceptAdminInvitePage() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState("");
  const [token] = useState(readInvitationToken);
  // Once held in state, take the token out of the address bar, history and history sync.
  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [token]);
  const accept = useAcceptAdminInvitation({
    mutation: {
      onSuccess: (response) => login(response.user),
      onError: (error) => setFormError(getError(error)),
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (password.length < 12) {
      setFormError("Choose a password with at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setFormError("The passwords do not match.");
      return;
    }
    if (!token) {
      setFormError("This invitation link is missing its one-time token. Please ask for a new invitation.");
      return;
    }
    accept.mutate({ data: { token, password } });
  };

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-accent px-4 py-12">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-36 -top-44 h-[34rem] w-[34rem] rounded-full border border-border" />
        <div className="absolute -left-16 -top-24 h-[25rem] w-[25rem] rounded-full border border-border" />
        <div className="absolute -bottom-48 -right-28 h-[32rem] w-[32rem] rounded-full border border-border" />
      </div>
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-muted shadow-[0_24px_70px_rgba(30,59,43,.12)] md:grid-cols-[.88fr_1.12fr]">
        <section className="relative flex min-h-60 flex-col justify-between overflow-hidden bg-brand-navy p-7 text-white md:min-h-[590px] md:p-9">
          <div className="absolute -right-24 top-28 h-64 w-64 rounded-full border border-white/10" />
          <div className="absolute right-6 top-44 h-44 w-44 rounded-full border border-white/10" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10"><ShieldCheck className="h-5 w-5 text-brand-cyan" /></div>
              <div><p className="text-sm font-semibold tracking-wide">Billing Pilot</p><p className="text-[10px] uppercase tracking-[.17em] text-white/60">Cloud billing</p></div>
            </div>
            <div className="mt-10 max-w-sm md:mt-24">
              <p className="text-[11px] font-semibold uppercase tracking-[.17em] text-brand-cyan">Administrator access</p>
              <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight md:text-[2.6rem]">Your workspace starts here.</h1>
              <p className="mt-4 max-w-xs text-sm leading-6 text-white/75">Set a secure password to activate your account and manage your own business workspace.</p>
            </div>
          </div>
          <div className="relative mt-8 flex items-center gap-2 border-t border-white/15 pt-5 text-xs text-white/70"><BadgeCheck className="h-4 w-4 text-brand-cyan" /> A secure, one-time invitation link</div>
        </section>

        <section className="flex items-center justify-center p-5 md:p-10">
          <Card className="w-full max-w-md border-0 bg-transparent shadow-none">
            <CardHeader className="px-0 pb-6">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-foreground"><KeyRound className="h-5 w-5" /></div>
              <CardTitle className="text-2xl font-semibold tracking-tight text-foreground">{token ? "Set your password" : "Invitation unavailable"}</CardTitle>
              <CardDescription className="mt-1 max-w-sm text-sm leading-6">{token ? "Choose a strong password to finish activating your administrator account." : "The link needs its invitation token. Open the complete link from your invitation email or request another invite."}</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {token ? (
                <form onSubmit={submit} className="space-y-5">
                  <div className="space-y-2"><Label htmlFor="invite-password">New password</Label><Input id="invite-password" data-testid="input-invite-password" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" required /><p className="text-xs leading-5 text-muted-foreground">Use 12 or more characters. Avoid passwords used for other services.</p></div>
                  <div className="space-y-2"><Label htmlFor="invite-password-confirm">Confirm password</Label><Input id="invite-password-confirm" data-testid="input-invite-password-confirm" type="password" minLength={12} maxLength={128} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></div>
                  {formError && <div role="alert" className="flex gap-2 rounded-lg border border-danger/30 bg-danger-bg p-3 text-sm text-danger-text"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{formError}</span></div>}
                  <Button type="submit" className="h-11 w-full gap-2 bg-primary font-semibold hover:bg-primary-hover" loading={accept.isPending} data-testid="button-accept-invitation">Activate administrator account <ArrowRight className="h-4 w-4" /></Button>
                  <p className="text-center text-xs leading-5 text-muted-foreground">By continuing, this one-time invite will be accepted and you will be signed in.</p>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning-bg p-3 text-sm text-warning-text"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>Invitation links are private. For your security, the token is never shown here.</span></div>
                  <Link href="/login" data-testid="link-invite-login" className="inline-flex h-10 w-full items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent">Go to sign in</Link>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}