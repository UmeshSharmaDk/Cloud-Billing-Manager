import { useRoute, useLocation } from "wouter";
import { useGetUser, useUpdateUser, useToggleUserStatus } from "@workspace/api-client-react";
import { formatDate, statusBadge, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Building2, FileText, ShoppingCart, Users, Package, Edit2, Save, UserCheck, UserX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { ConfirmPasswordDialog } from "@/components/ConfirmPasswordDialog";

export default function AdminUserDetailPage() {
  const [, params] = useRoute("/admin/users/:id");
  const [, setLocation] = useLocation();
  const userId = parseInt(params?.id || "0");

  const { data, isLoading, refetch } = useGetUser(userId);
  const updateMutation = useUpdateUser();
  const toggleMutation = useToggleUserStatus();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  const user: any = data || {};
  const biz: any = user.business || {};
  const bizStats: any = user.stats || {};

  useEffect(() => {
    if (user.id) {
      setForm({
        subscriptionStatus: user.subscriptionStatus || "trial",
        subscriptionEnd: user.subscriptionEnd?.slice(0, 10) || "",
        role: user.role || "user",
      });
    }
  }, [user.id]);

  const [confirmOpen, setConfirmOpen] = useState(false);

  /**
   * Send only what the administrator actually changed. Posting the whole
   * record meant every save carried the (unchanged) role, and the API treats a
   * role change as a privileged action — so a subscription edit was being
   * refused for want of a password confirmation it never asked for.
   */
  const changedFields = () => {
    const changed: Record<string, unknown> = {};
    if (form.role !== user.role) changed.role = form.role;
    if (form.subscriptionStatus !== (user.subscriptionStatus || "trial")) {
      changed.subscriptionStatus = form.subscriptionStatus;
    }
    if (form.subscriptionEnd !== (user.subscriptionEnd?.slice(0, 10) || "")) {
      changed.subscriptionEnd = form.subscriptionEnd;
    }
    return changed;
  };

  const submit = (changed: Record<string, unknown>, confirmPassword?: string) => {
    updateMutation.mutate(
      { id: userId, data: { ...changed, ...(confirmPassword ? { confirmPassword } : {}) } as any },
      {
        onSuccess: () => {
          toast({ title: "User updated" });
          setConfirmOpen(false);
          setEditing(false);
          refetch();
        },
        onError: (err: any) => {
          // The API asks for confirmation when an action turns out to need it.
          if (err?.data?.code === "step_up_required") {
            setConfirmOpen(true);
            return;
          }
          toast({
            title: "Update failed",
            description: err?.data?.error ?? "Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleSave = () => {
    const changed = changedFields();
    if (Object.keys(changed).length === 0) {
      toast({ title: "Nothing to update" });
      setEditing(false);
      return;
    }
    // A role change needs the administrator's own password; nothing else does.
    if ("role" in changed) {
      setConfirmOpen(true);
      return;
    }
    submit(changed);
  };

  const handleToggleActive = () => {
    toggleMutation.mutate({ id: userId, data: { isActive: !user.isActive } as any }, {
      onSuccess: () => { toast({ title: user.isActive ? "User deactivated" : "User activated" }); refetch(); },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    });
  };

  if (isLoading) return (
    <div className="space-y-4 animate-pulse">{[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}</div>
  );

  if (!user.id) return (
    <div className="text-center py-16">
      <p className="text-muted-foreground">User not found</p>
      <Button variant="outline" className="mt-4" onClick={() => setLocation("/admin/users")}>Back to Users</Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <ConfirmPasswordDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm this role change"
        description={`Changing ${user.name || "this user"}'s role to "${form.role}" grants or removes platform access. Enter your own password to continue.`}
        confirmLabel="Change role"
        pending={updateMutation.isPending}
        onConfirm={(password) => submit(changedFields(), password)}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/admin/users")}><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold">{user.name}</h1>
            <p className="text-muted-foreground text-sm">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm px-3 py-1 rounded-full border font-medium ${statusBadge(user.subscriptionStatus)}`}>{user.subscriptionStatus}</span>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${user.isActive ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{user.isActive ? "Active" : "Inactive"}</span>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleToggleActive} disabled={toggleMutation.isPending}>
            {user.isActive ? <><UserX className="w-3.5 h-3.5" /> Deactivate</> : <><UserCheck className="w-3.5 h-3.5" /> Activate</>}
          </Button>
          {!editing ? (
            <Button variant="outline" size="sm" className="gap-1" onClick={() => setEditing(true)}><Edit2 className="w-3.5 h-3.5" /> Edit</Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" className="gap-1" onClick={handleSave} disabled={updateMutation.isPending}><Save className="w-3.5 h-3.5" /> Save</Button>
            </>
          )}
        </div>
      </div>

      {/* Business Stats */}
      {user.businessId && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Invoices", value: bizStats.invoiceCount || 0, icon: FileText, color: "blue" },
            { label: "Purchases", value: bizStats.purchaseCount || 0, icon: ShoppingCart, color: "amber" },
            { label: "Customers", value: bizStats.customerCount || 0, icon: Users, color: "emerald" },
            { label: "Vendors", value: bizStats.vendorCount || 0, icon: Building2, color: "indigo" },
            { label: "Products", value: bizStats.productCount || 0, icon: Package, color: "violet" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-${color}-100`}><Icon className={`w-4 h-4 text-${color}-600`} /></div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xl font-bold">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* User Account */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Account Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {editing ? (
              <>
                <div className="space-y-2">
                  <Label>Subscription Plan</Label>
                  <Select value={form.subscriptionStatus} onValueChange={(v) => setForm((f: any) => ({ ...f, subscriptionStatus: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trial">Trial</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Subscription End Date</Label>
                  <Input type="date" value={form.subscriptionEnd} onChange={(e) => setForm((f: any) => ({ ...f, subscriptionEnd: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={form.role} onValueChange={(v) => setForm((f: any) => ({ ...f, role: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-muted-foreground">Role</p><p className="font-medium capitalize">{user.role}</p></div>
                <div><p className="text-xs text-muted-foreground">Account Status</p><p className={`font-medium ${user.isActive ? "text-emerald-600" : "text-red-600"}`}>{user.isActive ? "Active" : "Inactive"}</p></div>
                <div><p className="text-xs text-muted-foreground">Subscription</p><p className="font-medium capitalize">{user.subscriptionStatus}</p></div>
                <div><p className="text-xs text-muted-foreground">Sub. End</p><p className="font-medium">{formatDate(user.subscriptionEnd)}</p></div>
                <div><p className="text-xs text-muted-foreground">Registered</p><p className="font-medium">{formatDate(user.createdAt)}</p></div>
                <div><p className="text-xs text-muted-foreground">Business ID</p><p className="font-medium">{user.businessId || "None"}</p></div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Business Info */}
        {biz.id && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" /> Business Profile</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="col-span-2"><p className="text-xs text-muted-foreground">Business Name</p><p className="font-semibold text-base">{biz.name}</p></div>
                {biz.gstin && <div><p className="text-xs text-muted-foreground">GSTIN</p><p className="font-mono text-xs">{biz.gstin}</p></div>}
                {biz.pan && <div><p className="text-xs text-muted-foreground">PAN</p><p className="font-mono text-xs">{biz.pan}</p></div>}
                {biz.phone && <div><p className="text-xs text-muted-foreground">Phone</p><p className="font-medium">{biz.phone}</p></div>}
                {biz.email && <div><p className="text-xs text-muted-foreground">Email</p><p className="font-medium">{biz.email}</p></div>}
                {biz.city && <div><p className="text-xs text-muted-foreground">Location</p><p className="font-medium">{biz.city}, {biz.state}</p></div>}
                {biz.bankName && <div className="col-span-2"><p className="text-xs text-muted-foreground">Bank</p><p className="font-medium">{biz.bankName} — {biz.bankIfsc}</p></div>}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
