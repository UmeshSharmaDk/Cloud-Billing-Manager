import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { addDaysToDate, blockedMessage, daysBetweenDates, getIndiaDate, REMINDER_WINDOW_DAYS, reminderTimesFor } from "./plan-dates";

/**
 * Phone reminders that the plan is about to end, the same way the CRM app does
 * it: local notifications (nothing is sent to a push service), twice a day at
 * varying daytime hours, from seven days before the end date through it.
 */
const CHANNEL_ID = "plan-expiry-alerts";
/** When today's reminders have all passed, one more follows this soon after opening the app. */
const CATCH_UP_DELAY_SECONDS = 120;
const REMINDER_TYPE = "plan-expiry-reminder";
const idsKey = (userId: number) => `gstpro.plan-reminders.${userId}`;
const catchUpKey = (userId: number) => `gstpro.plan-catch-up.${userId}`;

/**
 * The plan end the server last confirmed. A reminder is only shown when it was
 * scheduled for this user and end date, and today is still inside its window;
 * anything else is stale (the end date changed, or another account signed in)
 * and is dropped.
 */
let confirmed: { userId: number; endDate: string | null } | null = null;

type ReminderData = { type?: unknown; userId?: unknown; endDate?: unknown } | undefined;

function isReminderCurrent(data: ReminderData, today = getIndiaDate()): boolean {
  if (!data || data.type !== REMINDER_TYPE) return true;
  if (!confirmed?.endDate) return false;
  if (data.userId !== confirmed.userId || data.endDate !== confirmed.endDate) return false;
  const daysLeft = daysBetweenDates(today, confirmed.endDate);
  return daysLeft >= 0 && daysLeft <= REMINDER_WINDOW_DAYS;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const show = isReminderCurrent(notification.request.content.data as ReminderData);
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: false, shouldSetBadge: false };
  },
});

/** Runs reminder changes one at a time, so overlapping runs cannot leave an old reminder scheduled. */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const ensureChannel = () => Notifications.setNotificationChannelAsync(CHANNEL_ID, {
  name: "Plan end reminders",
  importance: Notifications.AndroidImportance.HIGH,
  vibrationPattern: [0, 250, 150, 250],
});

/**
 * Cancels every scheduled plan reminder on this phone, found by type rather
 * than only by the ids we stored, so none can be left behind; and clears any
 * already shown that no longer match the account.
 */
async function clearReminders(userId: number): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  let stored: unknown = [];
  try {
    stored = JSON.parse((await SecureStore.getItemAsync(idsKey(userId))) ?? "[]");
  } catch {
    // Unreadable: the scan by type above covers it.
  }
  const ids = new Set<string>([
    ...scheduled.filter((r) => (r.content.data as ReminderData)?.type === REMINDER_TYPE).map((r) => r.identifier),
    ...(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []),
  ]);
  await Promise.all([...ids].map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  await SecureStore.deleteItemAsync(idsKey(userId));

  const shown = await Notifications.getPresentedNotificationsAsync().catch(() => []);
  await Promise.all(shown
    .filter((n) => !isReminderCurrent(n.request.content.data as ReminderData))
    .map((n) => Notifications.dismissNotificationAsync(n.request.identifier).catch(() => undefined)));
}

export const getReminderPermission = () => Notifications.getPermissionsAsync();

export async function requestReminderPermission() {
  // Android 13+ only asks once a channel exists.
  await ensureChannel();
  return Notifications.requestPermissionsAsync();
}

export function cancelPlanReminders(userId: number): Promise<void> {
  return serialized(async () => {
    if (confirmed?.userId === userId) confirmed = null;
    await clearReminders(userId);
  });
}

/**
 * Replaces this user's reminders with ones for `endDate`. Call it only with an
 * end date the server has just confirmed: reminders are booked on the phone in
 * advance, so a stale date would keep notifying after the plan was renewed.
 * `contact` ends each message ("Contact Support: …").
 */
export function schedulePlanReminders(userId: number, endDate: string | null, contact: string): Promise<void> {
  return serialized(async () => {
    confirmed = { userId, endDate };
    await clearReminders(userId);
    if (!endDate) return;
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await ensureChannel();

    const today = getIndiaDate();
    const now = Date.now();
    const ids: string[] = [];
    const book = async (daysRemaining: number, trigger: Notifications.NotificationTriggerInput) => {
      ids.push(await Notifications.scheduleNotificationAsync({
        content: { title: "GST Pro plan reminder", body: `${blockedMessage(daysRemaining)} ${contact}`, data: { type: REMINDER_TYPE, userId, endDate } },
        trigger,
      }));
    };

    let laterToday = false;
    for (let daysRemaining = REMINDER_WINDOW_DAYS; daysRemaining >= 0; daysRemaining -= 1) {
      const day = addDaysToDate(endDate, -daysRemaining);
      if (day < today) continue;
      for (const at of reminderTimesFor(userId, day)) {
        if (at.getTime() <= now) continue;
        if (day === today) laterToday = true;
        await book(daysRemaining, { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL_ID });
      }
    }

    // Opened inside the window after today's reminders have passed: send one shortly, at most once a day.
    const daysLeft = daysBetweenDates(today, endDate);
    if (daysLeft >= 0 && daysLeft <= REMINDER_WINDOW_DAYS && !laterToday && (await SecureStore.getItemAsync(catchUpKey(userId))) !== today) {
      await book(daysLeft, { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: CATCH_UP_DELAY_SECONDS, channelId: CHANNEL_ID });
      await SecureStore.setItemAsync(catchUpKey(userId), today);
    }
    await SecureStore.setItemAsync(idsKey(userId), JSON.stringify(ids));
  });
}
