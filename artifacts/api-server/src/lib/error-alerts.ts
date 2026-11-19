/**
 * Email the operator when the server answers 500, at most once every ten
 * minutes, so a broken deploy is noticed before customers call. Set
 * ERROR_ALERT_TO to turn it on.
 */

import type { Message } from "./mailer";

const WINDOW_MS = 10 * 60 * 1000;
let lastSent = 0;
let suppressed = 0;

export function alertServerError(
  info: { requestId: unknown; method: string; path: string; error: string },
  send: (m: Message) => unknown,
  now = Date.now(),
): boolean {
  const to = process.env["ERROR_ALERT_TO"]?.trim();
  if (!to) return false;
  if (now - lastSent < WINDOW_MS) { suppressed++; return false; }
  const extra = suppressed;
  lastSent = now; suppressed = 0;
  void send({
    to,
    subject: "Billing Pilot: server error",
    text: [
      `The server answered 500 to ${info.method} ${info.path}.`,
      `Error: ${info.error}`,
      `Request id: ${String(info.requestId)} (search the server log for it).`,
      extra ? `${extra} more errors in the last ten minutes were not emailed.` : "",
    ].filter(Boolean).join("\n"),
  });
  return true;
}
