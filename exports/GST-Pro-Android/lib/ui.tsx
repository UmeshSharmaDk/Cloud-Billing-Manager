import { useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
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

export function Button({ title, onPress, busy, variant = "primary", disabled }: {
  title: string; onPress: () => void; busy?: boolean; variant?: "primary" | "outline" | "danger"; disabled?: boolean;
}) {
  const bg = variant === "primary" ? colors.primary : variant === "danger" ? colors.danger : "transparent";
  return (
    <Pressable onPress={onPress} disabled={busy || disabled} accessibilityRole="button"
      style={[s.button, { backgroundColor: bg }, variant === "outline" && { borderWidth: 1, borderColor: colors.primary }, (busy || disabled) && { opacity: 0.6 }]}>
      <Text style={[s.buttonText, variant === "outline" && { color: colors.primary }]}>{busy ? "Please wait…" : title}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput style={[s.input, props.multiline && { minHeight: 80, textAlignVertical: "top" }]} placeholderTextColor={colors.muted} {...props} />
    </View>
  );
}

export type Option = { value: string; label: string };

/** A tap-to-open list picker, the native stand-in for the website's <select>. */
export function Select({ label, value, options, onChange, placeholder = "Select…" }: {
  label: string; value: string; options: Option[]; onChange: (v: string) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.value === value);
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable style={s.input} onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={{ color: current ? colors.text : colors.muted, fontSize: 16 }}>{current?.label ?? placeholder}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[s.screen, { padding: 16, gap: 12 }]}>
          <Text style={s.title}>{label}</Text>
          {options.length > 8 && <TextInput style={s.input} placeholder="Search" value={q} onChangeText={setQ} placeholderTextColor={colors.muted} />}
          <FlatList data={shown} keyExtractor={(o) => o.value} renderItem={({ item }) => (
            <Pressable style={s.listItem} onPress={() => { onChange(item.value); setOpen(false); setQ(""); }}>
              <Text style={{ color: colors.text, fontWeight: item.value === value ? "700" : "400" }}>{item.label}</Text>
            </Pressable>
          )} />
          <Button title="Close" variant="outline" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

export function Chips<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((f) => (
        <Pressable key={f} onPress={() => onChange(f)}
          style={[s.pill, { borderColor: value === f ? colors.primary : colors.border, backgroundColor: value === f ? colors.primary : "transparent", paddingHorizontal: 12, paddingVertical: 6 }]}>
          <Text style={[s.pillText, { color: value === f ? "#fff" : colors.muted }]}>{f}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={[s.card, { gap: 8 }]}>
      {(title || right) && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          {!!title && <Text style={s.title}>{title}</Text>}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

export function Form({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

/** A one-field dialog: a part-payment amount, or the caller's own password before a privileged action. */
export function Prompt({ visible, title, message, secure, numeric, placeholder, onSubmit, onCancel, busy }: {
  visible: boolean; title: string; message: string; secure?: boolean; numeric?: boolean; placeholder?: string;
  onSubmit: (value: string) => void; onCancel: () => void; busy?: boolean;
}) {
  const [v, setV] = useState("");
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "#0008", justifyContent: "center", padding: 24 }}>
        <View style={[s.card, { gap: 12 }]}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.muted}>{message}</Text>
          <TextInput style={s.input} secureTextEntry={secure} autoFocus autoCapitalize="none" value={v} onChangeText={setV}
            keyboardType={numeric ? "decimal-pad" : "default"} placeholder={placeholder} placeholderTextColor={colors.muted} />
          <Button title="Confirm" busy={busy} disabled={!v} onPress={() => { onSubmit(v); setV(""); }} />
          <Button title="Cancel" variant="outline" onPress={() => { setV(""); onCancel(); }} />
        </View>
      </View>
    </Modal>
  );
}

export const PasswordPrompt = (p: { visible: boolean; title: string; onSubmit: (pw: string) => void; onCancel: () => void; busy?: boolean }) => (
  <Prompt {...p} secure message="Enter your own password to confirm." placeholder="Your password" />
);

export const s = StyleSheet.create({
  label: { fontSize: 13, color: colors.muted, fontWeight: "600" },
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
