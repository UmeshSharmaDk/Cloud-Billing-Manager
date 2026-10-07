/**
 * Select by process mode, not just by whichever shared secret is present.
 * Production credentials must never redirect local development to live data.
 */
export function resolveApplicationDatabaseUrl(
  env: Record<string, string | undefined>,
): string {
  const isDevelopment = env.NODE_ENV === "development";
  const isTest = env.NODE_ENV === "test";
  const url = isTest
    ? env.TEST_APP_DATABASE_URL?.trim()
    : isDevelopment
    ? env.DEVELOPMENT_APP_DATABASE_URL?.trim() || env.DATABASE_URL?.trim()
    : env.APP_DATABASE_URL?.trim();

  if (!url) {
    throw new Error(
      isTest
        ? "TEST_APP_DATABASE_URL must be set to a disposable database. Tests never fall back to production credentials."
        : isDevelopment
        ? "DATABASE_URL or DEVELOPMENT_APP_DATABASE_URL must be set. Did you forget to provision a database?"
        : "APP_DATABASE_URL must be set to a dedicated NOSUPERUSER NOBYPASSRLS application role in production. DATABASE_URL is reserved for schema operations.",
    );
  }
  return url;
}
