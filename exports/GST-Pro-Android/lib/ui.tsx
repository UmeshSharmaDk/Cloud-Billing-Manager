import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { statusColor } from "./format";

export const colors = { primary: "#0b62f4", bg: "#f5f7fb", card: "#ffffff", text: "#0f172a", muted: "#64748b", border: "#e2e8f0", danger: "#dc2626" };

export function Loading() {
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <View style={s.center}>
      <Text style={s.errorText}>{error instanceof Error ? error.message : "Something went wrong."}</Text>
      <Pressable style={s.button} onPress={onRetry} accessibilityRole="button">
        <Text style={s.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

export function StatusPill({ status }: { status: string }) {
  const c = statusColor[status] ?? colors.muted;
  return (
    <View style={[s.pill, { borderColor: c }]}>
      <Text style={[s.pillText, { color: c }]}>{status}</Text>
    </View>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.bg },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  errorText: { color: colors.danger, textAlign: "center", marginBottom: 16 },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 16, backgroundColor: "#fff", color: colors.text },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 12 },
  rowLabel: { color: colors.muted, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: "500", flexShrink: 1, textAlign: "right" },
  listItem: { backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
});
