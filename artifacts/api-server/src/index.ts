import app from "./app";
import { logger } from "./lib/logger";
import { startHousekeeping } from "./lib/housekeeping";
import { checkMailTransport } from "./lib/mailer";
import { pool, rootDb, inspectRls, describeRlsProblem } from "@workspace/db";
import { config } from "./lib/config";
import { sql } from "drizzle-orm";

/**
 * Report whether the tenant policies actually bite for this connection.
 *
 * A superuser ignores row-level security entirely, and hosted Postgres tends to
 * hand out exactly that connection string — so the dangerous state is not
 * "RLS off", it is "RLS on and silently inert". Checked at boot so it is said
 * out loud rather than assumed.
 *
 * Development remains available for iteration with a local owner connection,
 * but production must fail closed when the policies do not protect this role.
 * Application query filters remain a separate layer of defence.
 */
async function reportRlsStatus(): Promise<boolean> {
  try {
    const status = await inspectRls(async (query) => {
      const result: any = await rootDb.execute(sql.raw(query));
      return (result.rows ?? result) as Array<Record<string, unknown>>;
    });
    const problem = describeRlsProblem(status);
    if (problem) {
      logger.warn({ role: status.role }, problem);
      return false;
    }
    logger.info(
      { role: status.role, tables: status.protectedTables.length },
      "Row-level security is in effect",
    );
    return true;
  } catch (err) {
    logger.error({ err }, "Could not determine row-level security status");
    return false;
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

async function start(): Promise<void> {
  const rlsIsEffective = await reportRlsStatus();
  if (!rlsIsEffective && !config.isDevelopment) {
    logger.fatal(
      "Refusing to start the production API because row-level security is not effective",
    );
    await pool.end();
    process.exitCode = 1;
    return;
  }

  await checkMailTransport();
  startHousekeeping();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

void start();
