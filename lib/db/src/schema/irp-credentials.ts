import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * A business's login for the e-invoice system (IRP) API. Kept out of
 * `businesses` so GET /business can never return it. `clientSecret`,
 * `password` and `sek` are sealed with a key derived from SESSION_SECRET
 * (see api-server lib/secret-box.ts); the token is cached until it expires.
 */
export const irpCredentialsTable = pgTable("irp_credentials", {
  businessId: integer("business_id").primaryKey(),
  baseUrl: text("base_url").notNull(),
  gstin: text("gstin").notNull(),
  clientId: text("client_id").notNull(),
  clientSecret: text("client_secret").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  publicKey: text("public_key").notNull(),
  authToken: text("auth_token"),
  sek: text("sek"),
  tokenExpiry: timestamp("token_expiry", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IrpCredentials = typeof irpCredentialsTable.$inferSelect;
