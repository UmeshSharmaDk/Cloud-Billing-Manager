import { useEffect, useRef, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import * as Updates from "expo-updates";
import { ActivityIndicator, Animated, DevSettings, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { statusColor } from "./format";

/**
 * Light and dark palettes. Every screen builds its StyleSheet from `colors` when it loads, so the
 * theme is read synchronously before any screen imports this file, and switching restarts the app.
 * ponytail: restart on switch; move colors into a context if a live switch is ever wanted.
 */
const THEME_KEY = "theme";
export const isDark = SecureStore.getItem(THEME_KEY) === "dark";
// ANVEXI TECH Brand Colour System v1.0 (Electric Blue).
const light = { primary: "#386BFF", onPrimary: "#FFFFFF", bg: "#F5F7FB", card: "#FFFFFF", text: "#101828", muted: "#667085", border: "#EAECF0", danger: "#DC2626", success: "#16A34A", warning: "#D97706", warnBg: "#FEF3C7" };
const dark = { primary: "#386BFF", onPrimary: "#FFFFFF", bg: "#101828", card: "#1D2939", text: "#F9FAFB", muted: "#D0D5DD", border: "#344054", danger: "#F87171", success: "#4ADE80", warning: "#FBBF24", warnBg: "#422D0B" };
export const colors = isDark ? dark : light;

export function setDarkMode(on: boolean) {
  SecureStore.setItem(THEME_KEY, on ? "dark" : "light");
  Updates.reloadAsync().catch(() => DevSettings.reload());
}

/** The light/dark switch on every role's account card. */
export function ThemeToggle() {
  return <Button title={isDark ? "Switch to light mode" : "Switch to dark mode"} variant="outline" onPress={() => setDarkMode(!isDark)} />;
}

/** A grey placeholder for text or a box that is still loading. */
function Bone({ w = "100%", h = 12, r = 6 }: { w?: number | `${number}%`; h?: number; r?: number }) {
  return <View style={{ width: w, height: h, borderRadius: r, backgroundColor: colors.border }} />;
}

/** One list line: title and subtitle on the left, a value on the right. */
function BoneLine({ top }: { top?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, gap: 12, borderTopWidth: top ? 1 : 0, borderTopColor: colors.border }}>
      <View style={{ flex: 1, gap: 6 }}><Bone w="55%" h={14} /><Bone w="80%" /></View>
      <View style={{ alignItems: "flex-end", gap: 6 }}><Bone w={64} h={14} /><Bone w={48} h={16} r={999} /></View>
    </View>
  );
}

function BoneRows({ n = 5 }: { n?: number }) {
  return <>{Array.from({ length: n }, (_, i) => <View key={i} style={s.row}><Bone w="35%" /><Bone w="30%" /></View>)}</>;
}

/**
 * Skeleton screen shown while a screen's data loads, shaped like the screen it stands in for.
 * `rows` sits inline inside a card; the others fill the screen.
 */
