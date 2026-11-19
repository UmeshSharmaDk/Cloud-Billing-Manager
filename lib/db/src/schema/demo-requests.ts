import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * A "Book a free demo" request from the public website. It creates no account:
 * there is no public sign-up, and an admin is invited by the superadmin after
 * the demo. `status` is new, contacted or closed.
 */
export const demoRequestsTable = pgTable(
  "demo_requests",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    city: text("city"),
    businessType: text("business_type").notNull(),
    clientCount: integer("client_count"),
    message: text("message"),
    status: text("status").notNull().default("new"),
    sourceIp: text("source_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("demo_requests_created_at_idx").on(t.createdAt)],
);

export type DemoRequest = typeof demoRequestsTable.$inferSelect;
