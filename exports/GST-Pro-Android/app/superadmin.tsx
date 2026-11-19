import { useQuery } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useSave } from "@/lib/save";
import { Button, Card, colors, ErrorView, Field, Loading, PasswordPrompt, Prompt, Row, s, StatusPill } from "@/lib/ui";
import { AccountCard, MenuLink } from "./(tabs)/more";
import { Clients, type CapacityRequest } from "./admin";
import { Figure } from "./(tabs)/index";

type Admin = { id: number; name: string; email: string; isActive: boolean; mfaEnabled?: boolean; userLimit: number; userCount: number; availableSlots: number; subscriptionEnd?: string | null };
type Invite = { id: number; name: string; email: string; userLimit: number; expiresAt: string };
type Ask = { title: string; message: string; date?: boolean; then: (v: string) => void };
const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : null);

export default function Superadmin() {
  const admins = useQuery({ queryKey: ["/superadmin/admins"], queryFn: () => api<{ admins: Admin[]; defaultUserLimit: number; additionalUserPriceInr: number }>("/superadmin/admins") });
  const invites = useQuery({ queryKey: ["/superadmin/admin-invitations"], queryFn: () => api<{ invitations: Invite[] }>("/superadmin/admin-invitations") });
  const reqs = useQuery({ queryKey: ["/superadmin/capacity-requests"], queryFn: () => api<{ requests: CapacityRequest[] }>("/superadmin/capacity-requests") });
  const [invite, setInvite] = useState({ name: "", email: "", userLimit: "" });
  const [ask, setAsk] = useState<Ask | null>(null);
  const [confirm, setConfirm] = useState<null | ((pw: string) => void)>(null);
  const { busy, run } = useSave();

  if (admins.isLoading) return <Loading layout="dashboard" />;
  if (admins.error) return <ErrorView error={admins.error} onRetry={admins.refetch} />;
  const d = admins.data!;
  const refresh = () => [admins, invites, reqs].forEach((q) => q.refetch());

  // Every action here is privileged: the server wants the superadmin's own password with it.
  const privileged = (send: (pw: string) => Promise<unknown>, done?: () => void) =>
    setConfirm(() => (pw: string) => run(() => send(pw), () => { setConfirm(null); done?.(); }, () => { setConfirm(null); return false; }));

  const sendInvite = () => {
    const limit = invite.userLimit.trim() ? whole(invite.userLimit) : d.defaultUserLimit;
    if (!invite.name.trim() || !invite.email.trim()) return Alert.alert("Missing details", "Name and email are required.");
    if (limit === null) return Alert.alert("User limit", "Enter a whole number.");
    privileged((pw) => api("/superadmin/admin-invitations", { method: "POST", body: { name: invite.name.trim(), email: invite.email.trim(), userLimit: limit, confirmPassword: pw } }),
      () => { setInvite({ name: "", email: "", userLimit: "" }); Alert.alert("Invitation sent", "They will get an email to set up the admin account."); });
  };
  const editLimit = (a: Admin) => setAsk({
    title: `User limit for ${a.name}`, message: `They have ${a.userCount} users now.`,
    then: (v) => { const n = whole(v); if (n === null) return Alert.alert("Enter a whole number"); privileged((pw) => api(`/superadmin/admins/${a.id}/limit`, { method: "PATCH", body: { userLimit: n, confirmPassword: pw } })); },
  });
  const editPlan = (a: Admin) => setAsk({
    title: `Plan end for ${a.name}`, date: true,
    message: `Last day ${a.name} and their users can sign in, as YYYY-MM-DD, or type "none" for no end date.${a.subscriptionEnd ? ` Now: ${date(a.subscriptionEnd)}.` : ""}`,
    then: (v) => {
      const day = v.trim().toLowerCase() === "none" ? "" : v.trim();
      if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return Alert.alert("Enter the date as YYYY-MM-DD");
      privileged((pw) => api(`/superadmin/admins/${a.id}/plan`, { method: "PATCH", body: { planEnd: day || null, confirmPassword: pw } }));
    },
  });
  const approve = (r: CapacityRequest) => setAsk({
    title: `Approve ${r.adminName}`, message: `They asked for ${r.additionalUsers} more users. Enter their new total user limit.`,
    then: (v) => { const n = whole(v); if (n === null) return Alert.alert("Enter a whole number"); privileged((pw) => api(`/superadmin/capacity-requests/${r.id}/review`, { method: "PATCH", body: { decision: "approve", userLimit: n, confirmPassword: pw } })); },
  });
  const decline = (r: CapacityRequest) => privileged((pw) => api(`/superadmin/capacity-requests/${r.id}/review`, { method: "PATCH", body: { decision: "decline", confirmPassword: pw } }));

  const used = d.admins.reduce((n, a) => n + a.userCount, 0);
  const seats = d.admins.reduce((n, a) => n + a.userLimit, 0);

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={admins.isRefetching} onRefresh={refresh} />}>
      <Stack.Screen options={{ title: "Superadmin", headerBackVisible: false }} />
      <Text style={s.title}>Seats in use · as of {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Text>
      <View style={[s.card, { gap: 12 }]}>
        <View>
          <Text style={s.muted}>Seats in use</Text>
          <Text style={{ color: colors.text, marginTop: 2 }}><Text style={{ fontSize: 32, fontWeight: "700" }}>{used}</Text><Text style={{ fontSize: 16, color: colors.muted }}> of {seats}</Text></Text>
          <Text style={s.muted}>{seats ? Math.round((used / seats) * 100) : 0}% of granted seats · {seats - used} seats free</Text>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
          <Figure label="Admins" value={String(d.admins.length)} note={`${d.admins.filter((a) => a.isActive).length} active`} />
          <Figure label="Extra user price" value={money(d.additionalUserPriceInr)} note="per user" />
        </View>
      </View>

      <Clients />
      <View style={{ borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
        <MenuLink title="Manage and edit users" icon="people-outline" href="/admin/users" />
        <MenuLink title="Add a user" icon="person-add-outline" href="/admin/new-user" />
      </View>

      <Card title="Capacity requests">
        {!reqs.data?.requests.length && <Text style={s.muted}>No requests.</Text>}
        {reqs.data?.requests.map((r) => (
          <View key={r.id} style={{ gap: 6, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Row label={`${r.adminName} · +${r.additionalUsers} · ${money(r.amountInr)}`} value={date(r.createdAt)} />
            <StatusPill status={r.status} />
            {r.status === "pending" && <Text style={s.muted}>{r.paymentStatus === "paid" ? `Paid online${r.paidAt ? ` on ${date(r.paidAt)}` : ""}` : "Not paid yet"}</Text>}
            {r.status === "pending" && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}><Button title="Decline" variant="outline" onPress={() => decline(r)} /></View>
                <View style={{ flex: 1 }}><Button title="Approve" onPress={() => approve(r)} /></View>
              </View>
            )}
          </View>
        ))}
      </Card>

      <Card title="Admins">
        {d.admins.map((a) => (
          <View key={a.id} style={{ gap: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: colors.text, fontWeight: "600", flexShrink: 1 }}>{a.name}</Text>
              <StatusPill status={a.isActive ? "active" : "inactive"} />
            </View>
            <Text style={s.muted}>{a.email}</Text>
            <Row label="Users / limit" value={`${a.userCount} / ${a.userLimit} (${a.availableSlots} free)`} />
            <Row label="Plan ends" value={a.subscriptionEnd ? date(a.subscriptionEnd) : "No end date"} />
            <Text style={s.muted}>{a.mfaEnabled ? "Two-factor on" : "Two-factor not set up"}</Text>
            <Button title="Set plan end date" variant="outline" onPress={() => editPlan(a)} />
            <Button title="Change user limit" variant="outline" onPress={() => editLimit(a)} />
            {a.mfaEnabled && (
              <Button title="Reset two-factor" variant="outline" onPress={() => privileged((pw) => api(`/superadmin/admins/${a.id}/mfa-reset`, { method: "POST", body: { confirmPassword: pw } }),
                () => Alert.alert("Two-factor reset", `${a.name} sets it up again at their next sign-in.`))} />
            )}
          </View>
        ))}
      </Card>

      <Card title="Invite an admin">
        <Field label="Name *" value={invite.name} onChangeText={(v) => setInvite((p) => ({ ...p, name: v }))} />
        <Field label="Email *" value={invite.email} onChangeText={(v) => setInvite((p) => ({ ...p, email: v }))} keyboardType="email-address" autoCapitalize="none" />
        <Field label={`User limit (default ${d.defaultUserLimit})`} value={invite.userLimit} keyboardType="number-pad" onChangeText={(v) => setInvite((p) => ({ ...p, userLimit: v }))} />
        <Button title="Send invitation" busy={busy} onPress={sendInvite} />
        {invites.data?.invitations.map((i) => (
          <Row key={i.id} label={`${i.name} · ${i.email}`} value={`expires ${date(i.expiresAt)}`} />
        ))}
      </Card>

      <AccountCard />
      <Prompt visible={!!ask} numeric={!ask?.date} title={ask?.title ?? ""} message={ask?.message ?? ""} placeholder={ask?.date ? "YYYY-MM-DD" : "User limit"}
        onCancel={() => setAsk(null)} onSubmit={(v) => { const a = ask; setAsk(null); a?.then(v); }} />
      <PasswordPrompt visible={!!confirm} title="Confirm this change" busy={busy} onCancel={() => setConfirm(null)} onSubmit={(pw) => confirm?.(pw)} />
    </ScrollView>
  );
}
