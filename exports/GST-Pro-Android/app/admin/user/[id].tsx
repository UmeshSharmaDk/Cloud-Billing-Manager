import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { api, ApiError } from "@/lib/api";
import { date } from "@/lib/format";
import { useSave } from "@/lib/save";
import type { Business, User } from "@/lib/types";
import { Button, Card, ErrorView, Field, Loading, PasswordPrompt, Prompt, Row, s, Select, StatusPill } from "@/lib/ui";

type Detail = User & { business: Business | null; stats: Record<string, number> };
import { ACCESS } from "@/lib/types";
const LEVELS = [{ value: "owner", label: "Owner" }, ...ACCESS];
const ROLES = [{ value: "user", label: "User" }, { value: "admin", label: "Admin" }];

export default function AdminUser() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: [`/admin/users/${id}`], queryFn: () => api<Detail>(`/admin/users/${encodeURIComponent(id)}`) });
  const [f, setF] = useState({ name: "", email: "", role: "user", accessLevel: "owner" });
  const [confirm, setConfirm] = useState<null | ((pw: string) => void)>(null);
  const [resetting, setResetting] = useState(false);
  const [locking, setLocking] = useState(false);
  const { busy, run } = useSave();
  const u = q.data;
  useEffect(() => {
    if (u) setF({ name: u.name, email: u.email, role: u.role, accessLevel: (u as any).accessLevel ?? "owner" });
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
    if (!f.name.trim() || !f.email.trim()) return Alert.alert("Missing details", "Name and email are required.");
    if (f.name.trim() !== user.name) changed.name = f.name.trim();
    if (f.email.trim() !== user.email) changed.email = f.email.trim();
    if (f.role !== user.role) changed.role = f.role;
    if (f.accessLevel !== ((user as any).accessLevel ?? "owner")) changed.accessLevel = f.accessLevel;
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
        <Row label="Joined" value={date(user.createdAt)} />
      </Card>
      {user.business && (
        <Card title={user.business.name}>
          <Row label="GSTIN" value={String(user.business.gstin ?? "—")} />
          <Row label="Invoices / purchases" value={`${user.stats.invoiceCount} / ${user.stats.purchaseCount}`} />
          <Row label="Customers / vendors" value={`${user.stats.customerCount} / ${user.stats.vendorCount}`} />
          <Row label="Products" value={String(user.stats.productCount)} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["invoices", "purchases"] as const).map((k) => (
              <View key={k} style={{ flex: 1 }}>
                <Button title={k[0].toUpperCase() + k.slice(1)} variant="outline" onPress={() => router.push({ pathname: `/admin/view/${k}`, params: { asUser: String(user.id), name: user.name } })} />
              </View>
            ))}
            <View style={{ flex: 1 }}>
              <Button title="Reports" variant="outline" onPress={() => router.push({ pathname: "/reports", params: { asUser: String(user.id), name: user.name } })} />
            </View>
          </View>
        </Card>
      )}
      <Card title="Edit user">
        <Field label="Name *" value={f.name} onChangeText={(v) => setF((p) => ({ ...p, name: v }))} />
        <Field label="Email *" value={f.email} keyboardType="email-address" autoCapitalize="none" onChangeText={(v) => setF((p) => ({ ...p, email: v }))} />
        <Select label="Access" value={f.accessLevel} options={LEVELS} onChange={(v) => setF((p) => ({ ...p, accessLevel: v }))} />
        <Select label="Role" value={f.role} options={ROLES} onChange={(v) => setF((p) => ({ ...p, role: v }))} />
        <Button title="Save changes" busy={busy} onPress={save} />
      </Card>
      <Button title={user.isActive ? "Deactivate account" : "Activate account"} variant={user.isActive ? "danger" : "primary"} busy={busy} onPress={toggle} />
      <Button title="Reset password" variant="outline" onPress={() => setResetting(true)} />
      {user.business && (
        <Card title="Freeze transactions">
          <Row label="Frozen up to" value={user.business.lockDate ? date(String(user.business.lockDate)) : "Nothing frozen"} />
          <Button title={user.business.lockDate ? "Change lock date" : "Freeze books"} variant="outline" onPress={() => setLocking(true)} />
          <Button title="Edit business details" variant="outline" onPress={() => router.push({ pathname: "/admin/business", params: { id: String(user.id), name: user.name } })} />
          <Button title="Audit trail" variant="outline" onPress={() => router.push({ pathname: "/admin/audit", params: { id: String(user.id), name: user.name } })} />
        </Card>
      )}
      <Prompt visible={locking} title="Freeze books up to" placeholder="YYYY-MM-DD or none" busy={busy}
        message="Invoices, purchases, payments and e-way bills dated on or before this day can't be added, edited or cancelled. Type none to unfreeze."
        onCancel={() => setLocking(false)}
        onSubmit={(v) => {
          setLocking(false);
          const day = v.trim().toLowerCase() === "none" ? null : v.trim();
          if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return Alert.alert("Enter the date as YYYY-MM-DD");
          run(() => api(`/admin/users/${user.id}/lock-date`, { method: "PATCH", body: { lockDate: day } }));
        }} />

      <Prompt visible={resetting} secure title="New password" placeholder="12+ characters" busy={busy}
        message={`Set a new password for ${user.name}. Their other sessions are signed out.`} onCancel={() => setResetting(false)}
        onSubmit={(newPassword) => { setResetting(false); stepUp((pw) => api(`/users/${user.id}/reset-password`, { method: "POST", body: { newPassword, ...(pw ? { confirmPassword: pw } : {}) } }), () => Alert.alert("Password reset")); }} />
      <PasswordPrompt visible={!!confirm} title="Confirm this change" busy={busy} onCancel={() => setConfirm(null)} onSubmit={(pw) => confirm?.(pw)} />
    </ScrollView>
  );
}
