import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { addDaysToDate, blockedMessage, contactLine, daysBetweenDates, getIndiaDate, indiaMidnight, REMINDER_WINDOW_DAYS, SUPPORT_PHONE_LABEL, SUPPORT_PHONE_URL } from "@/lib/plan-dates";
import { cancelPlanReminders, getReminderPermission, requestReminderPermission, schedulePlanReminders } from "@/lib/plan-reminders";
import type { User } from "@/lib/types";
import { colors } from "@/lib/ui";

/** The account as the server has it now: `planEnd` can change while the app stays signed in. */
function useAccount() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["auth/me", user?.id], queryFn: () => api<User>("/auth/me"), enabled: !!user, staleTime: 0 });
}

/**
 * Keeps this phone's plan reminders in step with the plan's end date, as the
 * CRM app does. They are booked on the phone ahead of time, so they are only
 * (re)scheduled from a date the server has just confirmed: at sign-in, at
 * launch, and every time the app comes back to the foreground. A renewed plan
 * therefore replaces the old reminders the next time the app is used.
 */
export function PlanExpiryNotifications() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const account = useAccount();
  const [permission, setPermission] = useState<boolean | null>(null);
  const previousUserId = useRef<number | null>(null);
  const refetch = account.refetch;

  useEffect(() => {
    const readPermission = () => getReminderPermission().then((r) => setPermission(r.granted)).catch(() => undefined);
    void readPermission();
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void readPermission();
      if (userId !== null) void refetch();
    });
    return () => sub.remove();
  }, [userId, refetch]);

  // Signing out or switching account takes the old account's reminders with it.
  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (previous !== null && previous !== userId) void cancelPlanReminders(previous).catch(() => undefined);
  }, [userId]);

  const fresh = account.data;
  const checkedAt = account.dataUpdatedAt;
  useEffect(() => {
    if (!fresh || fresh.id !== userId || permission === null) return;
    const task = permission ? schedulePlanReminders(fresh.id, fresh.planEnd ?? null, contactLine(fresh.role)) : cancelPlanReminders(fresh.id);
    void task.catch((e) => console.warn("Could not update the plan reminders", e));
  }, [fresh, checkedAt, permission, userId]);

  return null;
}

type Permission = { granted: boolean; canAskAgain: boolean } | null;

/** On the dashboard for the last seven days of the plan: when sign-in stops, and who to call. */
export function PlanExpiryBanner() {
  const account = useAccount().data;
  const [today, setToday] = useState(getIndiaDate());
  const [permission, setPermission] = useState<Permission>(null);
  const [note, setNote] = useState("");

  // The count changes at midnight in India, even if the app is left open.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setToday(getIndiaDate());
      timer = setTimeout(tick, Math.max(1_000, indiaMidnight(addDaysToDate(getIndiaDate(), 1)) - Date.now() + 500));
    };
    tick();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    getReminderPermission().then((r) => setPermission({ granted: r.granted, canAskAgain: r.canAskAgain })).catch(() => undefined);
  }, []);

  const endDate = account?.planEnd ?? null;
  if (!account || !endDate) return null;
  const daysRemaining = daysBetweenDates(today, endDate);
  if (daysRemaining > REMINDER_WINDOW_DAYS) return null;
  const isAdmin = account.role === "admin";

  async function enableReminders() {
    setNote("");
    try {
      if (permission && !permission.canAskAgain) return void (await Linking.openSettings());
      const result = await requestReminderPermission();
      setPermission({ granted: result.granted, canAskAgain: result.canAskAgain });
      if (result.granted) await schedulePlanReminders(account!.id, endDate, contactLine(account!.role));
      else if (!result.canAskAgain) setNote("Notifications are off. You can still see this reminder in the app.");
    } catch {
      setNote("Could not turn on phone reminders. You can still see this reminder in the app.");
    }
  }

  return (
    <View style={b.card} accessibilityRole="summary">
      <Ionicons name={daysRemaining < 0 ? "lock-closed-outline" : "warning-outline"} size={20} color={b.icon.color} />
      <View style={b.content}>
        {isAdmin ? (
          <Text style={b.message}>
            {blockedMessage(daysRemaining)} Contact Support at{" "}
            <Text accessibilityRole="link" accessibilityLabel={`Call Support at ${SUPPORT_PHONE_LABEL}`} style={b.phone}
              onPress={() => void Linking.openURL(SUPPORT_PHONE_URL).catch(() => Alert.alert("Support", `Call ${SUPPORT_PHONE_LABEL}`))}>
              {SUPPORT_PHONE_LABEL}
            </Text>
          </Text>
        ) : (
          <Text style={b.message}>{blockedMessage(daysRemaining)} {contactLine(account.role)}</Text>
        )}
        {permission?.granted !== true && daysRemaining >= 1 && (
          <Pressable onPress={() => void enableReminders()} style={b.enable} accessibilityRole="button">
            <Ionicons name={permission?.canAskAgain === false ? "settings-outline" : "notifications-outline"} size={15} color={colors.primary} />
            <Text style={b.enableText}>{permission?.canAskAgain === false ? "Open notification settings" : "Turn on phone reminders"}</Text>
          </Pressable>
        )}
        {!!note && <Text style={b.note}>{note}</Text>}
      </View>
    </View>
  );
}

const b = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderWidth: 1, borderColor: "#f59e0b73", borderRadius: 14, backgroundColor: "#fffbeb" },
  icon: { color: "#b45309" },
  content: { flex: 1, gap: 8 },
  message: { fontSize: 13, lineHeight: 19, fontWeight: "500", color: colors.text },
  phone: { fontWeight: "700", color: colors.primary, textDecorationLine: "underline" },
  enable: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 7, paddingVertical: 3 },
  enableText: { fontSize: 12, fontWeight: "600", color: colors.primary },
  note: { fontSize: 12, color: colors.muted },
});
