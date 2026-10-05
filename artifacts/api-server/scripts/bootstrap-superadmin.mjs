import { eq, sql } from "drizzle-orm";
import { pool, rootDb, usersTable } from "@workspace/db";
import { hashPassword } from "../src/lib/password.ts";
import { validatePassword } from "../src/lib/password-policy.ts";

const email = process.env.SUPERADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const name = process.env.SUPERADMIN_BOOTSTRAP_NAME?.trim();
const password = process.env.SUPERADMIN_BOOTSTRAP_PASSWORD;

try {
  if (!email || !name || !password) {
    throw new Error(
      "Set SUPERADMIN_BOOTSTRAP_EMAIL, SUPERADMIN_BOOTSTRAP_NAME, and SUPERADMIN_BOOTSTRAP_PASSWORD in the operator's secret environment before running this one-time command.",
    );
  }

  const policyFailure = await validatePassword(password);
  if (policyFailure) throw new Error(policyFailure.message);

  const created = await rootDb.transaction(async (tx) => {
    // Serialize simultaneous bootstrap attempts even when the users table has
    // no superadmin row to lock yet.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(571431992)`);
    const [existingSuperadmin] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.role, "superadmin")).limit(1);
    if (existingSuperadmin) throw new Error("A superadmin already exists; bootstrap is one-time only.");

    const [existingEmail] = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.email, email)).limit(1);
    if (existingEmail) {
      throw new Error("That email already belongs to an account. Bootstrap never promotes an existing account.");
    }

    const [user] = await tx.insert(usersTable).values({
      name,
      email,
      passwordHash: await hashPassword(password),
      role: "superadmin",
      isActive: true,
    }).returning({ id: usersTable.id, email: usersTable.email });
    return user;
  });

  process.stdout.write(`Created the initial superadmin account for ${created.email}.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Superadmin bootstrap failed"}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}