import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Copy } from "lucide-react";
import {
  getGetMeQueryKey,
  useSetupMfa,
  useEnableMfa,
  useRegenerateMfaRecoveryCodes,
  type MfaSetupResponse,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/context/AuthContext";

const errorMessage = (error: any) =>
  error?.data?.error ?? "That did not work. Try again.";

/**
 * Two-factor authentication for administrators.
 *
 * An administrator without it lands here: the admin routes refuse to answer
 * until it is on. Once it is on, this page is where recovery codes are replaced.
 */
export default function SecurityPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  const setupMfa = useSetupMfa();
  const enableMfa = useEnableMfa();
  const regenerate = useRegenerateMfaRecoveryCodes();

  if (!user) return null;
  const home = user.role === "superadmin" ? "/superadmin" : "/admin";

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setupMfa.mutate({ data: { confirmPassword: password } }, {
      onSuccess: (data) => { setSetup(data); setPassword(""); },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  const confirm = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    enableMfa.mutate({ data: { code: code.trim() } }, {
      onSuccess: (data) => { setRecoveryCodes(data.recoveryCodes); setSetup(null); setCode(""); },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  const replaceCodes = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    regenerate.mutate({ data: { code: code.trim() } }, {
      onSuccess: (data) => { setRecoveryCodes(data.recoveryCodes); setCode(""); },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  const finish = async () => {
    // Enabling MFA re-issued the session cookie; reload who we are from it.
    await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    setRecoveryCodes(null);
    setLocation(home);
  };

  const errorLine = error && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Two-factor authentication</h1>
        <p className="text-muted-foreground mt-1">
          A code from an authenticator app on your phone is needed each time you sign in, as well as your password.
        </p>
      </div>

      {recoveryCodes ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="w-5 h-5" /> Save your recovery codes</CardTitle>
            <CardDescription>
              Each code works once, in place of an authenticator code. Keep them somewhere safe, away from your phone.
              They will not be shown again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-4 font-mono text-sm" data-testid="list-recovery-codes">
              {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
            </ul>
            <div className="flex gap-2">
              <Button variant="outline" className="gap-1.5" onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n"))}>
                <Copy className="w-4 h-4" /> Copy
              </Button>
              <Button onClick={() => void finish()} data-testid="button-recovery-saved">I have saved them</Button>
            </div>
          </CardContent>
        </Card>
      ) : user.mfaEnabled ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-success" /> Two-factor authentication is on</CardTitle>
            <CardDescription>
              Lost your recovery codes, or used most of them? Enter a code from your authenticator to get a new set. The old ones stop working.
              If you have lost your phone as well, ask a superadmin to reset two-factor authentication for you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={replaceCodes} className="space-y-3">
              <Label htmlFor="regen-code">Authenticator code</Label>
              <Input id="regen-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" required />
              {errorLine}
              <Button type="submit" loading={regenerate.isPending}>Replace recovery codes</Button>
            </form>
          </CardContent>
        </Card>
      ) : setup ? (
        <Card>
          <CardHeader>
            <CardTitle>Scan this with your authenticator app</CardTitle>
            <CardDescription>Google Authenticator, Microsoft Authenticator, 1Password and most others work.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <img src={setup.qrCodeDataUrl} alt="QR code for your authenticator app" width={240} height={240} className="mx-auto rounded-lg border" />
            <p className="text-sm text-muted-foreground">
              Can't scan it? Enter this key instead: <code className="break-all font-mono text-foreground" data-testid="text-mfa-secret">{setup.secret}</code>
            </p>
            <form onSubmit={confirm} className="space-y-3">
              <Label htmlFor="enable-code">Code shown in the app</Label>
              <Input id="enable-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" required autoFocus />
              {errorLine}
              <Button type="submit" loading={enableMfa.isPending}>Turn on</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Set it up to continue</CardTitle>
            <CardDescription>The admin panel needs two-factor authentication. Confirm your password to begin.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={start} className="space-y-3">
              <Label htmlFor="mfa-password">Your password</Label>
              <Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
              {errorLine}
              <Button type="submit" loading={setupMfa.isPending}>Start setup</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
