import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListSuperadminAdminsQueryKey, getListAdminInvitationsQueryKey, getListCapacityRequestsQueryKey,
  useListSuperadminAdmins, useListAdminInvitations, useListCapacityRequests,
  useCreateAdminInvitation, useUpdateSuperadminAdminLimit, useReviewCapacityRequest, useResetAdminMfa,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmPasswordDialog } from "@/components/ConfirmPasswordDialog";
import { authFetch } from "@/lib/api-fetch";
import {
  ShieldCheck, UserRoundPlus, UsersRound, UserCog, Clock3, CircleAlert, CircleCheck,
  Search, Pencil, ArrowUpRight, X, Check, RefreshCw, Mail, CalendarDays,
  ChevronRight, CircleDollarSign, Info,
} from "lucide-react";

type ActionIntent =
  | { type: "invite"; payload: { name: string; email: string; userLimit: number } }
  | { type: "limit"; id: number; name: string; userLimit: number }
  | { type: "review"; id: number; name: string; decision: "approve" | "decline"; userLimit?: number }
  | { type: "mfa"; id: number; name: string }
  | { type: "plan"; id: number; name: string; planEnd: string | null };

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "—";
const errorMessage = (error: any) => error?.data?.error ?? error?.data?.message ?? error?.message ?? "The action could not be completed. Try again.";

