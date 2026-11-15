import { date } from "./format";

export type AuditEntry = { id: number; actorEmail: string; action: string; details: Record<string, any>; createdAt: string };

const VERB: Record<string, string> = { created: "created", updated: "edited", deleted: "deleted", status_changed: "changed status of" };
const NOUN: Record<string, string> = { invoice: "invoice", purchase: "purchase", payment: "payment", eway_bill: "e-way bill" };

/** One audit row as a sentence. */
export function describeAudit(e: AuditEntry): string {
  const [kind, act] = e.action.split(".");
  const d = e.details ?? {};
  if (NOUN[kind]) {
    const what = [NOUN[kind], d.number].filter(Boolean).join(" ");
    return `${VERB[act] ?? act} ${what}${d.status && act === "status_changed" ? ` → ${d.status}` : ""}`;
  }
  if (e.action === "business.lock_date_changed") return d.after ? `froze books up to ${date(d.after)}` : "unfroze the books";
  return e.action.replace(/[._]/g, " ");
}
