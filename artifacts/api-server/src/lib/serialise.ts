/**
 * Response shaping shared across routers.
 *
 * `mapUser` existed in two files and `mapInvoice`/`mapPurchase` in two each.
 * Duplication is how a fix lands in one copy and misses the other — exactly
 * how F-05 ended up correct in forty query sites and wrong in four.
 */

import type { User } from "@workspace/db";

/**
 * The public view of a user. Everything not listed here — `passwordHash`,
 * `tokenVersion`, `deletedAt` — stays server-side, so adding a sensitive
 * column to the table cannot leak it through an existing endpoint.
 */
export function mapUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    subscriptionStatus: user.subscriptionStatus,
    subscriptionEnd: user.subscriptionEnd,
    businessId: user.businessId,
    createdAt: user.createdAt,
  };
}
