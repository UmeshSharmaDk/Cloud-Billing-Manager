import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ScrollView } from "react-native";
import { api, ApiError } from "@/lib/api";
import { date } from "@/lib/format";
import { useSave } from "@/lib/save";
import type { Business, User } from "@/lib/types";
import { Button, Card, ErrorView, Field, Loading, PasswordPrompt, Prompt, Row, s, Select, StatusPill } from "@/lib/ui";

type Detail = User & { business: Business | null; stats: Record<string, number> };
const PLANS = ["trial", "monthly", "yearly", "expired"].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }));
const ROLES = [{ value: "user", label: "User" }, { value: "admin", label: "Admin" }];

export default function AdminUser() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: [`/admin/users/${id}`], queryFn: () => api<Detail>(`/admin/users/${encodeURIComponent(id)}`) });
  const [f, setF] = useState({ subscriptionStatus: "trial", subscriptionEnd: "", role: "user" });
  const [confirm, setConfirm] = useState<null | ((pw: string) => void)>(null);
  const [resetting, setResetting] = useState(false);
  const { busy, run } = useSave();
  const u = q.data;
  useEffect(() => {
    if (u) setF({ subscriptionStatus: u.subscriptionStatus || "trial", subscriptionEnd: u.subscriptionEnd?.slice(0, 10) ?? "", role: u.role });
  }, [u]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorView error={q.error} onRetry={q.refetch} />;
  const user = u!;

  // The server asks for the admin's own password before privileged changes; ask, then resend.
  const stepUp = (send: (pw?: string) => Promise<unknown>, done?: () => void) => {
    const attempt = (pw?: string) => run(() => send(pw), () => { setConfirm(null); done?.(); }, (e) => {
      if (e instanceof ApiError && e.code === "step_up_required" && !pw) { setConfirm(() => attempt); return true; }
      return false;
    });
    attempt();
  };

  const save = () => {
    const changed: Record<string, string> = {};
    if (f.role !== user.role) changed.role = f.role;
    if (f.subscriptionStatus !== (user.subscriptionStatus || "trial")) changed.subscriptionStatus = f.subscriptionStatus;
    if (f.subscriptionEnd !== (user.subscriptionEnd?.slice(0, 10) ?? "")) changed.subscriptionEnd = f.subscriptionEnd;
    if (!Object.keys(changed).length) return Alert.alert("Nothing changed");
    stepUp((pw) => api(`/users/${user.id}`, { method: "PATCH", body: { ...changed, ...(pw ? { confirmPassword: pw } : {}) } }));
  };
  const toggle = () => run(() => api(`/users/${user.id}/toggle-status`, { method: "PATCH", body: { isActive: !user.isActive } }));

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Stack.Screen options={{ title: user.name }} />
      <Card title={user.name} right={<StatusPill status={user.isActive ? "active" : "inactive"} />}>
        <Row label="Email" value={user.email} />
        <Row label="Role" value={user.role} />
        <Row label="Plan" value={user.subscriptionStatus ?? "trial"} />
        <Row label="Plan ends" value={date(user.subscriptionEnd)} />
        <Row label="Joined" value={date(user.createdAt)} />
      </Card>
      {user.business && (
        <Card title={user.business.name}>
          <Row label="GSTIN" value={String(user.business.gstin ?? "—")} />
          <Row label="Invoices / purchases" value={`${user.stats.invoiceCount} / ${user.stats.purchaseCount}`} />
          <Row label="Customers / vendors" value={`${user.stats.customerCount} / ${user.stats.vendorCount}`} />
          <Row label="Products" value={String(user.stats.productCount)} />
        </Card>
      )}
      <Card title="Subscription and role">
        <Select label="Plan" value={f.subscriptionStatus} options={PLANS} onChange={(v) => setF((p) => ({ ...p, subscriptionStatus: v }))} />
        <Field label="Plan ends (YYYY-MM-DD)" value={f.subscriptionEnd} onChangeText={(v) => setF((p) => ({ ...p, subscriptionEnd: v }))} />
        <Select label="Role" value={f.role} options={ROLES} onChange={(v) => setF((p) => ({ ...p, role: v }))} />
        <Button title="Save changes" busy={busy} onPress={save} />
      </Card>
      <Button title={user.isActive ? "Deactivate account" : "Activate account"} variant={user.isActive ? "danger" : "primary"} busy={busy} onPress={toggle} />
      <Button title="Reset password" variant="outline" onPress={() => setResetting(true)} />

      <Prompt visible={resetting} secure title="New password" placeholder="12+ characters" busy={busy}
        message={`Set a new password for ${user.name}. Their other sessions are signed out.`} onCancel={() => setResetting(false)}
        onSubmit={(newPassword) => { setResetting(false); stepUp((pw) => api(`/users/${user.id}/reset-password`, { method: "POST", body: { newPassword, ...(pw ? { confirmPassword: pw } : {}) } }), () => Alert.alert("Password reset")); }} />
      <PasswordPrompt visible={!!confirm} title="Confirm this change" busy={busy} onCancel={() => setConfirm(null)} onSubmit={(pw) => confirm?.(pw)} />
    </ScrollView>
  );
}