export function Loading({ layout = "detail" }: { layout?: "detail" | "list" | "dashboard" | "form" | "rows" }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const body = layout === "rows" ? <>{[0, 1, 2].map((i) => <BoneLine key={i} top />)}</>
    : layout === "list" ? Array.from({ length: 8 }, (_, i) => <View key={i} style={s.listItem}><BoneLine /></View>)
    : layout === "dashboard" ? (
      <View style={{ padding: 16, gap: 16 }}>
        <Bone w="70%" h={18} />
        <Bone h={44} r={10} />
        <View style={[s.card, { gap: 10 }]}>
          <Bone w="35%" /><Bone w="65%" h={32} /><Bone w="45%" />
          <View style={{ flexDirection: "row", gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
            {[0, 1].map((i) => <View key={i} style={{ flex: 1, gap: 6 }}><Bone w="70%" /><Bone w="55%" h={16} /></View>)}
          </View>
        </View>
        <View style={[s.card, { flexDirection: "row", flexWrap: "wrap", gap: 12 }]}>
          {Array.from({ length: 4 }, (_, i) => <View key={i} style={{ flexBasis: "47%", flexGrow: 1, gap: 6 }}><Bone w="60%" /><Bone w="70%" h={16} /></View>)}
        </View>
        <View style={[s.card, { gap: 4 }]}><Bone w="45%" h={18} />{[0, 1, 2, 3].map((i) => <BoneLine key={i} top />)}</View>
      </View>
    )
    : layout === "form" ? (
      <View style={{ padding: 16, gap: 16 }}>
        {Array.from({ length: 6 }, (_, i) => <View key={i} style={{ gap: 6 }}><Bone w="30%" /><Bone h={46} r={10} /></View>)}
        <Bone h={44} r={10} />
      </View>
    ) : (
      <View style={{ padding: 16, gap: 16 }}>
        <View style={[s.card, { gap: 8 }]}><Bone w="50%" h={18} /><BoneRows /></View>
        <Bone h={44} r={10} />
        <View style={[s.card, { gap: 4 }]}><Bone w="40%" h={18} />{[0, 1, 2].map((i) => <BoneLine key={i} top />)}</View>
      </View>
    );

  return (
    <Animated.View style={[layout !== "rows" && s.screen, { opacity: pulse }]} accessible accessibilityLabel="Loading" accessibilityRole="progressbar">
      {body}
    </Animated.View>
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
  const c = colors[statusColor[status] ?? "muted"];
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

/**
 * Follows CONSTITUTION.md: at least 44 high, `title` names the action, `busy`
 * keeps the size and shows a spinner (presses are ignored), and a button that
 * cannot be pressed yet says why through `disabledReason`.
 */
export function Button({ title, onPress, busy, variant = "primary", disabled, disabledReason }: {
  title: string; onPress: () => void; busy?: boolean; variant?: "primary" | "outline" | "danger"; disabled?: boolean; disabledReason?: string;
}) {
  const bg = variant === "primary" ? colors.primary : variant === "danger" ? colors.danger : "transparent";
  const off = disabled || !!disabledReason;
  const ink = variant === "outline" ? colors.text : colors.onPrimary;
  const button = (
    <Pressable onPress={onPress} disabled={busy || off} accessibilityRole="button" accessibilityState={{ busy: !!busy, disabled: off }}
      accessibilityLabel={title} accessibilityHint={disabledReason}
      style={[s.button, { backgroundColor: bg }, variant === "outline" && { borderWidth: 1, borderColor: colors.border }, off && { opacity: 0.6 }]}>
      <Text style={[s.buttonText, { color: ink }, busy && { opacity: 0 }]}>{title}</Text>
      {busy && <ActivityIndicator color={ink} style={StyleSheet.absoluteFill} />}
    </Pressable>
  );
  if (!disabledReason) return button;
  return (
    <View style={{ gap: 4 }}>
      {button}
      <Text style={[s.muted, { textAlign: "center" }]}>{disabledReason}</Text>
    </View>
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

/**
 * The inside of every <Modal>. A Modal is its own window, drawn edge to edge
 * under the status bar and the phone's navigation buttons, and it gets none of
 * the padding the screens get from the root layout. Without this its top row
 * and its bottom button sit under those bars.
 */
export function ModalFrame({ backgroundColor, children }: { backgroundColor: string; children: ReactNode }) {
  const { top, bottom } = useSafeAreaInsets();
  return <View style={{ flex: 1, backgroundColor, paddingTop: top, paddingBottom: bottom }}>{children}</View>;
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
        <ModalFrame backgroundColor={colors.bg}>
        <View style={{ flex: 1, padding: 16, gap: 12 }}>
          <Text style={s.title}>{label}</Text>
          {options.length > 8 && <TextInput style={s.input} placeholder="Search" value={q} onChangeText={setQ} placeholderTextColor={colors.muted} />}
          <FlatList data={shown} keyExtractor={(o) => o.value} renderItem={({ item }) => (
            <Pressable style={s.listItem} onPress={() => { onChange(item.value); setOpen(false); setQ(""); }}>
              <Text style={{ color: colors.text, fontWeight: item.value === value ? "700" : "400" }}>{item.label}</Text>
            </Pressable>
          )} />
          <Button title="Close" variant="outline" onPress={() => setOpen(false)} />
        </View>
        </ModalFrame>
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
          <Text style={[s.pillText, { color: value === f ? colors.onPrimary : colors.muted }]}>{f}</Text>
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
      <ModalFrame backgroundColor="#0008">
      <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        <View style={[s.card, { gap: 12 }]}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.muted}>{message}</Text>
          <TextInput style={s.input} secureTextEntry={secure} autoFocus autoCapitalize="none" value={v} onChangeText={setV}
            keyboardType={numeric ? "decimal-pad" : "default"} placeholder={placeholder} placeholderTextColor={colors.muted} />
          <Button title="Confirm" busy={busy} disabledReason={v ? undefined : "Fill in the box above first."} onPress={() => { onSubmit(v); setV(""); }} />
          <Button title="Cancel" variant="outline" onPress={() => { setV(""); onCancel(); }} />
        </View>
      </View>
      </ModalFrame>
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
  button: { backgroundColor: colors.primary, borderRadius: 10, minHeight: 44, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", justifyContent: "center" },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 16 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 16, backgroundColor: colors.card, color: colors.text },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 12 },
  rowLabel: { color: colors.muted, fontSize: 14 },
  rowValue: { color: colors.text, fontSize: 14, fontWeight: "500", flexShrink: 1, textAlign: "right" },
  listItem: { backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
});
