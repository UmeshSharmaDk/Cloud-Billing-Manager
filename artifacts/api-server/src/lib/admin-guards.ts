/**
 * Guards against an administrator locking everyone out.
 *
 * Nothing stopped an admin demoting, deactivating or deleting the last
 * remaining administrator — including themselves — which leaves a platform
 * with no way back in short of editing the database by hand.
 */

import { db, usersTable } from "@workspace/db";
import { eq, and, isNull, ne, count } from "drizzle-orm";

/**
 * Returns an error message when the change would remove the final admin, or
 * null when it is safe.
 */
export async function assertNotLastAdmin(
  target: { id: number; role: string },
  newRole: string,
): Promise<string | null> {
  // Only losing an admin can be a problem.
  if (target.role !== "admin" || newRole === "admin") return null;

  const [{ count: remaining }] = await db
    .select({ count: count() })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "admin"),
        eq(usersTable.isActive, true),
        isNull(usersTable.deletedAt),
        ne(usersTable.id, target.id),
      ),
    );

  return Number(remaining) > 0
    ? null
    : "This is the last active administrator. Promote another account first.";
}

/** Refuse actions an administrator would regret applying to their own account. */
export function assertNotSelf(actorId: number, targetId: number): string | null {
  return actorId === targetId
    ? "You cannot perform this action on your own account."
    : null;
}
