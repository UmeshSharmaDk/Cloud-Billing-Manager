import { useState } from "react";
import { useLocation } from "wouter";
import { Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRegister } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "", businessName: "", gstin: "" });
  const { login } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const mutation = useRegister({
    mutation: {
      onSuccess: (data: any) => {
        login(data.user);
        toast({ title: "Welcome!", description: "Your account has been created." });
      },
      onError: (err: any) => {
        toast({ title: "Registration failed", description: err?.data?.error || "Please try again.", variant: "destructive" });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ data: form });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-primary/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary text-primary-foreground mb-4 shadow-lg">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-foreground">GST Pro</h1>
          <p className="text-muted-foreground mt-1">Start your free trial today</p>
        </div>

        <Card className="shadow-xl border-border/50">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Create an account</CardTitle>
            <CardDescription>Set up your business on GST Pro</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Your Full Name</Label>
                <Input placeholder="Rahul Sharma" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label>Email address</Label>
                <Input type="email" placeholder="you@company.com" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" placeholder="At least 12 characters" minLength={12} value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} required />
                <p className="text-xs text-muted-foreground">At least 12 characters, and not one that has appeared in a public breach.</p>
              </div>
              <div className="space-y-2">
                <Label>Business Name</Label>
                <Input placeholder="Acme India Pvt Ltd" value={form.businessName} onChange={(e) => setForm(f => ({ ...f, businessName: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <Label>GSTIN <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input placeholder="27AABCU9603R1ZX" value={form.gstin} onChange={(e) => setForm(f => ({ ...f, gstin: e.target.value.toUpperCase() }))} maxLength={15} />
              </div>
              <Button type="submit" className="w-full" disabled={mutation.isPending}>
                {mutation.isPending ? "Creating account..." : "Create Account"}
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground mt-4">
              Already have an account?{" "}
              <button onClick={() => setLocation("/login")} className="text-primary hover:underline font-medium">Sign in</button>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