export default function SuperadminDashboardPage() {
  const queryClient = useQueryClient();
  const adminsQuery = useListSuperadminAdmins({ query: { queryKey: getListSuperadminAdminsQueryKey(), refetchOnMount: "always" } });
  const invitesQuery = useListAdminInvitations({ query: { queryKey: getListAdminInvitationsQueryKey(), refetchOnMount: "always" } });
  const requestsQuery = useListCapacityRequests({ query: { queryKey: getListCapacityRequestsQueryKey(), refetchOnMount: "always" } });
  const createInvite = useCreateAdminInvitation();
  const updateLimit = useUpdateSuperadminAdminLimit();
  const reviewRequest = useReviewCapacityRequest();
  const resetMfa = useResetAdminMfa();
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: "", email: "", userLimit: "" });
  const [intent, setIntent] = useState<ActionIntent | null>(null);
  const [limitEditor, setLimitEditor] = useState<{ id: number; name: string; value: string } | null>(null);
  const [planEditor, setPlanEditor] = useState<{ id: number; name: string; value: string } | null>(null);
  const [planPending, setPlanPending] = useState(false);
  const [reviewEditor, setReviewEditor] = useState<{ id: number; name: string; value: string } | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");

  const admins = adminsQuery.data?.admins ?? [];
  const invitations = invitesQuery.data?.invitations ?? [];
  const requests = requestsQuery.data?.requests ?? [];
  const pendingRequests = requests.filter((request) => request.status === "pending");
  const filteredAdmins = useMemo(() => admins.filter((admin) =>
    `${admin.name} ${admin.email}`.toLowerCase().includes(query.toLowerCase())
  ), [admins, query]);
  const activeCount = admins.filter((admin) => admin.isActive).length;
  const totalUsers = admins.reduce((sum, admin) => sum + admin.userCount, 0);
  const invalidateAdminData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListSuperadminAdminsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListAdminInvitationsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListCapacityRequestsQueryKey() }),
    ]);
  };
  const startConfirm = (next: ActionIntent) => {
    setPageError(""); setFormError(""); setIntent(next); setPasswordDialogOpen(true);
  };
  const privilegedError = (error: any) => {
    setPageError(errorMessage(error));
    setPasswordDialogOpen(false);
    setIntent(null);
  };
  const confirmPrivileged = (confirmPassword: string) => {
    if (!intent) return;
    setPageError("");
    if (intent.type === "invite") {
      createInvite.mutate({ data: { ...intent.payload, confirmPassword } }, {
        onSuccess: async () => {
          await invalidateAdminData();
          setPasswordDialogOpen(false); setIntent(null); setInviteOpen(false);
          setInvite({ name: "", email: "", userLimit: "" });
          setNotice("Invitation issued. The one-time setup link has been sent to the administrator.");
        },
        onError: privilegedError,
      });
      return;
    }
    if (intent.type === "limit") {
      updateLimit.mutate({ id: intent.id, data: { userLimit: intent.userLimit, confirmPassword } }, {
        onSuccess: async () => {
          await invalidateAdminData();
          setPasswordDialogOpen(false); setIntent(null); setLimitEditor(null);
          setNotice("Managed-user limit updated.");
        },
        onError: privilegedError,
      });
      return;
    }
    if (intent.type === "plan") {
      setPlanPending(true);
      authFetch(`/api/superadmin/admins/${intent.id}/plan`, { method: "PATCH", body: JSON.stringify({ planEnd: intent.planEnd, confirmPassword }) })
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          if (!res.ok) throw { data };
          await invalidateAdminData();
          setPasswordDialogOpen(false); setIntent(null); setPlanEditor(null);
          setNotice(intent.planEnd ? `${intent.name}'s plan now ends on ${date(intent.planEnd)}.` : `${intent.name}'s plan no longer has an end date.`);
        })
        .catch(privilegedError)
        .finally(() => setPlanPending(false));
      return;
    }
    if (intent.type === "mfa") {
      resetMfa.mutate({ id: intent.id, data: { confirmPassword } }, {
        onSuccess: async () => {
          await invalidateAdminData();
          setPasswordDialogOpen(false); setIntent(null);
          setNotice(`Two-factor authentication was reset for ${intent.name}. They must set it up again before using the admin panel.`);
        },
        onError: privilegedError,
      });
      return;
    }
    reviewRequest.mutate({ id: intent.id, data: { decision: intent.decision, ...(intent.decision === "approve" ? { userLimit: intent.userLimit } : {}), confirmPassword } }, {
      onSuccess: async () => {
        await invalidateAdminData();
        setPasswordDialogOpen(false); setIntent(null); setReviewEditor(null);
        setNotice(intent.decision === "approve" ? "Capacity request approved with the specified user limit." : "Capacity request declined. No capacity was changed.");
      },
      onError: privilegedError,
    });
  };
  const isPrivilegedPending = createInvite.isPending || updateLimit.isPending || reviewRequest.isPending || resetMfa.isPending || planPending;

  const handleInvite = (event: React.FormEvent) => {
    event.preventDefault(); setFormError("");
    const limit = invite.userLimit === "" ? adminsQuery.data?.defaultUserLimit ?? 15 : Number(invite.userLimit);
    if (!Number.isInteger(limit) || limit < 0) { setFormError("Enter a whole-number limit of zero or more."); return; }
    startConfirm({ type: "invite", payload: { name: invite.name.trim(), email: invite.email.trim(), userLimit: limit } });
  };
  const submitLimit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!limitEditor) return;
    const value = Number(limitEditor.value);
    const currentAdmin = admins.find((admin) => admin.id === limitEditor.id);
    if (!Number.isInteger(value) || value < (currentAdmin?.userCount ?? 0)) {
      setFormError(`The limit must be a whole number and cannot be below the current ${currentAdmin?.userCount ?? 0} users.`);
      return;
    }
    setFormError("");
    startConfirm({ type: "limit", id: limitEditor.id, name: limitEditor.name, userLimit: value });
  };
  const submitApprove = (event: React.FormEvent) => {
    event.preventDefault();
    if (!reviewEditor) return;
    const value = Number(reviewEditor.value);
    if (!Number.isInteger(value) || value < 0) { setFormError("Enter an explicit whole-number user limit."); return; }
    setFormError("");
    startConfirm({ type: "review", id: reviewEditor.id, name: reviewEditor.name, decision: "approve", userLimit: value });
  };

  return (
    <div className="space-y-7 pb-12">
      <section className="relative overflow-hidden rounded-2xl bg-brand-navy px-6 py-7 text-white shadow-md md:px-8">
        <div className="absolute -right-12 -top-28 h-72 w-72 rounded-full border border-white/10" />
        <div className="absolute right-16 -top-20 h-52 w-52 rounded-full border border-white/10" />
        <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[.16em] text-white"><ShieldCheck className="h-3.5 w-3.5" /> Platform control</div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-[2.15rem]">Tenant administration</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">Provision administrators, keep user allowances explicit, and review every capacity request.</p>
          </div>
          <Button onClick={() => { setInviteOpen(true); setPageError(""); setFormError(""); }} className="h-10 gap-2 bg-brand-cyan px-4 font-semibold text-brand-navy hover:bg-brand-cyan-hover" data-testid="button-invite-admin"><UserRoundPlus className="h-4 w-4" /> Invite administrator</Button>
        </div>
        <div className="relative mt-7 grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-3">
          <SummaryCell label="Administrator accounts" value={adminsQuery.isLoading ? "—" : String(admins.length)} detail={`${activeCount} active`} />
          <SummaryCell label="Managed users" value={adminsQuery.isLoading ? "—" : totalUsers.toLocaleString("en-IN")} detail="Across all tenants" />
          <SummaryCell label="Requests awaiting review" value={requestsQuery.isLoading ? "—" : String(pendingRequests.length)} detail="Capacity decisions" />
        </div>
      </section>

      {(pageError || notice) && <div className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${pageError ? "border-danger/30 bg-danger-bg text-danger-text" : "border-success/30 bg-success-bg text-success-text"}`} role={pageError ? "alert" : "status"}><div className="flex items-start gap-2">{pageError ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />}{pageError || notice}</div><button aria-label="Dismiss notification" onClick={() => { setPageError(""); setNotice(""); }} className="rounded p-0.5 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button></div>}

      <section className="space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Tenant directory</p><h2 className="text-xl font-semibold tracking-tight">Administrator accounts</h2><p className="mt-1 text-sm text-muted-foreground">Each administrator can manage users within their own account only.</p></div>
          <div className="relative w-full sm:max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input data-testid="input-search-admins" className="h-10 bg-card pl-9" placeholder="Find an administrator…" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        </div>
        <Card className="overflow-hidden rounded-xl border-border shadow-sm">
          {adminsQuery.isLoading ? <SkeletonList /> : adminsQuery.isError ? <QueryError title="Administrator directory unavailable" retry={() => void adminsQuery.refetch()} /> : filteredAdmins.length === 0 ? (
            <EmptyState icon={<UserCog className="h-6 w-6" />} title={query ? "No matching administrators" : "No administrator accounts yet"} detail={query ? "Try searching with another name or email." : "Invite an administrator to provision a new tenant."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead><tr className="border-b bg-muted text-[11px] uppercase tracking-[.1em] text-muted-foreground"><th className="px-5 py-3 text-left font-semibold">Administrator</th><th className="px-4 py-3 text-center font-semibold">Status</th><th className="px-4 py-3 text-left font-semibold">Managed users</th><th className="px-4 py-3 text-left font-semibold">Allowance</th><th className="px-4 py-3 text-left font-semibold">Plan ends</th><th className="px-4 py-3 text-left font-semibold">Created</th><th className="px-5 py-3 text-right font-semibold">Action</th></tr></thead>
                <tbody>{filteredAdmins.map((admin) => {
                  const percent = admin.userLimit > 0 ? Math.min(100, admin.userCount / admin.userLimit * 100) : (admin.userCount ? 100 : 0);
                  const full = admin.availableSlots <= 0;
                  return <tr key={admin.id} data-testid={`row-admin-${admin.id}`} className="border-b last:border-0 transition-colors hover:bg-muted">
                    <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-sm font-bold text-foreground">{admin.name.split(/\s+/).map((n) => n[0]).slice(0, 2).join("").toUpperCase()}</div><div><p className="font-semibold">{admin.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{admin.email}</p><p className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${admin.mfaEnabled ? "text-success-text" : "text-warning-text"}`}>{admin.mfaEnabled ? "2FA on" : "2FA not set up"}</p></div></div></td>
                    <td className="px-4 py-4 text-center"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${admin.isActive ? "bg-success-bg text-success-text" : "bg-slate-100 text-slate-600"}`}><span className={`h-1.5 w-1.5 rounded-full ${admin.isActive ? "bg-success" : "bg-slate-400"}`} />{admin.isActive ? "Active" : "Inactive"}</span></td>
                    <td className="px-4 py-4"><div className="font-semibold tabular-nums">{admin.userCount.toLocaleString("en-IN")} <span className="font-normal text-muted-foreground">users</span></div><div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-accent"><div className={`h-full rounded-full transition-[width] duration-300 ${full ? "bg-warning" : "bg-primary"}`} style={{ width: `${percent}%` }} /></div></td>
                    <td className="px-4 py-4"><div className="flex items-center gap-2"><span className="font-semibold tabular-nums">{admin.userLimit.toLocaleString("en-IN")}</span><span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${full ? "bg-warning-bg text-warning-text" : "bg-accent text-muted-foreground"}`}>{admin.availableSlots.toLocaleString("en-IN")} available</span></div></td>
                    <td className="px-4 py-4 text-xs">{admin.subscriptionEnd ? <span className={new Date(`${admin.subscriptionEnd}T23:59:59`) < new Date() ? "font-semibold text-danger-text" : ""}>{date(admin.subscriptionEnd)}</span> : <span className="text-muted-foreground">No end date</span>}</td>
                    <td className="px-4 py-4 text-xs text-muted-foreground">{date(admin.createdAt)}</td>
                    <td className="px-5 py-4 text-right"><div className="flex justify-end gap-2">{admin.mfaEnabled && <Button variant="outline" size="sm" className="gap-1.5" data-testid={`button-reset-mfa-${admin.id}`} onClick={() => startConfirm({ type: "mfa", id: admin.id, name: admin.name })}><ShieldCheck className="h-3.5 w-3.5" /> Reset 2FA</Button>}<Button variant="outline" size="sm" className="gap-1.5" data-testid={`button-edit-plan-${admin.id}`} onClick={() => { setFormError(""); setPlanEditor({ id: admin.id, name: admin.name, value: admin.subscriptionEnd?.slice(0, 10) ?? "" }); }}><CalendarDays className="h-3.5 w-3.5" /> Plan end</Button><Button variant="outline" size="sm" className="gap-1.5" data-testid={`button-edit-limit-${admin.id}`} onClick={() => { setFormError(""); setLimitEditor({ id: admin.id, name: admin.name, value: String(admin.userLimit) }); }}><Pencil className="h-3.5 w-3.5" /> Edit limit</Button></div></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-3"><div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Capacity governance</p><h2 className="text-xl font-semibold tracking-tight">Requests for more users</h2></div><span className="rounded-full bg-warning-bg px-2.5 py-1 text-xs font-semibold text-warning-text">{pendingRequests.length} pending</span></div>
          <Card className="rounded-xl border-border shadow-sm">
            {requestsQuery.isLoading ? <div className="space-y-3 p-5">{[0, 1].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />)}</div> : requestsQuery.isError ? <QueryError title="Capacity requests unavailable" retry={() => void requestsQuery.refetch()} /> : pendingRequests.length === 0 ? <EmptyState icon={<CircleCheck className="h-6 w-6" />} title="Review queue is clear" detail="New tenant capacity requests will appear here." compact /> : (
              <div className="divide-y divide-border">{pendingRequests.map((request) => <div key={request.id} data-testid={`card-capacity-request-${request.id}`} className="p-5 transition-colors hover:bg-muted">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{request.adminName}</span><span className="rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-text">Pending</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{request.adminEmail}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"><span className="inline-flex items-center gap-1.5 font-semibold text-foreground"><UsersRound className="h-3.5 w-3.5" /> +{request.additionalUsers} users</span><span className="inline-flex items-center gap-1.5 text-muted-foreground"><CircleDollarSign className="h-3.5 w-3.5" /> Quote {money(request.amountInr)}</span><span className="inline-flex items-center gap-1.5 text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /> {date(request.createdAt)}</span></div>
                  </div>
                  <div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" className="gap-1.5 border-danger/30 text-danger-text hover:bg-danger-bg" data-testid={`button-decline-request-${request.id}`} onClick={() => startConfirm({ type: "review", id: request.id, name: request.adminName, decision: "decline" })}><X className="h-3.5 w-3.5" /> Decline</Button><Button size="sm" className="gap-1.5 bg-primary hover:bg-primary-hover" data-testid={`button-approve-request-${request.id}`} onClick={() => { setFormError(""); setReviewEditor({ id: request.id, name: request.adminName, value: "" }); }}><Check className="h-3.5 w-3.5" /> Approve</Button></div>
                </div>
                <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground"><Info className="mt-0.5 h-3 w-3 shrink-0" /> Approval requires an explicit replacement user limit. The quote is for reference; capacity changes only after an approved limit is saved.</p>
              </div>)}</div>
            )}
          </Card>
        </section>

        <section className="space-y-4">
          <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Invite lifecycle</p><h2 className="text-xl font-semibold tracking-tight">Open invitations</h2><p className="mt-1 text-sm text-muted-foreground">One-time links waiting for setup.</p></div>
          <Card className="rounded-xl border-border shadow-sm">
            {invitesQuery.isLoading ? <div className="space-y-3 p-5">{[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div> : invitesQuery.isError ? <QueryError title="Invitations unavailable" retry={() => void invitesQuery.refetch()} /> : invitations.length === 0 ? <EmptyState icon={<Mail className="h-6 w-6" />} title="No open invitations" detail="Invited administrators appear here until they finish setup." compact /> : (
              <div className="divide-y divide-border">{invitations.map((item) => <div key={item.id} data-testid={`row-invitation-${item.id}`} className="flex items-start justify-between gap-3 p-4"><div className="flex min-w-0 items-start gap-3"><div className="rounded-lg bg-accent p-2 text-foreground"><Mail className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.name}</p><p className="truncate text-xs text-muted-foreground">{item.email}</p><p className="mt-1 text-[11px] text-muted-foreground">Limit {item.userLimit} · expires {date(item.expiresAt)}</p></div></div><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></div>)}</div>
            )}
          </Card>
          <Card className="rounded-xl border-border bg-muted shadow-none dark:border-border dark:bg-card"><CardContent className="flex gap-3 p-4"><div className="rounded-lg bg-white p-2 text-muted-foreground"><Clock3 className="h-4 w-4" /></div><div><p className="text-sm font-semibold text-foreground">A clear audit trail</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Capacity decisions are reviewed individually. Declining a request never changes an administrator’s allowance.</p></div></CardContent></Card>
        </section>
      </div>

      {inviteOpen && <Modal title="Invite administrator" eyebrow="Provision a tenant" onClose={() => setInviteOpen(false)} icon={<UserRoundPlus className="h-5 w-5" />}>
        <form className="space-y-4" onSubmit={handleInvite}>
          <div className="space-y-1.5"><Label htmlFor="invite-name">Administrator name</Label><Input id="invite-name" data-testid="input-invite-name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} autoComplete="name" required /></div>
          <div className="space-y-1.5"><Label htmlFor="invite-email">Email address</Label><Input id="invite-email" data-testid="input-invite-email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} autoComplete="email" required /></div>
          <div className="space-y-1.5"><Label htmlFor="invite-limit">Managed-user limit</Label><Input id="invite-limit" data-testid="input-invite-limit" type="number" min="0" max="100000" value={invite.userLimit} placeholder={String(adminsQuery.data?.defaultUserLimit ?? 15)} onChange={(e) => setInvite({ ...invite, userLimit: e.target.value })} /><p className="text-xs text-muted-foreground">Leave blank to use the platform default{adminsQuery.data ? ` of ${adminsQuery.data.defaultUserLimit}` : ""}.</p></div>
          {formError && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-text">{formError}</p>}
          <div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" type="button" onClick={() => setInviteOpen(false)}>Cancel</Button><Button type="submit" data-testid="button-send-invite">Continue to confirmation <ChevronRight className="ml-1 h-4 w-4" /></Button></div>
        </form>
      </Modal>}

      {limitEditor && <Modal title="Edit user allowance" eyebrow={limitEditor.name} onClose={() => setLimitEditor(null)} icon={<Pencil className="h-5 w-5" />}>
        <form className="space-y-4" onSubmit={submitLimit}><div className="rounded-lg bg-muted p-3 text-sm"><span className="text-muted-foreground">Current usage</span><strong className="ml-2">{admins.find((a) => a.id === limitEditor.id)?.userCount ?? 0} users</strong></div><div className="space-y-1.5"><Label htmlFor="edit-user-limit">New managed-user limit</Label><Input id="edit-user-limit" data-testid="input-edit-user-limit" type="number" min={admins.find((a) => a.id === limitEditor.id)?.userCount ?? 0} max="100000" step="1" value={limitEditor.value} onChange={(e) => setLimitEditor({ ...limitEditor, value: e.target.value })} required /></div>{formError && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-text">{formError}</p>}<div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" type="button" onClick={() => setLimitEditor(null)}>Cancel</Button><Button type="submit">Review change <ChevronRight className="ml-1 h-4 w-4" /></Button></div></form>
      </Modal>}

      {planEditor && <Modal title="Plan end date" eyebrow={planEditor.name} onClose={() => setPlanEditor(null)} icon={<CalendarDays className="h-5 w-5" />}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); startConfirm({ type: "plan", id: planEditor.id, name: planEditor.name, planEnd: planEditor.value || null }); }}>
          <div className="space-y-1.5"><Label htmlFor="plan-end">Last day of the plan</Label><Input id="plan-end" type="date" value={planEditor.value} onChange={(e) => setPlanEditor({ ...planEditor, value: e.target.value })} /><p className="text-xs text-muted-foreground">After this day the administrator and every user they created cannot sign in. Leave empty for no end date.</p></div>
          <div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" type="button" onClick={() => setPlanEditor(null)}>Cancel</Button><Button type="submit">Review change <ChevronRight className="ml-1 h-4 w-4" /></Button></div>
        </form>
      </Modal>}

      {reviewEditor && <Modal title="Approve capacity request" eyebrow={reviewEditor.name} onClose={() => setReviewEditor(null)} icon={<ArrowUpRight className="h-5 w-5" />}>
        <form className="space-y-4" onSubmit={submitApprove}><div className="flex gap-2 rounded-lg border border-warning/30 bg-warning-bg p-3 text-xs leading-5 text-warning-text"><Info className="mt-0.5 h-4 w-4 shrink-0" /><span>Approval applies the exact user limit entered below. Do not use the requested add-on count as a replacement limit unless that is your intended total.</span></div><div className="space-y-1.5"><Label htmlFor="approved-user-limit">New total user limit</Label><Input id="approved-user-limit" data-testid="input-approved-user-limit" type="number" min="0" max="100000" step="1" value={reviewEditor.value} onChange={(e) => setReviewEditor({ ...reviewEditor, value: e.target.value })} placeholder="Enter the explicit new limit" required /></div>{formError && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-text">{formError}</p>}<div className="flex justify-end gap-2 border-t pt-4"><Button variant="outline" type="button" onClick={() => setReviewEditor(null)}>Cancel</Button><Button type="submit" className="bg-primary hover:bg-primary-hover">Continue to approval</Button></div></form>
      </Modal>}

      <ConfirmPasswordDialog
        open={passwordDialogOpen}
        onOpenChange={(open) => { setPasswordDialogOpen(open); if (!open) setIntent(null); }}
        title={intent?.type === "plan" ? "Confirm plan end date" : intent?.type === "mfa" ? "Confirm two-factor reset" : intent?.type === "review" ? (intent.decision === "approve" ? "Confirm capacity approval" : "Confirm request decline") : intent?.type === "limit" ? "Confirm allowance change" : "Confirm administrator invitation"}
        description={intent?.type === "plan" ? (intent.planEnd ? `End ${intent.name}'s plan on ${date(intent.planEnd)}. After that day they and their users cannot sign in.` : `Remove the end date from ${intent.name}'s plan.`) : intent?.type === "mfa" ? `Turn off two-factor authentication for ${intent.name} and sign them out everywhere. Only do this after confirming who is asking, outside this app.` : intent?.type === "review" ? intent.decision === "approve" ? `Approve ${intent.name} with a new user limit of ${intent.userLimit ?? 0}.` : `Decline the capacity request from ${intent.name}. The user limit will not change.` : intent?.type === "limit" ? `Set ${intent.name}’s managed-user limit to ${intent.userLimit}.` : "Send a one-time administrator setup invitation. Your password is required to authorize this action."}
        confirmLabel={intent?.type === "plan" ? "Save plan end" : intent?.type === "mfa" ? "Reset 2FA" : intent?.type === "review" ? intent.decision === "approve" ? "Approve request" : "Decline request" : intent?.type === "limit" ? "Save new limit" : "Send invitation"}
        pending={isPrivilegedPending}
        onConfirm={confirmPrivileged}
      />
    </div>
  );
}

