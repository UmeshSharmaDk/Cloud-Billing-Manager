/** Run: node lib/plan-dates.test.ts */
import assert from "node:assert/strict";
import { addDaysToDate, blockedMessage, daysBetweenDates, getIndiaDate, reminderTimesFor } from "./plan-dates.ts";

// 19:00 UTC is already the next day in India.
assert.equal(getIndiaDate(new Date("2026-11-15T19:00:00Z")), "2026-11-16");
assert.equal(daysBetweenDates("2026-11-15", "2026-11-22"), 7);
assert.equal(addDaysToDate("2026-03-01", -1), "2026-02-28");
assert.equal(blockedMessage(0), "Your login will be blocked tomorrow.");
assert.equal(blockedMessage(1), "Your login will be blocked in 1 day.");

// Two a day, one before and one after 15:00 India time, between 10:00 and 20:00, and the same every time.
for (const userId of [1, 7, 4242]) {
  for (const day of ["2026-11-15", "2026-12-31", "2027-02-28"]) {
    const [a, b] = reminderTimesFor(userId, day).map((t) => (t.getTime() + 330 * 60_000 - Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8))) / 60_000);
    assert.ok(a >= 600 && a < 900 && b >= 900 && b < 1200, `${userId} ${day}: ${a}, ${b}`);
    assert.deepEqual(reminderTimesFor(userId, day), reminderTimesFor(userId, day));
  }
}
console.log("plan-dates: ok");
