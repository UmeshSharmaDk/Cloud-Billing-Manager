import { useState } from "react";
import { useLocation } from "wouter";
import { Shield, CircleX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVerifyRegistration } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";

/**
 * The second half of registration, and where the password is chosen.
 *
 * Signing up no longer creates the account — it cannot, because the response to
 * a signup has to look the same whether or not the address is already taken.
 * Opening the link from the email is what proves control of the mailbox, so this
 * is also where the person picks their password: one chosen earlier, by whoever
 * submitted the form, could be known to someone who does not own the address.
 */
export default function VerifyPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const token = new URLSearchParams(window.location.search).get("token");

  const mutation = useVerifyRegistration({
    mutation: {
      onSuccess: (data: any) => {
        login(data.user);
        setLocation("/dashboard");
      },
      onError: (err: any) =>
        setError(err?.data?.error ?? "That link could not be used. Please register again."),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    mutation.mutate({ data: { token: token ?? "", password } });
  };

  const header = (
    <div className="text-center mb-8">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary text-primary-foreground mb-4 shadow-lg">
        <Shield className="w-8 h-8" />
      </div>
      <h1 className="text-3xl font-bold text-foreground">GST Pro</h1>
    </div>
  );

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-primary/5 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {header}
          <Card className="shadow-xl border-border/50">
            <CardHeader className="pb-4 text-center">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mx-auto mb-3 bg-destructive/10 text-destructive">
                <CircleX className="w-7 h-7" />
              </div>
              <CardTitle className="text-xl">That link did not work</CardTitle>
              <CardDescription>
                That link is missing its token. Please use the link from the email exactly as sent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button className="w-full" onClick={() => setLocation("/register")}>
                Register again
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setLocation("/login")}>
                I already have an account
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {header}
        <Card className="shadow-xl border-border/50">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Choose a password</CardTitle>
            <CardDescription>
              Your email address is confirmed. Choose a password to finish creating your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  placeholder="At least 12 characters"
                  minLength={12}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  At least 12 characters, and not one that has appeared in a public breach.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Confirm password</Label>
                <Input
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={mutation.isPending}>
                {mutation.isPending ? "Creating account..." : "Create account"}
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground mt-4">
              Link not working?{" "}
              <button onClick={() => setLocation("/register")} className="text-primary hover:underline font-medium">
                Register again
              </button>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
