// The pure parts of the plan end reminders (see plan-reminders.ts), kept apart
// so they can be checked without a phone: node lib/plan-dates.test.ts

/** The platform's support line, the same one the CRM app shows. */
export const SUPPORT_PHONE_LABEL = "+91 80541 19059";
export const SUPPORT_PHONE_URL = "tel:+918054119059";

/** Reminders start this many days before the plan's end date and run through it. */
export const REMINDER_WINDOW_DAYS = 7;
/** Reminders land at random times inside this daytime window, India time. */
const WINDOW_START_HOUR = 10;
const WINDOW_END_HOUR = 20;
const REMINDERS_PER_DAY = 2;

const indiaDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today in India, as YYYY-MM-DD. */
export function getIndiaDate(now = new Date()): string {
  const p = Object.fromEntries(indiaDate.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const utc = (date: string, plusDays = 0) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d + plusDays);
};
export const daysBetweenDates = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000);
export const addDaysToDate = (date: string, days: number) => new Date(utc(date, days)).toISOString().slice(0, 10);
/** India is UTC+05:30 all year, whatever the phone's own timezone is. */
export const indiaMidnight = (date: string) => utc(date) - 330 * 60_000;

/** FNV-1a: a small, stable hash, so a day's "random" times stay the same each time they are rescheduled. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/**
 * The reminder times for one India date: one in each equal part of the daytime
 * window, so two never bunch up. Derived from the user and date rather than
 * Math.random, because reminders are rescheduled every time the app opens and
 * must not move (or repeat).
 */
export function reminderTimesFor(userId: number, date: string): Date[] {
  const part = Math.floor(((WINDOW_END_HOUR - WINDOW_START_HOUR) * 60) / REMINDERS_PER_DAY);
  return Array.from({ length: REMINDERS_PER_DAY }, (_, slot) => {
    const minute = WINDOW_START_HOUR * 60 + slot * part + (hash(`${userId}:${date}:${slot}`) % part);
    return new Date(indiaMidnight(date) + minute * 60_000);
  });
}

/** "Your login will be blocked in 3 days." The plan's end date is the last day that works. */
export function blockedMessage(daysRemaining: number): string {
  if (daysRemaining < 0) return "Your login is blocked.";
  if (daysRemaining === 0) return "Your login will be blocked tomorrow.";
  return `Your login will be blocked in ${daysRemaining} ${daysRemaining === 1 ? "day" : "days"}.`;
}

/** Admins renew with Support; their users cannot renew anything themselves. */
export const contactLine = (role: string) => (role === "admin" ? `Contact Support: ${SUPPORT_PHONE_LABEL}` : "Contact your Admin.");
