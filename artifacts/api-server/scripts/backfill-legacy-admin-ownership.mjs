import { and, eq, isNull } from "drizzle-orm";
import { rootDb, usersTable, pool } from "@workspace/db";

try {
  const result = await rootDb.transaction(async (tx) => {
    const admins = await tx.select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(and(
        eq(usersTable.role, "admin"),
        eq(usersTable.isActive, true),
        isNull(usersTable.deletedAt),
      ));

    if (admins.length !== 1) {
      throw new Error(
        `Expected exactly one active admin to safely assign existing users; found ${admins.length}. ` +
        "No ownership was changed. Resolve legacy ownership explicitly before enabling admin isolation.",
      );
    }

    const updated = await tx.update(usersTable)
      .set({ createdByAdminId: admins[0].id })
      .where(and(eq(usersTable.role, "user"), isNull(usersTable.createdByAdminId)))
      .returning({ id: usersTable.id });

    return { adminEmail: admins[0].email, assigned: updated.length };
  });

  process.stdout.write(`Assigned ${result.assigned} existing user account(s) to the sole active admin.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Legacy ownership backfill failed"}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}