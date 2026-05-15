import { useState } from "react";
import { Link } from "wouter";
import { useListVendors } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search, Building2, Phone, Mail } from "lucide-react";

export default function VendorsPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useListVendors();
  const vendors: any[] = (data as any)?.vendors || (Array.isArray(data) ? data : []);

  const filtered = vendors.filter(v =>
    v.name?.toLowerCase().includes(search.toLowerCase()) ||
    v.gstin?.toLowerCase().includes(search.toLowerCase()) ||
    v.phone?.includes(search)
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vendors / Suppliers</h1>
          <p className="text-muted-foreground text-sm">Manage your suppliers and purchase accounts</p>
        </div>
        <Link href="/vendors/new">
          <Button className="gap-2"><Plus className="w-4 h-4" /> Add Vendor</Button>
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by name, GSTIN, phone..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 animate-pulse">
          {[...Array(6)].map((_, i) => <div key={i} className="h-36 bg-muted rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="font-medium">No vendors found</p>
            <p className="text-sm text-muted-foreground mb-4">Add your first vendor/supplier</p>
            <Link href="/vendors/new"><Button className="gap-2"><Plus className="w-4 h-4" /> Add Vendor</Button></Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((v: any) => (
            <Link key={v.id} href={`/vendors/${v.id}`}>
              <Card className="hover:border-primary/40 hover:shadow-md transition-all cursor-pointer">
                <CardContent className="p-5">
                  <div className="mb-3">
                    <h3 className="font-semibold text-foreground">{v.name}</h3>
                    {v.gstin && <p className="text-xs text-muted-foreground font-mono">{v.gstin}</p>}
                  </div>
                  <div className="space-y-1.5">
                    {v.phone && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Phone className="w-3.5 h-3.5" /> {v.phone}</div>}
                    {v.email && <div className="flex items-center gap-2 text-sm text-muted-foreground truncate"><Mail className="w-3.5 h-3.5" /><span className="truncate">{v.email}</span></div>}
                    {v.city && <div className="text-sm text-muted-foreground">{v.city}, {v.state}</div>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
