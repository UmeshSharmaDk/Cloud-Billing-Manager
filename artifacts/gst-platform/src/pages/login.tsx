import { useState } from "react";
import { useLocation } from "wouter";
import { Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLogin, useLoginMfa } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Set when the password was right and the account also needs a code.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { login } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

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
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary text-primary-foreground mb-4 shadow-lg">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">Billing Pilot</h1>
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
              <Button type="submit" className="w-full" disabled={mfaMutation.isPending}>
                {mfaMutation.isPending ? "Checking..." : "Verify"}
              </Button>
              <button type="button" onClick={() => { setMfaToken(null); setCode(""); }} className="w-full text-center text-sm text-muted-foreground hover:underline">Use a different account</button>
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
              <Button type="submit" className="w-full" disabled={mutation.isPending}>
                {mutation.isPending ? "Signing in..." : "Sign In"}
              </Button>
            </form>
            )}

            <p className="text-center text-sm text-muted-foreground mt-6">
              New business?{" "}
              <button onClick={() => setLocation("/register")} className="text-primary hover:underline font-medium">Register here</button>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
