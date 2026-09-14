import app from "./app";
import { logger } from "./lib/logger";
import { rootDb, inspectRls, describeRlsProblem } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Report whether the tenant policies actually bite for this connection.
 *
 * A superuser ignores row-level security entirely, and hosted Postgres tends to
 * hand out exactly that connection string — so the dangerous state is not
 * "RLS off", it is "RLS on and silently inert". Checked at boot so it is said
 * out loud rather than assumed.
 *
 * Deliberately not fatal: refusing to start would turn a defence-in-depth gap
 * into an outage, and the application's own query filters still scope every
 * query. It is loud instead.
 */
async function reportRlsStatus(): Promise<void> {
  try {
    const status = await inspectRls(async (query) => {
      const result: any = await rootDb.execute(sql.raw(query));
      return (result.rows ?? result) as Array<Record<string, unknown>>;
    });
    const problem = describeRlsProblem(status);
    if (problem) logger.warn({ role: status.role }, problem);
    else logger.info(
      { role: status.role, tables: status.protectedTables.length },
      "Row-level security is in effect",
    );
  } catch (err) {
    logger.warn({ err }, "Could not determine row-level security status");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

void reportRlsStatus();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
