import { useState } from "react";
import { Link } from "wouter";
import { useListCustomers } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search, Users, Phone, Mail } from "lucide-react";

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useListCustomers();
  const customers: any[] = (data as any)?.customers || (Array.isArray(data) ? data : []);

  const filtered = customers.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.gstin?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="text-muted-foreground text-sm">Manage your customer accounts and receivables</p>
        </div>
        <Link href="/customers/new">
          <Button className="gap-2"><Plus className="w-4 h-4" /> Add Customer</Button>
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by name, GSTIN, phone..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 animate-pulse">
          {[...Array(6)].map((_, i) => <div key={i} className="h-40 bg-muted rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="font-medium">No customers found</p>
            <p className="text-sm text-muted-foreground mb-4">Add your first customer to get started</p>
            <Link href="/customers/new"><Button className="gap-2"><Plus className="w-4 h-4" /> Add Customer</Button></Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c: any) => (
            <Link key={c.id} href={`/customers/${c.id}`}>
              <Card className="hover:border-primary/40 hover:shadow-md transition-all cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{c.name}</h3>
                      {c.gstin && <p className="text-xs text-muted-foreground font-mono">{c.gstin}</p>}
                    </div>
                    {c.outstandingBalance > 0 && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium whitespace-nowrap">Due</span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {c.phone && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Phone className="w-3.5 h-3.5" /> {c.phone}</div>}
                    {c.email && <div className="flex items-center gap-2 text-sm text-muted-foreground truncate"><Mail className="w-3.5 h-3.5" /><span className="truncate">{c.email}</span></div>}
                    {c.city && <div className="text-sm text-muted-foreground">{c.city}, {c.state}</div>}
                  </div>
                  {c.outstandingBalance > 0 && (
                    <div className="mt-3 pt-3 border-t border-border flex justify-between text-sm">
                      <span className="text-muted-foreground">Outstanding</span>
                      <span className="font-semibold text-red-600">{formatCurrency(c.outstandingBalance)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
