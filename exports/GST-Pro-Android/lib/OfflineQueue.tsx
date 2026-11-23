import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert, AppState, Text, View } from "react-native";
import { api, isNetworkError } from "./api";
import { useAuth } from "./auth";
import { discard, flush, isOffline, onChange, queued, type Queued } from "./offline";
import { Button, Card, colors, s } from "./ui";

/** Sends invoices made offline: at launch, when the app comes back to the front, and every 30 seconds. */
export function OfflineSync() {
  const { user } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (!user) return;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const sent = await flush(user.id, (q) => api(q.path, { method: "POST", body: q.body }).then(() => {}), isNetworkError);
        if (sent) await qc.invalidateQueries();
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(tick, 30_000);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void tick(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [user, qc]);
  return null;
}

/** On the dashboard: says when the app is offline and lists what is waiting to be sent. */
export function OfflineCard() {
  const { user } = useAuth();
  const [items, setItems] = useState<Queued[]>([]);
  const [off, setOff] = useState(isOffline());
  useEffect(() => {
    if (!user) return;
    const load = () => { setOff(isOffline()); void queued(user.id).then(setItems); };
    load();
    return onChange(load);
  }, [user]);
  if (!off && items.length === 0) return null;
  const remove = (q: Queued) => Alert.alert("Delete this unsent invoice?", `${q.label} was never sent, so it has no number yet.`, [
    { text: "Keep", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => void discard(q.ref) },
  ]);
  return (
    <Card title={off ? "You are offline" : "Sending saved invoices"}>
      {off && <Text style={s.muted}>Showing what this phone saved last time. New invoices are kept here and sent when you are back online.</Text>}
      {items.map((q) => (
        <View key={q.ref} style={{ gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={{ color: colors.text, fontWeight: "500" }}>{q.label}</Text>
          <Text style={[s.muted, q.error ? { color: colors.danger } : null]}>
            {q.error ? `Not accepted: ${q.error}` : "Waiting to send. It gets its invoice number when it is sent."}
          </Text>
          {!!q.error && <Button title="Delete unsent invoice" variant="outline" onPress={() => remove(q)} />}
        </View>
      ))}
    </Card>
  );
}
