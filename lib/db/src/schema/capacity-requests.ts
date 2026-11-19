import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * A request for more managed-user seats. The admin may pay `amountInr` online
 * (PayU); the superadmin still approves or declines it.
 */
export const capacityRequestsTable = pgTable(
  "capacity_requests",
  {
    id: serial("id").primaryKey(),
    adminId: integer("admin_id").notNull(),
    additionalUsers: integer("additional_users").notNull(),
    amountInr: integer("amount_inr").notNull(),
    status: text("status").notNull().default("pending"),
    reviewedByAdminId: integer("reviewed_by_admin_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    grantedUserLimit: integer("granted_user_limit"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    payuTxnid: text("payu_txnid"),
    payuPaymentId: text("payu_payment_id"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [
    index("capacity_requests_admin_id_idx").on(table.adminId),
    index("capacity_requests_created_at_idx").on(table.createdAt),
    uniqueIndex("capacity_requests_payu_txnid_idx").on(table.payuTxnid),
    uniqueIndex("capacity_requests_one_pending_per_admin_idx")
      .on(table.adminId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export type CapacityRequest = typeof capacityRequestsTable.$inferSelect;