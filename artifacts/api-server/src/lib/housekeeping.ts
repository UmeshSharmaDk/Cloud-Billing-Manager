/**
 * Periodic deletion of rows that have stopped mattering.
 *
 * Two tables grow from traffic the server does not control: `login_attempts`
 * gets a row per failed sign-in keyed by the address the caller supplied, and
 * `revoked_tokens` gets one per sign-out. Neither had anything deleting it, so
 * both grew without bound — a run through a stolen credential list could leave
 * millions of `login_attempts` rows that every subsequent lockout lookup then
 * paid for.
 *
 * Both are pruned by the same rule: a row is removed once it can no longer
 * change any decision. That makes this pure housekeeping — it never alters
 * behaviour, only the cost of it.
 */

import { pruneLoginAttempts } from "../middleware/rate-limit";
import { pruneRevokedTokens } from "../routes/auth";
import { logger } from "./logger";

/** Often enough to stay small, rare enough to be invisible. */
const INTERVAL_MS = 15 * 60 * 1000;

export async function sweepOnce(): Promise<{ loginAttempts: number; revokedTokens: number }> {
  const [loginAttempts, revokedTokens] = await Promise.all([
    pruneLoginAttempts(),
    pruneRevokedTokens(),
  ]);
  return { loginAttempts, revokedTokens };
}

/**
 * Start the sweep. `unref` so a pending timer never holds the process open —
 * housekeeping must not be the reason a deployment fails to shut down.
 */
export function startHousekeeping(): NodeJS.Timeout {
  const run = () => {
    void sweepOnce()
      .then(({ loginAttempts, revokedTokens }) => {
        if (loginAttempts > 0 || revokedTokens > 0) {
          logger.info({ loginAttempts, revokedTokens }, "Pruned expired rows");
        }
      })
      // Never fatal: a failed sweep costs disk, not correctness, and the next
      // one will pick the rows up.
      .catch((err) => logger.warn({ err }, "Housekeeping sweep failed"));
  };

  run();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  return timer;
}
