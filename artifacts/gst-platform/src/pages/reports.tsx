import { useState } from "react";
import { useGetGstr1Report, useGetGstr3bReport, useGetHsnReport } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function parseMonth(monthStr: string) {
  const [year, month] = monthStr.split("-").map(Number);
  return { month, year };
}

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function ReportsPage() {
  const [month, setMonth] = useState(getCurrentMonth());
  const range = parseMonth(month);
  const monthLabel = new Date(month + "-01").toLocaleString("default", { month: "long", year: "numeric" });

  const { data: gstr1Data, isLoading: g1Loading } = useGetGstr1Report(range);
  const { data: gstr3bData, isLoading: g3bLoading } = useGetGstr3bReport(range);
  const { data: hsnData, isLoading: hsnLoading } = useGetHsnReport(range);

  const gstr1: any = gstr1Data || {};
  const gstr3b: any = gstr3bData || {};
  const hsn: any = hsnData || {};
  const hsnItems: any[] = hsn.items || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">GST Reports</h1>
          <p className="text-muted-foreground text-sm">Generate GSTR-1, GSTR-3B, HSN Summary and other compliance reports</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="month" className="text-sm font-medium whitespace-nowrap">Select Month:</Label>
          <Input id="month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
        </div>
      </div>

      <Tabs defaultValue="gstr1">
        <TabsList className="grid grid-cols-3 w-full max-w-lg">
          <TabsTrigger value="gstr1">GSTR-1</TabsTrigger>
          <TabsTrigger value="gstr3b">GSTR-3B</TabsTrigger>
          <TabsTrigger value="hsn">HSN Summary</TabsTrigger>
        </TabsList>

        {/* ─── GSTR-1 ─── */}
        <TabsContent value="gstr1" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">GSTR-1 Report</h2>
              <p className="text-sm text-muted-foreground">Outward supplies (Sales) for {monthLabel}</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
              <FileDown className="w-4 h-4" /> Export
            </Button>
          </div>

          {g1Loading ? (
            <div className="space-y-3 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl" />)}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium">Total Invoices</p><p className="text-2xl font-bold mt-1">{gstr1.totalInvoices || 0}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium">Taxable Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(gstr1.totalTaxable)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium">Total GST</p><p className="text-2xl font-bold mt-1 text-primary">{formatCurrency(gstr1.totalGst)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium">Invoice Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(gstr1.totalAmount)}</p></CardContent></Card>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="border-blue-200 bg-blue-50/40">
                  <CardContent className="p-4">
                    <p className="text-sm font-semibold text-blue-800 mb-3">Intra-State (CGST + SGST)</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">No. of Invoices</span><span className="font-medium">{gstr1.intraStateCount || 0}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Taxable Value</span><span className="font-medium">{formatCurrency(gstr1.intraStateTaxable)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="font-medium">{formatCurrency(gstr1.totalCgst)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="font-medium">{formatCurrency(gstr1.totalSgst)}</span></div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-violet-200 bg-violet-50/40">
                  <CardContent className="p-4">
                    <p className="text-sm font-semibold text-violet-800 mb-3">Inter-State (IGST)</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">No. of Invoices</span><span className="font-medium">{gstr1.interStateCount || 0}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Taxable Value</span><span className="font-medium">{formatCurrency(gstr1.interStateTaxable)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="font-medium">{formatCurrency(gstr1.totalIgst)}</span></div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm font-semibold mb-3">By GST Rate</p>
                    <div className="space-y-1 text-sm">
                      {(gstr1.byRate || []).map((r: any) => (
                        <div key={r.rate} className="flex justify-between">
                          <span className="text-muted-foreground">{r.rate}% GST</span>
                          <span className="font-medium">{formatCurrency(r.taxable)}</span>
                        </div>
                      ))}
                      {(!gstr1.byRate || gstr1.byRate.length === 0) && <p className="text-muted-foreground text-xs">No data for this period</p>}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {gstr1.invoices && gstr1.invoices.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">B2B Invoice Details</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Invoice #</th>
                            <th className="text-left py-2 px-4 font-semibold text-muted-foreground">Customer GSTIN</th>
                            <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Taxable</th>
                            <th className="text-right py-2 px-4 font-semibold text-muted-foreground">CGST</th>
                            <th className="text-right py-2 px-4 font-semibold text-muted-foreground">SGST</th>
                            <th className="text-right py-2 px-4 font-semibold text-muted-foreground">IGST</th>
                            <th className="text-right py-2 px-4 font-semibold text-muted-foreground">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gstr1.invoices.map((inv: any) => (
                            <tr key={inv.id} className="border-b last:border-0 hover:bg-accent/40">
                              <td className="py-2 px-4 font-mono text-xs">{inv.invoiceNumber}</td>
                              <td className="py-2 px-4 font-mono text-xs">{inv.customerGstin || "B2C"}</td>
                              <td className="py-2 px-4 text-right">{formatCurrency(inv.taxableAmount)}</td>
                              <td className="py-2 px-4 text-right">{formatCurrency(inv.cgst)}</td>
                              <td className="py-2 px-4 text-right">{formatCurrency(inv.sgst)}</td>
                              <td className="py-2 px-4 text-right">{formatCurrency(inv.igst)}</td>
                              <td className="py-2 px-4 text-right font-semibold">{formatCurrency(inv.totalAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ─── GSTR-3B ─── */}
        <TabsContent value="gstr3b" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">GSTR-3B Summary</h2>
              <p className="text-sm text-muted-foreground">Monthly self-assessment for {monthLabel}</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
              <FileDown className="w-4 h-4" /> Export
            </Button>
          </div>

          {g3bLoading ? (
            <div className="space-y-3 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl" />)}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base text-emerald-700">3.1 — Outward Supplies (Sales)</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">Total Taxable Value</span><span className="font-semibold">{formatCurrency(gstr3b.outwardTaxable)}</span></div>
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">IGST</span><span className="font-semibold">{formatCurrency(gstr3b.outwardIgst)}</span></div>
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">CGST</span><span className="font-semibold">{formatCurrency(gstr3b.outwardCgst)}</span></div>
                  <div className="flex justify-between py-1"><span className="text-muted-foreground">SGST / UTGST</span><span className="font-semibold">{formatCurrency(gstr3b.outwardSgst)}</span></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base text-blue-700">4 — Eligible Input Tax Credit (ITC)</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">IGST (from purchases)</span><span className="font-semibold">{formatCurrency(gstr3b.inputIgst)}</span></div>
                  <div className="flex justify-between py-1 border-b"><span className="text-muted-foreground">CGST (from purchases)</span><span className="font-semibold">{formatCurrency(gstr3b.inputCgst)}</span></div>
                  <div className="flex justify-between py-1"><span className="text-muted-foreground">SGST / UTGST</span><span className="font-semibold">{formatCurrency(gstr3b.inputSgst)}</span></div>
                </CardContent>
              </Card>

              <Card className="md:col-span-2 border-primary/30 bg-primary/5">
                <CardHeader className="pb-2"><CardTitle className="text-base text-primary">6 — Net GST Payable</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-center"><p className="text-muted-foreground">IGST Payable</p><p className="text-xl font-bold text-primary mt-1">{formatCurrency(gstr3b.netIgst)}</p></div>
                  <div className="text-center"><p className="text-muted-foreground">CGST Payable</p><p className="text-xl font-bold text-primary mt-1">{formatCurrency(gstr3b.netCgst)}</p></div>
                  <div className="text-center"><p className="text-muted-foreground">SGST Payable</p><p className="text-xl font-bold text-primary mt-1">{formatCurrency(gstr3b.netSgst)}</p></div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ─── HSN Summary ─── */}
        <TabsContent value="hsn" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">HSN-wise Summary</h2>
              <p className="text-sm text-muted-foreground">Table 12 — Consolidated HSN summary of outward supplies for {monthLabel}</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
              <FileDown className="w-4 h-4" /> Export
            </Button>
          </div>

          {hsnLoading ? (
            <div className="space-y-3 animate-pulse">{[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-muted rounded-xl" />)}</div>
          ) : hsnItems.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <p className="text-base font-medium">No invoice data for {monthLabel}</p>
                <p className="text-sm mt-1">Create invoices for this month to see the HSN summary.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium">HSN Codes</p><p className="text-2xl font-bold mt-1">{hsnItems.length}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium">Total Taxable Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(hsnItems.reduce((s: number, r: any) => s + r.taxableValue, 0))}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium">Total Tax</p><p className="text-2xl font-bold mt-1 text-primary">{formatCurrency(hsnItems.reduce((s: number, r: any) => s + r.totalTax, 0))}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground font-medium">Total Invoice Value</p><p className="text-2xl font-bold mt-1">{formatCurrency(hsnItems.reduce((s: number, r: any) => s + r.taxableValue + r.totalTax, 0))}</p></CardContent></Card>
              </div>

              {/* HSN Table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">HSN-wise Breakup</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30 text-muted-foreground text-xs">
                          <th className="text-left py-2.5 px-4 font-semibold">HSN / SAC</th>
                          <th className="text-left py-2.5 px-4 font-semibold">Description</th>
                          <th className="text-center py-2.5 px-3 font-semibold">UQC</th>
                          <th className="text-right py-2.5 px-3 font-semibold">Total Qty</th>
                          <th className="text-right py-2.5 px-4 font-semibold">Taxable Value</th>
                          <th className="text-right py-2.5 px-3 font-semibold">CGST</th>
                          <th className="text-right py-2.5 px-3 font-semibold">SGST / UTGST</th>
                          <th className="text-right py-2.5 px-3 font-semibold">IGST</th>
                          <th className="text-right py-2.5 px-4 font-semibold">Total Tax</th>
                        </tr>
                      </thead>
                      <tbody>
                        {hsnItems.map((row: any, i: number) => (
                          <tr key={i} className="border-b last:border-0 hover:bg-accent/40">
                            <td className="py-2 px-4 font-mono text-xs font-semibold">{row.hsnCode}</td>
                            <td className="py-2 px-4 text-xs max-w-[200px] truncate" title={row.description}>{row.description || "-"}</td>
                            <td className="py-2 px-3 text-center text-xs text-muted-foreground">{row.uqc}</td>
                            <td className="py-2 px-3 text-right">{row.quantity}</td>
                            <td className="py-2 px-4 text-right font-medium">{formatCurrency(row.taxableValue)}</td>
                            <td className="py-2 px-3 text-right text-blue-600">{formatCurrency(row.cgst)}</td>
                            <td className="py-2 px-3 text-right text-blue-600">{formatCurrency(row.sgst)}</td>
                            <td className="py-2 px-3 text-right text-violet-600">{formatCurrency(row.igst)}</td>
                            <td className="py-2 px-4 text-right font-semibold text-primary">{formatCurrency(row.totalTax)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 bg-muted/20 font-semibold text-sm">
                          <td className="py-2 px-4" colSpan={3}>Total</td>
                          <td className="py-2 px-3 text-right">{hsnItems.reduce((s: number, r: any) => s + r.quantity, 0).toFixed(2)}</td>
                          <td className="py-2 px-4 text-right">{formatCurrency(hsnItems.reduce((s: number, r: any) => s + r.taxableValue, 0))}</td>
                          <td className="py-2 px-3 text-right text-blue-600">{formatCurrency(hsnItems.reduce((s: number, r: any) => s + r.cgst, 0))}</td>
                          <td className="py-2 px-3 text-right text-blue-600">{formatCurrency(hsnItems.reduce((s: number, r: any) => s + r.sgst, 0))}</td>
                          <td className="py-2 px-3 text-right text-violet-600">{formatCurrency(hsnItems.reduce((s: number, r: any) => s + r.igst, 0))}</td>
                          <td className="py-2 px-4 text-right text-primary">{formatCurrency(hsnItems.reduce((s: number, r: any) => s + r.totalTax, 0))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
