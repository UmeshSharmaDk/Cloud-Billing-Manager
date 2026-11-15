import { Stack } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { api } from "@/lib/api";
import { parseStatementText, type StatementRow } from "@/lib/bank-statement";
import { date, money } from "@/lib/format";
import { chooseFile, fileText, takePhoto } from "@/lib/importFile";
import { useSave } from "@/lib/save";
import { Button, Card, colors, s } from "@/lib/ui";

type Match = { kind: "invoice" | "purchase"; id: number; number: string; party: string; partyId?: number | null; due: number; by: "number" | "amount" };

/** Record a matched line through the ordinary payment endpoints, as the website does, so lock dates and the audit trail apply. */
async function apply(row: StatementRow, m: Match) {
  const base = { date: row.date, mode: "bank_transfer", referenceNumber: row.reference || undefined, notes: row.description.slice(0, 2000) || undefined };
  const amount = Math.abs(row.amount);
  if (m.kind === "invoice") {
    await api("/payments", { method: "POST", body: { ...base, type: "received", invoiceId: m.id, customerId: m.partyId, amount: Math.min(amount, m.due) } });
  } else {
    await api("/payments", { method: "POST", body: { ...base, type: "paid", vendorId: m.partyId, amount } });
    if (amount >= m.due) await api(`/purchases/${m.id}`, { method: "PATCH", body: { paymentStatus: "paid" } });
  }
}

/** Read a bank statement, review which invoice or bill each line settles, and record the ticked ones. */
export default function BankImport() {
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [matches, setMatches] = useState<(Match | null)[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [reading, setReading] = useState(false);
  const { busy, run } = useSave();

  const load = async (pick: typeof takePhoto) => {
    try {
      const file = await pick();
      if (!file) return;
      setReading(true);
      const parsed = parseStatementText(await fileText(file));
      if (!parsed.length) return Alert.alert("No transactions found", "Export the statement as Excel or CSV from your bank's app, or take a sharper photo.");
      const res = await api<{ matches: (Match | null)[] }>("/payments/match", { method: "POST", body: { rows: parsed } });
      setRows(parsed);
      setMatches(res.matches);
      setPicked(new Set(res.matches.flatMap((m, i) => (m ? [i] : []))));
    } catch (e) {
      Alert.alert("Could not import", e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  const record = () => run(async () => {
    const failed: string[] = [];
    let done = 0;
    for (const i of picked) {
      try { await apply(rows[i], matches[i]!); done++; } catch (e) { failed.push(`${matches[i]!.number}: ${e instanceof Error ? e.message : e}`); }
    }
    return { done, failed };
  }, ({ done, failed }) => {
    setRows([]); setMatches([]); setPicked(new Set());
    Alert.alert(`Recorded ${done} payment${done === 1 ? "" : "s"}`, failed.length ? `Not recorded:\n${failed.join("\n")}` : undefined);
  });

  const toggle = (i: number) => setPicked((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Stack.Screen options={{ title: "Import bank statement" }} />
      <Card title="Statement">
        <Text style={{ color: colors.muted, fontSize: 13 }}>
          Pick the Excel or CSV statement from your bank, or photograph a printed one. Each line is matched to an unpaid invoice or bill by its number in the narration, or by an amount only one of them is due. Nothing is saved until you press Record.
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Button title="Choose file" busy={reading} onPress={() => load(chooseFile)} /></View>
          <View style={{ flex: 1 }}><Button title="Take photo" variant="outline" busy={reading} onPress={() => load(takePhoto)} /></View>
        </View>
      </Card>
      {rows.length > 0 && (
        <Card title={`${rows.length} lines, ${matches.filter(Boolean).length} matched`}>
          {rows.map((r, i) => {
            const m = matches[i];
            return (
              <Pressable key={i} disabled={!m} onPress={() => toggle(i)} accessibilityRole="checkbox" accessibilityState={{ checked: picked.has(i) }}
                style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", gap: 10, alignItems: "center" }}>
                <Text style={{ fontSize: 20, color: m ? colors.primary : colors.border }}>{picked.has(i) ? "☑" : "☐"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text }} numberOfLines={1}>{r.description || "(no narration)"}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {date(r.date)} · {m ? `${m.kind === "invoice" ? "Invoice" : "Bill"} ${m.number} · ${m.party} (${money(m.due)} due)` : "No match"}
                  </Text>
                </View>
                <Text style={{ fontWeight: "700", color: r.amount > 0 ? "#16a34a" : colors.danger }}>{money(r.amount)}</Text>
              </Pressable>
            );
          })}
          <Button title={`Record ${picked.size} payment${picked.size === 1 ? "" : "s"}`} busy={busy} disabled={!picked.size} onPress={record} />
        </Card>
      )}
    </ScrollView>
  );
}
