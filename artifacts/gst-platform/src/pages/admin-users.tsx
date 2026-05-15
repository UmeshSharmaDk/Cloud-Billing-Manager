import { useState } from "react";
import { useListUsers, useUpdateUser } from "@workspace/api-client-react";
import { formatDate, statusBadge } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Users, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

function EditUserDialog({ user, open, onClose, onSaved }: { user: any; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ isActive: user?.isActive, subscriptionStatus: user?.subscriptionStatus, subscriptionEnd: user?.subscriptionEnd?.slice(0, 10) || "" });
  const mutation = useUpdateUser();
  const { toast } = useToast();

  const handleSave = () => {
    mutation.mutate({ id: user.id, data: form as any }, {
      onSuccess: () => { toast({ title: "User updated" }); onClose(); onSaved(); },
      onError: () => toast({ title: "Update failed", variant: "destructive" }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit User: {user?.name}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={String(form.isActive)} onValueChange={(v) => setForm(f => ({ ...f, isActive: v === "true" }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Subscription Plan</Label>
            <Select value={form.subscriptionStatus} onValueChange={(v) => setForm(f => ({ ...f, subscriptionStatus: v }))}>
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
            <Input type="date" value={form.subscriptionEnd} onChange={(e) => setForm(f => ({ ...f, subscriptionEnd: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={mutation.isPending}>{mutation.isPending ? "Saving..." : "Save Changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const { data, isLoading, refetch } = useListUsers();
  const users: any[] = (data as any)?.users || (Array.isArray(data) ? data : []);

  const filtered = users.filter(u =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="w-6 h-6 text-primary" /> User Management</h1>
        <p className="text-muted-foreground text-sm">Manage platform users and subscriptions</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by name or email..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        {isLoading ? (
          <CardContent className="p-6 space-y-3 animate-pulse">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg" />)}</CardContent>
        ) : filtered.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="font-medium">No users found</p>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">User</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Role</th>
                  <th className="text-center py-3 px-4 font-semibold text-muted-foreground">Status</th>
                  <th className="text-center py-3 px-4 font-semibold text-muted-foreground">Subscription</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Sub. End</th>
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground">Registered</th>
                  <th className="text-center py-3 px-4 font-semibold text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u: any) => (
                  <tr key={u.id} className="border-b last:border-0 hover:bg-accent/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${u.role === "admin" ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-700"}`}>{u.role}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.isActive ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{u.isActive ? "Active" : "Inactive"}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusBadge(u.subscriptionStatus)}`}>{u.subscriptionStatus}</span>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">{formatDate(u.subscriptionEnd)}</td>
                    <td className="py-3 px-4 text-muted-foreground text-xs">{formatDate(u.createdAt)}</td>
                    <td className="py-3 px-4 text-center">
                      {u.role !== "admin" && (
                        <Button variant="outline" size="sm" onClick={() => setSelectedUser(u)}>Edit</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedUser && (
        <EditUserDialog user={selectedUser} open={!!selectedUser} onClose={() => setSelectedUser(null)} onSaved={() => { refetch(); setSelectedUser(null); }} />
      )}
    </div>
  );
}
