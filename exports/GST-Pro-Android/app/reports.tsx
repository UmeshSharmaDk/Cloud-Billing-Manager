import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import * as XLSX from "xlsx";
import { api, apiDownload, viewAs } from "@/lib/api";
import { parseGstr2b, reconcile, type BookBill, type Row as MatchRow } from "@/lib/gstr2b";
import { date, money } from "@/lib/format";
import type { Invoice } from "@/lib/types";
import { Button, Card, Chips, colors, ErrorView, Loading, Row, s, pullToRefresh } from "@/lib/ui";

const KINDS = ["GSTR-1", "GSTR-3B", "HSN", "TDS", "TCS", "GSTR-2B match"] as const;
type R = Record<string, number> & { invoices?: Invoice[]; items?: Record<string, string | number>[]; entries?: Record<string, any>[]; sections?: Record<string, any>[] };

export default function Reports() {
  const { asUser, name } = useLocalSearchParams<{ asUser?: string; name?: string }>();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("GSTR-1");
  const [at, setAt] = useState(() => { const d = new Date(); return { month: d.getMonth() + 1, year: d.getFullYear() }; });
  const step = (n: number) => setAt(({ month, year }) => { const d = new Date(year, month - 1 + n, 1); return { month: d.getMonth() + 1, year: d.getFullYear() }; });
  const path = viewAs(`/reports/${kind.toLowerCase().replace("-", "")}?month=${at.month}&year=${at.year}`, asUser);
  const matching = kind === "GSTR-2B match"; // worked out on the phone, not a server report
  const q = useQuery({ queryKey: [path], queryFn: () => api<R>(path), enabled: !matching });
  const ym = `${at.year}-${String(at.month).padStart(2, "0")}`;
  const [sharing, setSharing] = useState("");
  const share = async (what: string, make: () => Promise<string>, mimeType: string) => {
    setSharing(what);
    try {
      await Sharing.shareAsync(await make(), { mimeType, dialogTitle: what });
    } catch (e) {
      Alert.alert("Could not create the file", e instanceof Error ? e.message : String(e));
    } finally {
      setSharing("");
    }
  };
  const excel = async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet((d?.invoices ?? []).map((i) => ({
      "Invoice no.": i.invoiceNumber, Date: i.invoiceDate, Type: i.type, Customer: i.customerName, GSTIN: i.customerGstin ?? "",
      "Place of supply": i.placeOfSupply ?? "", Taxable: Number(i.subtotal), CGST: Number(i.cgst ?? 0), SGST: Number(i.sgst ?? 0), IGST: Number(i.igst ?? 0), Total: Number(i.grandTotal),
    }))), "Invoices");
    const uri = `${FileSystem.cacheDirectory}GSTR-1_${ym}.xlsx`;
    await FileSystem.writeAsStringAsync(uri, XLSX.write(book, { type: "base64", bookType: "xlsx" }), { encoding: FileSystem.EncodingType.Base64 });
    return uri;
  };
  const label = new Date(at.year, at.month - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const d = q.data;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }} refreshControl={pullToRefresh(q)}>
      <Stack.Screen options={{ title: name ? `${name} · reports` : "GST reports" }} />
      <Chips options={KINDS} value={kind} onChange={setKind} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}><Button title="‹ Prev" variant="outline" onPress={() => step(-1)} /></View>
        <Text style={[s.title, { flex: 2, textAlign: "center" }]}>{label}</Text>
        <View style={{ flex: 1 }}><Button title="Next ›" variant="outline" onPress={() => step(1)} /></View>
      </View>
      {matching ? <Gstr2bMatch month={ym} label={label} /> : q.isLoading ? <Card><Loading layout="rows" /></Card> : q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : d && (
        <>
          {kind === "GSTR-1" && (
            <Card title="Outward supplies">
              <Row label="Invoices" value={String(d.totalInvoices ?? 0)} />
              <Row label="Taxable value" value={money(d.totalTaxableValue)} />
              <Row label="CGST" value={money(d.totalCgst)} />
              <Row label="SGST" value={money(d.totalSgst)} />
              <Row label="IGST" value={money(d.totalIgst)} />
              <Row label="Total tax" value={money(d.totalTax)} />
              <Row label={`Intra-state (${d.intraStateCount ?? 0})`} value={money(d.intraStateTaxable)} />
              <Row label={`Inter-state (${d.interStateCount ?? 0})`} value={money(d.interStateTaxable)} />
              <Button title="Share GSTR-1 file for the GST portal" busy={sharing === "json"}
                onPress={() => share("json", () => apiDownload(viewAs(`/reports/gstr1/json?month=${at.month}&year=${at.year}`, asUser), `GSTR1_${ym}.json`), "application/json")} />
              <Button title="Share as Excel" variant="outline" busy={sharing === "xlsx"}
                onPress={() => share("xlsx", excel, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")} />
              <Button title="Share Tally vouchers (XML)" variant="outline" busy={sharing === "tally"}
                onPress={() => share("tally", () => apiDownload(viewAs(`/reports/tally?month=${at.month}&year=${at.year}`, asUser), `Tally_${ym}.xml`), "application/xml")} />
            </Card>
          )}
          {kind === "GSTR-3B" && (
            <>
              <Card title="3.1 Outward supplies">
                <Row label="Taxable value" value={money(d.outwardTaxable)} />
                <Row label="CGST / SGST" value={`${money(d.outwardCgst)} / ${money(d.outwardSgst)}`} />
                <Row label="IGST" value={money(d.outwardIgst)} />
              </Card>
              <Card title="4 Input tax credit">
                <Row label="CGST / SGST" value={`${money(d.inputCgst)} / ${money(d.inputSgst)}`} />
                <Row label="IGST" value={money(d.inputIgst)} />
              </Card>
              <Card title="Net tax payable">
                <Row label="CGST" value={money(d.netCgst)} />
                <Row label="SGST" value={money(d.netSgst)} />
                <Row label="IGST" value={money(d.netIgst)} />
                <Row label="Total" value={money(d.totalTax)} />
              </Card>
            </>
          )}
          {kind === "HSN" && (
            <Card title="HSN summary">
              {!d.items?.length && <Text style={s.muted}>No invoice data for {label}.</Text>}
              {d.items?.map((it) => (
                <View key={String(it.hsnCode)} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Row label={`HSN ${it.hsnCode}`} value={money(Number(it.taxableValue))} />
                  <Text style={s.muted}>{it.description} · {it.quantity} {it.uqc} · tax {money(Number(it.totalTax))}</Text>
                </View>
              ))}
            </Card>
          )}
          {(kind === "TDS" || kind === "TCS") && (
            <Card title={kind === "TDS" ? `TDS withheld · ${money(d.totalTds)}` : `TCS collected · ${money(d.totalTcs)}`}>
              <Text style={s.muted}>Deposit by the 7th of next month.</Text>
              {d.sections?.map((x) => <Row key={x.section} label={`Section ${x.section} · ${x.bills} bills`} value={money(x.tds)} />)}
              {!d.entries?.length && <Text style={s.muted}>Nothing for {label}.</Text>}
              {d.entries?.map((e) => (
                <View key={e.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <Row label={kind === "TDS" ? e.vendorName : e.customerName} value={money(kind === "TDS" ? e.tds : e.tcs)} />
                  <Text style={s.muted}>{e.pan ?? "No PAN"} · {kind === "TDS" ? `${e.section} · ${e.billNumber}` : e.invoiceNumber} · {date(e.date)} · {e.rate}% of {money(kind === "TDS" ? e.taxable : e.amount)}</Text>
                </View>
              ))}
            </Card>
          )}
          {(kind === "GSTR-1" || kind === "GSTR-3B") && !!d.invoices?.length && (
            <Card title="Invoices">
              {d.invoices.map((inv) => (
                <Pressable key={inv.id} onPress={() => router.push({ pathname: "/invoice/[id]", params: { id: String(inv.id), ...(asUser ? { asUser } : {}) } })}>
                  <Row label={`${inv.invoiceNumber} · ${date(inv.invoiceDate)}`} value={money(inv.grandTotal)} />
                </Pressable>
              ))}
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

/** Every purchase bill dated in the month. */
async function monthBills(month: string): Promise<BookBill[]> {
  const [y, m] = month.split("-").map(Number);
  const last = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
  const out: BookBill[] = [];
  for (let page = 1; page < 200; page++) {
    const d = await api<{ purchases: (BookBill & { status: string })[]; total: number }>(`/purchases?fromDate=${month}-01&toDate=${month}-${last}&limit=100&page=${page}`);
    out.push(...d.purchases.filter((p) => p.status !== "cancelled"));
    if (out.length >= d.total || d.purchases.length === 0) break;
  }
  return out;
}

const MATCH_LABEL: Record<MatchRow["kind"], string> = {
  matched: "Matched",
  mismatch: "Tax differs",
  portal_only: "On the portal, not in your books",
  books_only: "In your books, not on the portal",
};

/** GSTR-2B against the month's purchase bills, so credit is claimed only where the supplier filed. */
function Gstr2bMatch({ month, label }: { month: string; label: string }) {
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    setBusy(true);
    try {
      const file = await DocumentPicker.getDocumentAsync({ type: ["application/json", "*/*"], copyToCacheDirectory: true });
      if (file.canceled) return;
      let json: unknown;
      try { json = JSON.parse(await FileSystem.readAsStringAsync(file.assets[0].uri)); }
      catch { throw new Error("That file is not JSON. Download GSTR-2B as JSON from the GST portal."); }
      setRows(reconcile(parseGstr2b(json), await monthBills(month)));
    } catch (e) {
      setRows(null);
      Alert.alert("Could not match", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const count = (k: MatchRow["kind"]) => rows?.filter((r) => r.kind === k).length ?? 0;
  const atRisk = rows?.reduce((sum, r) => sum + (r.kind === "books_only" ? Number(r.book.totalGst) : 0), 0) ?? 0;
  return (
    <>
      <Card title="Match GSTR-2B with your purchase bills">
        <Text style={s.muted}>On the GST portal open Returns, GSTR-2B, choose {label} and download the JSON file. Pick it here; it is read on this phone and not uploaded.</Text>
        <Button title="Pick the GSTR-2B file" busy={busy} onPress={pick} />
      </Card>
      {rows && (
        <Card title="Result">
          {(["matched", "mismatch", "portal_only", "books_only"] as const).map((k) => <Row key={k} label={MATCH_LABEL[k]} value={String(count(k))} />)}
          {atRisk > 0 && <Text style={{ color: colors.text }}>Input credit of {money(atRisk)} is on bills your suppliers have not filed yet. Ask them to file before you claim it.</Text>}
          {[...rows].sort((a, b) => Number(a.kind === "matched") - Number(b.kind === "matched")).map((r, i) => {
            const p = "portal" in r ? r.portal : null;
            const b = "book" in r ? r.book : null;
            return (
              <View key={i} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Row label={p?.supplier ?? b?.vendorName ?? ""} value={MATCH_LABEL[r.kind]} />
                <Text style={s.muted}>{p?.number ?? b?.invoiceNumber} · {p?.gstin ?? b?.vendorGstin ?? "No GSTIN"} · portal {p ? money(p.tax) : "-"} · books {b ? money(Number(b.totalGst)) : "-"}</Text>
              </View>
            );
          })}
        </Card>
      )}
    </>
  );
}
