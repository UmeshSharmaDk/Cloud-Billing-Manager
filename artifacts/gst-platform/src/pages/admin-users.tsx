import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListUsersQueryKey, getListCapacityRequestsQueryKey,
  useListUsers, useListCapacityRequests, useCreateUser, useCreateCapacityRequest,
} from "@workspace/api-client-react";
import { formatDate, statusBadge } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Search, Users, Shield, ChevronRight, UserPlus, CircleAlert, CircleCheck, Clock3,
  UserRound, ArrowUpRight, LoaderCircle, Info,
} from "lucide-react";

const currency = (value: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 0,
}).format(value);

function responseError(error: any) {
  return error?.data?.error ?? error?.data?.message ?? error?.message ?? "Something went wrong. Please try again.";
}
function isQuotaError(error: any) {
  return error?.status === 402 || error?.response?.status === 402 || error?.data?.statusCode === 402;
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showCapacity, setShowCapacity] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");
  const [capacityError, setCapacityError] = useState("");
  const [capacitySuccess, setCapacitySuccess] = useState("");
  const [quotaHit, setQuotaHit] = useState(false);
  const [capacityCount, setCapacityCount] = useState("1");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const { data, isLoading, isError, refetch } = useListUsers(undefined, {
    query: { queryKey: getListUsersQueryKey(), refetchOnMount: "always" },
  });
  const capacityRequestsQuery = useListCapacityRequests({
    query: { queryKey: getListCapacityRequestsQueryKey(), refetchOnMount: "always" },
  });
  const createUser = useCreateUser();
  const requestCapacity = useCreateCapacityRequest();
  const users = data?.users ?? [];
  const pendingCapacityRequest = capacityRequestsQuery.data?.requests
    .find((request) => request.status === "pending");
  const filtered = useMemo(() => users.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  ), [users, search]);
  const pending = createUser.isPending || requestCapacity.isPending;

  const submitUser = (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError("");
    setCreateSuccess("");
    setQuotaHit(false);
    createUser.mutate({ data: { ...form, role: "user" } }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setForm({ name: "", email: "", password: "" });
        setShowCreate(false);
        setCreateSuccess("User account created and added to your workspace.");
      },
      onError: (error: any) => {
        if (isQuotaError(error)) {
          setQuotaHit(true);
          setShowCapacity(true);
          setCreateError("Your current user allowance is full. Request additional capacity for review.");
        } else setCreateError(responseError(error));
      },
    });
  };

  const submitCapacity = (event: React.FormEvent) => {
    event.preventDefault();
    setCapacityError("");
    setCapacitySuccess("");
    const count = Number(capacityCount);
    if (!Number.isInteger(count) || count < 1) {
      setCapacityError("Enter at least one additional user.");
      return;
    }
    requestCapacity.mutate({ data: { additionalUsers: count } }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListCapacityRequestsQueryKey() });
        setCapacitySuccess("Capacity request submitted. It is pending review and does not grant additional capacity.");
        setCapacityCount("1");
        setShowCapacity(false);
        setQuotaHit(false);
      },
      onError: (error: any) => setCapacityError(responseError(error)),
    });
  };

  return (
    <div className="space-y-7 pb-10">
      <section className="relative overflow-hidden rounded-2xl bg-[#123a34] px-6 py-7 text-white shadow-md md:px-8">
        <div className="absolute -right-12 -top-24 h-64 w-64 rounded-full border border-white/10" />
        <div className="absolute right-14 -top-16 h-48 w-48 rounded-full border border-white/10" />
        <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[.16em] text-emerald-100">
              <Shield className="h-3.5 w-3.5" /> Workspace administration
            </div>
            <h1 className="text-3xl font-semibold tracking-tight md:text-[2.15rem]">User management</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-emerald-50/75">Manage the people in your business workspace. Your records stay separate from every other account.</p>
          </div>
          <Button onClick={() => { setShowCreate(true); setCreateError(""); }} className="h-10 gap-2 bg-[#d8edb7] px-4 font-semibold text-[#193c32] hover:bg-[#c8e3a1]" data-testid="button-add-user">
            <UserPlus className="h-4 w-4" /> Add user
          </Button>
        </div>
        <div className="relative mt-7 grid max-w-2xl grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/[.07] px-4 py-3">
            <div className="text-xs text-emerald-50/65">Workspace users</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{data?.total ?? users.length}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[.07] px-4 py-3">
            <div className="text-xs text-emerald-50/65">Access scope</div>
            <div className="mt-1 flex items-center gap-2 text-sm font-medium"><UserRound className="h-4 w-4 text-[#d8edb7]" /> Your workspace only</div>
          </div>
        </div>
      </section>

      {createSuccess && <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950"><CircleCheck className="h-4 w-4 text-emerald-700" /><AlertTitle>Account created</AlertTitle><AlertDescription>{createSuccess}</AlertDescription></Alert>}
      {quotaHit && (
        <Alert className="border-amber-200 bg-[#fff8e8] text-[#58431c]">
          <CircleAlert className="h-4 w-4 text-amber-700" />
          <AlertTitle>User allowance reached</AlertTitle>
          <AlertDescription className="mt-1 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>The fixed quote is {currency(1000)} for each additional user. A request is pending review only; it does not add capacity or enable user creation.</span>
            {pendingCapacityRequest
              ? <span className="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900">Request pending review</span>
              : <Button variant="outline" size="sm" className="shrink-0 border-amber-300 bg-white text-amber-950 hover:bg-amber-50" onClick={() => setShowCapacity(true)}>Request capacity <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Button>}
          </AlertDescription>
        </Alert>
      )}
      {pendingCapacityRequest && (
        <Alert className="border-amber-200 bg-[#fff9ed] text-[#574525]">
          <Clock3 className="h-4 w-4 text-amber-800" />
          <AlertTitle>Capacity request pending review</AlertTitle>
          <AlertDescription>
            Your request for {pendingCapacityRequest.additionalUsers} additional user(s) has a quote of {currency(pendingCapacityRequest.amountInr)}. It does not add capacity or authorize payment.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">People in this workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">Search accounts and review access or subscription status.</p>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search users" data-testid="input-search-users" className="h-10 bg-card pl-9" placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <Card className="overflow-hidden rounded-xl border-[#dce5df] shadow-sm">
        {isLoading ? (
          <CardContent className="space-y-3 p-5" aria-label="Loading users">
            {[0, 1, 2, 3].map((i) => <div key={i} className="flex animate-pulse items-center gap-4 rounded-lg border border-border/60 p-4"><div className="h-10 w-10 rounded-full bg-muted" /><div className="flex-1 space-y-2"><div className="h-3 w-36 rounded bg-muted" /><div className="h-2.5 w-52 max-w-full rounded bg-muted" /></div><div className="h-6 w-20 rounded-full bg-muted" /></div>)}
          </CardContent>
        ) : isError ? (
          <CardContent className="flex flex-col items-center px-6 py-14 text-center">
            <div className="mb-3 rounded-xl bg-rose-50 p-3 text-rose-700"><CircleAlert className="h-6 w-6" /></div>
            <p className="font-semibold">Users could not be loaded</p><p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
            <Button className="mt-4" variant="outline" onClick={() => void refetch()}>Retry</Button>
          </CardContent>
        ) : filtered.length === 0 ? (
          <CardContent className="flex flex-col items-center px-6 py-16 text-center">
            <div className="mb-4 rounded-2xl bg-[#edf4eb] p-4 text-[#37664a]"><Users className="h-7 w-7" /></div>
            <p className="font-semibold">{search ? "No matching users" : "Your workspace is ready for its first user"}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">{search ? "Try a different name or email address." : "Create a user to give your team access to billing and inventory."}</p>
            {!search && <Button className="mt-5 gap-2" onClick={() => setShowCreate(true)}><UserPlus className="h-4 w-4" /> Add first user</Button>}
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead><tr className="border-b bg-[#f4f7f3] text-[11px] uppercase tracking-[.11em] text-muted-foreground">
                <th className="px-5 py-3 text-left font-semibold">User</th><th className="px-4 py-3 text-left font-semibold">Role</th><th className="px-4 py-3 text-center font-semibold">Access</th><th className="px-4 py-3 text-center font-semibold">Subscription</th><th className="px-4 py-3 text-left font-semibold">Subscription end</th><th className="px-4 py-3 text-left font-semibold">Added</th><th className="px-4 py-3 text-right font-semibold">Profile</th>
              </tr></thead>
              <tbody>{filtered.map((u) => (
                <tr key={u.id} data-testid={`row-user-${u.id}`} className="border-b last:border-0 transition-colors hover:bg-[#f7faf7]">
                  <td className="px-5 py-3.5"><div className="flex items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e6eee4] text-xs font-bold text-[#315644]">{u.name.split(/\s+/).map((n) => n[0]).slice(0, 2).join("").toUpperCase()}</div><div><div className="font-semibold text-foreground">{u.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{u.email}</div></div></div></td>
                  <td className="px-4 py-3.5"><span className="rounded-md bg-[#eef2ed] px-2 py-1 text-xs font-medium capitalize text-[#53675a]">{u.role}</span></td>
                  <td className="px-4 py-3.5 text-center"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${u.isActive ? "text-emerald-700" : "text-rose-700"}`}><span className={`h-1.5 w-1.5 rounded-full ${u.isActive ? "bg-emerald-600" : "bg-rose-600"}`} />{u.isActive ? "Active" : "Inactive"}</span></td>
                  <td className="px-4 py-3.5 text-center"><span className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusBadge(u.subscriptionStatus ?? "")}`}>{u.subscriptionStatus || "—"}</span></td>
                  <td className="px-4 py-3.5 text-xs text-muted-foreground">{formatDate(u.subscriptionEnd)}</td>
                  <td className="px-4 py-3.5 text-xs text-muted-foreground">{formatDate(u.createdAt)}</td>
                  <td className="px-4 py-3.5 text-right"><Link href={`/admin/users/${u.id}`} data-testid={`link-user-profile-${u.id}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/5">View <ChevronRight className="h-3.5 w-3.5" /></Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#10251f]/45 p-4" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
          <Card className="w-full max-w-lg overflow-hidden rounded-2xl border-[#dce5df] shadow-2xl">
            <div className="border-b bg-[#f5f8f3] px-6 py-5"><div className="flex items-center gap-3"><div className="rounded-lg bg-[#e5efe1] p-2 text-[#315644]"><UserPlus className="h-5 w-5" /></div><div><h2 id="create-user-title" className="font-semibold">Create workspace user</h2><p className="text-xs text-muted-foreground">This account will belong to your business only.</p></div></div></div>
            <CardContent className="p-6">
              <form className="space-y-4" onSubmit={submitUser}>
                <div className="space-y-1.5"><Label htmlFor="new-user-name">Full name</Label><Input id="new-user-name" data-testid="input-new-user-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" required /></div>
                <div className="space-y-1.5"><Label htmlFor="new-user-email">Email address</Label><Input id="new-user-email" data-testid="input-new-user-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required /></div>
                <div className="space-y-1.5"><Label htmlFor="new-user-password">Temporary password</Label><Input id="new-user-password" data-testid="input-new-user-password" type="password" minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" required /><p className="text-xs text-muted-foreground">Use at least 12 characters.</p></div>
                {createError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{createError}</p>}
                <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" disabled={pending} data-testid="button-create-user">{createUser.isPending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}{createUser.isPending ? "Creating…" : "Create user"}</Button></div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {showCapacity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#10251f]/45 p-4" role="dialog" aria-modal="true" aria-labelledby="capacity-title">
          <Card className="w-full max-w-md overflow-hidden rounded-2xl border-[#dce5df] shadow-2xl">
            <div className="border-b bg-[#f5f8f3] px-6 py-5"><div className="flex items-center gap-3"><div className="rounded-lg bg-amber-100 p-2 text-amber-800"><ArrowUpRight className="h-5 w-5" /></div><div><h2 id="capacity-title" className="font-semibold">Request more capacity</h2><p className="text-xs text-muted-foreground">For your workspace, submitted for review.</p></div></div></div>
            <CardContent className="space-y-4 p-6">
                <div className="rounded-xl border border-amber-200 bg-[#fff9ed] p-4"><div className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" /><div className="text-sm text-[#574525]"><p className="font-semibold">Fixed quote: {currency(1000)} per additional user</p><p className="mt-1 text-xs leading-5">Submitting is a capacity request only. It does not initiate payment, grant capacity, or bypass review.</p></div></div></div>
                {pendingCapacityRequest
                  ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">A request for {pendingCapacityRequest.additionalUsers} additional user(s) is already pending review.</p>
                  : <form className="space-y-4" onSubmit={submitCapacity}>
                <div className="space-y-1.5"><Label htmlFor="additional-users">Additional users requested</Label><Input id="additional-users" data-testid="input-capacity-count" type="number" min="1" max="100000" step="1" value={capacityCount} onChange={(e) => setCapacityCount(e.target.value)} required /></div>
                <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2.5 text-sm"><span className="text-muted-foreground">Quoted amount</span><strong className="tabular-nums">{currency((Number(capacityCount) || 0) * 1000)}</strong></div>
                {capacityError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{capacityError}</p>}
                <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={() => setShowCapacity(false)}>Cancel</Button><Button type="submit" disabled={requestCapacity.isPending} data-testid="button-submit-capacity">{requestCapacity.isPending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}{requestCapacity.isPending ? "Submitting…" : "Submit request"}</Button></div>
                  </form>}
            </CardContent>
          </Card>
        </div>
      )}
      {capacitySuccess && <div role="status" className="fixed bottom-5 right-5 z-40 max-w-md rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-900 shadow-xl"><div className="flex gap-2"><CircleCheck className="h-4 w-4 shrink-0 text-emerald-700" />{capacitySuccess}</div></div>}
    </div>
  );
}