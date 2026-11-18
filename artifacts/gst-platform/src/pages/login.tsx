import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLogin, useLoginMfa } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Link } from "wouter";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Set when the password was right and the account also needs a code.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { login } = useAuth();
  const { toast } = useToast();

  const mutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        if ("mfaRequired" in data) {
          setPassword("");
          setMfaToken(data.mfaToken);
          return;
        }
        login(data.user);
      },
      onError: () => {
        toast({ title: "Login failed", description: "Invalid email or password.", variant: "destructive" });
      },
    },
  });

  const mfaMutation = useLoginMfa({
    mutation: {
      onSuccess: (data) => login(data.user),
      onError: (err: any) => {
        setCode("");
        // The five-minute window ran out, or the account changed: start over.
        if (err?.status === 401 && /expired/i.test(err?.data?.error ?? "")) setMfaToken(null);
        toast({ title: "Sign-in failed", description: err?.data?.error ?? "That code is not valid.", variant: "destructive" });
      },
    },
  });

  const handleCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (mfaToken) mfaMutation.mutate({ data: { mfaToken, code: code.trim() } });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ data: { email, password } });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {/* The logo's dark lettering needs a white plate to stay readable in dark mode. */}
          <h1 className="inline-block rounded-2xl bg-white px-5 py-3 mb-3">
            <img src="/logo.png" alt="Billing Pilot" width={900} height={303} className="h-20 w-auto max-w-full object-contain" />
          </h1>
          <p className="text-muted-foreground mt-1">India's GST Billing & Inventory Platform</p>
        </div>

        <Card className="shadow-xl border-border/50">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Sign in to your account</CardTitle>
            <CardDescription>Enter your credentials to access the platform</CardDescription>
          </CardHeader>
          <CardContent>
            {mfaToken ? (
            <form onSubmit={handleCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mfa-code">Authenticator code</Label>
                <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus maxLength={32} />
                <p className="text-xs text-muted-foreground">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
              </div>
              <Button type="submit" className="w-full" loading={mfaMutation.isPending}>Verify code</Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => { setMfaToken(null); setCode(""); }}>Use a different account</Button>
            </form>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input id="email" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" loading={mutation.isPending}>Sign in</Button>
              <p className="text-center text-sm"><Link href="/forgot-password" className="inline-flex min-h-11 items-center text-muted-foreground hover:underline">Forgot your password?</Link></p>
            </form>
            )}
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-sm text-muted-foreground">New to Billing Pilot? <Link href="/demo" className="inline-flex min-h-11 items-center font-medium text-foreground hover:underline">Book a free demo</Link></p>
      </div>
    </div>
  );
}
