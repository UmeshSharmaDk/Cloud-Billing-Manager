/**
 * Weekly emailed payment reminders for overdue invoices, for businesses that
 * turn them on in Settings. Run from the housekeeping timer.
 */

import { rootDb, runInSystemScope, db, invoicesTable, businessesTable, customersTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { mailer, paymentReminderMessage } from "./mailer";
import { receivableInvoice } from "./tax-documents";
import { dec, paise } from "./money";
import { upiPayment } from "../routes/invoices";
import { logger } from "./logger";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PER_SWEEP = 50; // ponytail: a fixed batch per sweep; a queue if volume ever outgrows it

export async function sendDueReminders(now = new Date()): Promise<number> {
  return runInSystemScope(rootDb, async () => {
    const today = now.toISOString().slice(0, 10);
    const due = await db.select({ inv: invoicesTable, email: customersTable.email, business: businessesTable.name, replyTo: businessesTable.email })
      .from(invoicesTable)
      .innerJoin(businessesTable, eq(businessesTable.id, invoicesTable.businessId))
      .innerJoin(customersTable, and(eq(customersTable.id, invoicesTable.customerId), eq(customersTable.businessId, invoicesTable.businessId)))
      .where(and(
        eq(businessesTable.autoReminders, true),
        receivableInvoice(invoicesTable),
        inArray(invoicesTable.status, ["unpaid", "partial"]),
        isNotNull(invoicesTable.dueDate),
        lt(invoicesTable.dueDate, today),
        isNotNull(customersTable.email),
        sql`${customersTable.email} <> ''`,
        or(isNull(invoicesTable.lastRemindedAt), lt(invoicesTable.lastRemindedAt, new Date(now.getTime() - WEEK_MS))),
      ))
      .limit(PER_SWEEP);

    let sent = 0;
    for (const row of due) {
      const inv = row.inv;
      // Marked first, so a failed or repeated sweep never sends twice in a week.
      await db.update(invoicesTable).set({ lastRemindedAt: now }).where(eq(invoicesTable.id, inv.id));
      try {
        await mailer.send(paymentReminderMessage(row.email!, {
          business: row.business, customer: inv.customerName, number: inv.invoiceNumber, date: inv.invoiceDate,
          dueDate: inv.dueDate!, balance: paise(dec(inv.grandTotal).minus(dec(inv.paidAmount))).toFixed(2),
          upiLink: (await upiPayment(inv))?.link, replyTo: row.replyTo,
        }));
        sent++;
      } catch (err) {
        logger.warn({ err, invoiceId: inv.id }, "Payment reminder not sent");
      }
    }
    return sent;
  });
}
