import { useQuery } from "@tanstack/react-query";
import * as Print from "expo-print";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, Image, Linking, ScrollView, Text, View } from "react-native";
import { api, viewAs } from "@/lib/api";
import { date, money } from "@/lib/format";
import { invoiceHtml } from "@/lib/invoiceHtml";
import { reminderLink } from "@/lib/whatsapp";
import { useSave } from "@/lib/save";
import type { Business, Customer, Invoice } from "@/lib/types";
import { Button, Card, colors, ErrorView, Loading, Prompt, Row, s, StatusPill, ToggleRow, pullToRefresh } from "@/lib/ui";

export default function InvoiceDetail() {
  // `asUser`: an admin looking at one of their users' invoices, read-only.
  const { id, asUser } = useLocalSearchParams<{ id: string; asUser?: string }>();
  const at = (path: string) => viewAs(path, asUser);
  const q = useQuery({ queryKey: [at(`/invoices/${id}`)], queryFn: () => api<Invoice>(at(`/invoices/${encodeURIComponent(id)}`)) });
  const biz = useQuery({ queryKey: [at("/business")], queryFn: () => api<Business>(at("/business")) });
  const custId = q.data?.customerId;
  const cust = useQuery({ queryKey: [at(`/customers/${custId}`)], queryFn: () => api<Customer>(at(`/customers/${custId}`)), enabled: !!custId });
  const { busy, run } = useSave();
  const [partial, setPartial] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [emailing, setEmailing] = useState(false);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorView error={q.error} onRetry={q.refetch} />;
  const inv = q.data!;
  const due = inv.grandTotal - (inv.paidAmount ?? 0);
  const setStatus = (paymentStatus: string, paidAmount?: number) =>
    run(() => api(`/invoices/${inv.id}/status`, { method: "PATCH", body: { paymentStatus, ...(paidAmount !== undefined ? { paidAmount } : {}) } }), () => setPartial(false));

  const sendEmail = (to: string) =>
    run(() => api<{ to: string }>(`/invoices/${inv.id}/email`, { method: "POST", body: { to: to.trim() } }), (r) => {
      setEmailing(false);
      Alert.alert("Invoice sent", `Sent to ${r.to}.`);
    });
  const setRepeat = (repeatMonthly: boolean) =>
    run(() => api(`/invoices/${inv.id}/repeat`, { method: "PUT", body: { repeatMonthly } }));

  const share = async () => {
    setSharing(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: invoiceHtml(inv, biz.data, cust.data) });
      await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: inv.invoiceNumber, UTI: "com.adobe.pdf" });
    } catch (e) {
      Alert.alert("Could not create the PDF", e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 16 }} refreshControl={pullToRefresh(q, biz, cust)}>
      <Stack.Screen options={{ title: inv.invoiceNumber }} />
      <Card title={inv.customerName} right={<StatusPill status={inv.status} />}>
        {!!inv.customerGstin && <Row label="GSTIN" value={inv.customerGstin} />}
        <Row label="Type" value={inv.type} />
        <Row label="Invoice date" value={date(inv.invoiceDate)} />
        <Row label="Due date" value={date(inv.dueDate)} />
        {!!inv.placeOfSupply && <Row label="Place of supply" value={inv.placeOfSupply} />}
        <Row label="Tax" value={inv.isInterstate ? "IGST" : "CGST + SGST"} />
      </Card>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Button title="Share PDF" busy={sharing} onPress={share} /></View>
        <View style={{ flex: 1 }}><Button title="Print" variant="outline" onPress={() => Print.printAsync({ html: invoiceHtml(inv, biz.data, cust.data) }).catch(() => {})} /></View>
      </View>
      {!asUser && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Button title="Email invoice" variant="outline" onPress={() => setEmailing(true)} /></View>
          <View style={{ flex: 1 }}><Button title="Duplicate invoice" variant="outline" onPress={() => router.push({ pathname: "/invoice/new", params: { from: String(inv.id) } })} /></View>
        </View>
      )}
      {!asUser && inv.status !== "cancelled" && (
        <Card>
          <ToggleRow label="Repeat every month" note="Each new month the dashboard offers a copy to send."
            value={!!inv.repeatMonthly} onChange={setRepeat} busy={busy} />
        </Card>
      )}

      {!asUser && inv.status !== "cancelled" && (
        <Card title="Payment">
          <Row label="Paid so far" value={money(inv.paidAmount)} />
          {due > 0 && <Row label="Balance due" value={money(due)} />}
          {reminderLink(inv, cust.data?.phone as string, { name: biz.data?.name, upiId: biz.data?.upiId as string }, money, date) && (
            <Button title="Send WhatsApp reminder" variant="outline"
              onPress={() => Linking.openURL(reminderLink(inv, cust.data?.phone as string, { name: biz.data?.name, upiId: biz.data?.upiId as string }, money, date)!).catch(() => Alert.alert("WhatsApp is not installed"))} />
          )}
          {inv.upi && (
            <View style={{ alignItems: "center", gap: 6, paddingVertical: 6 }}>
              <Image source={{ uri: inv.upi.qr }} style={{ width: 180, height: 180 }} accessibilityLabel="UPI payment QR code" />
              <Text style={{ color: colors.muted, fontSize: 12 }}>Customer scans this in any UPI app to pay {money(inv.upi.amount)}</Text>
              <Button title="Open in a UPI app" variant="outline" onPress={() => Linking.openURL(inv.upi!.link).catch(() => Alert.alert("No UPI app found"))} />
            </View>
          )}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {inv.status !== "paid" && <View style={{ flex: 1 }}><Button title="Mark paid" busy={busy} onPress={() => setStatus("paid")} /></View>}
            <View style={{ flex: 1 }}><Button title="Part paid" variant="outline" onPress={() => setPartial(true)} /></View>
            {inv.status !== "unpaid" && <View style={{ flex: 1 }}><Button title="Unpaid" variant="outline" busy={busy} onPress={() => setStatus("unpaid")} /></View>}
          </View>
        </Card>
      )}

      <Card title="Items">
        {(inv.items ?? []).map((it, i) => (
          <View key={it.id ?? i} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <Text style={{ color: colors.text, fontWeight: "500", flexShrink: 1 }}>{it.description}</Text>
              <Text style={{ color: colors.text, fontWeight: "600" }}>{money(it.totalAmount)}</Text>
            </View>
            <Text style={s.muted}>
              {it.quantity} {it.unit ?? ""} × {money(it.unitPrice)}{it.discount ? ` · ${it.discount}% off` : ""} · GST {it.gstRate}%{it.hsnCode ? ` · HSN ${it.hsnCode}` : ""}
            </Text>
          </View>
        ))}
      </Card>

      <Card>
        <Row label="Taxable value" value={money(inv.subtotal)} />
        {inv.isInterstate ? <Row label="IGST" value={money(inv.igst)} /> : (
          <>
            <Row label="CGST" value={money(inv.cgst)} />
            <Row label="SGST" value={money(inv.sgst)} />
          </>
        )}
        {Number((inv as any).tcsAmount) > 0 && <Row label={`TCS @ ${(inv as any).tcsRate}%`} value={money((inv as any).tcsAmount)} />}
        {!!inv.roundOff && <Row label="Round off" value={money(inv.roundOff)} />}
        <Row label="Grand total" value={money(inv.grandTotal)} />
      </Card>
      {!!inv.notes && <Card><Text style={s.muted}>{inv.notes}</Text></Card>}
      {!asUser && <Button title="Create e-way bill" variant="outline" onPress={() => router.push({ pathname: "/eway-bill/new", params: { invoiceId: String(inv.id) } })} />}

      <Prompt visible={partial} title="Record a part-payment" numeric busy={busy} placeholder="Amount in ₹"
        message={`Total received so far against ${inv.invoiceNumber}. More than zero and less than ${money(inv.grandTotal)}.`}
        onCancel={() => setPartial(false)} onSubmit={(v) => setStatus("partial", Number(v))} />
      <Prompt visible={emailing} title="Email this invoice" action="Send invoice" email busy={busy} placeholder="customer@example.com" initial={(cust.data?.email as string) ?? ""}
        message="The customer gets the invoice with a link to pay by UPI when you have one set up."
        onCancel={() => setEmailing(false)} onSubmit={sendEmail} />
    </ScrollView>
  );
}