function SummaryCell({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/[.07] px-4 py-3"><div className="text-xs text-white/65">{label}</div><div className="mt-1 flex items-baseline gap-2"><span className="text-2xl font-semibold tabular-nums">{value}</span><span className="text-[11px] text-white/65">{detail}</span></div></div>;
}
function SkeletonList() {
  return <div className="space-y-3 p-5" aria-label="Loading administrator accounts">{[0, 1, 2, 3].map((i) => <div key={i} className="flex animate-pulse items-center gap-4 rounded-lg border border-border/60 p-4"><div className="h-10 w-10 rounded-xl bg-muted" /><div className="flex-1 space-y-2"><div className="h-3 w-44 rounded bg-muted" /><div className="h-2.5 w-56 rounded bg-muted" /></div><div className="h-7 w-24 rounded bg-muted" /></div>)}</div>;
}
function QueryError({ title, retry }: { title: string; retry: () => void }) {
  return <div className="flex flex-col items-center px-6 py-10 text-center"><div className="mb-3 rounded-xl bg-danger-bg p-3 text-danger-text"><CircleAlert className="h-5 w-5" /></div><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted-foreground">Check your connection and retry.</p><Button className="mt-4 gap-2" size="sm" variant="outline" onClick={retry}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button></div>;
}
function EmptyState({ icon, title, detail, compact = false }: { icon: React.ReactNode; title: string; detail: string; compact?: boolean }) {
  return <div className={`flex flex-col items-center text-center ${compact ? "px-5 py-9" : "px-6 py-14"}`}><div className="mb-3 rounded-xl bg-accent p-3 text-muted-foreground">{icon}</div><p className="font-semibold">{title}</p><p className="mt-1 max-w-xs text-sm text-muted-foreground">{detail}</p></div>;
}
function Modal({ title, eyebrow, icon, onClose, children }: { title: string; eyebrow: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-brand-navy/45 p-4" role="dialog" aria-modal="true" aria-labelledby="platform-modal-title"><Card className="w-full max-w-md overflow-hidden rounded-2xl border-border shadow-2xl"><div className="flex items-center justify-between border-b bg-muted px-6 py-5"><div className="flex items-center gap-3"><div className="rounded-lg bg-accent p-2 text-foreground">{icon}</div><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-muted-foreground">{eyebrow}</p><h2 id="platform-modal-title" className="mt-0.5 font-semibold">{title}</h2></div></div><button type="button" aria-label="Close dialog" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white hover:text-foreground"><X className="h-4 w-4" /></button></div><CardContent className="p-6">{children}</CardContent></Card></div>;
}