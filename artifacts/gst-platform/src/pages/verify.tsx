import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Shield, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useVerifyRegistration } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";

/**
 * The second half of registration.
 *
 * Signing up no longer creates the account — it cannot, because the response to
 * a signup has to look the same whether or not the address is already taken.
 * Opening the link from the email is what proves control of the mailbox, and
 * that is where the account is created and the person signed in.
 */
export default function VerifyPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // React 18 mounts effects twice in development. The token is single-use, so
  // firing twice would spend it and then report the replay as a failure.
  const attempted = useRef(false);

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

  const { mutate } = mutation;

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("That link is missing its token. Please use the link from the email exactly as sent.");
      return;
    }
    mutate({ data: { token } });
  }, [mutate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary text-primary-foreground mb-4 shadow-lg">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">GST Pro</h1>
        </div>

        <Card className="shadow-xl border-border/50">
          <CardHeader className="pb-4 text-center">
            <div
              className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl mx-auto mb-3 ${
                error ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
              }`}
            >
              {error ? (
                <CircleX className="w-7 h-7" />
              ) : mutation.isSuccess ? (
                <CircleCheck className="w-7 h-7" />
              ) : (
                <LoaderCircle className="w-7 h-7 animate-spin" />
              )}
            </div>
            <CardTitle className="text-xl">
              {error ? "That link did not work" : mutation.isSuccess ? "You're all set" : "Confirming your account"}
            </CardTitle>
            <CardDescription>
              {error ?? "This only takes a moment."}
            </CardDescription>
          </CardHeader>
          {error && (
            <CardContent className="space-y-2">
              <Button className="w-full" onClick={() => setLocation("/register")}>
                Register again
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setLocation("/login")}>
                I already have an account
              </Button>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
