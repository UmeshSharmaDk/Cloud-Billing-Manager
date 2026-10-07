import assert from "node:assert/strict";
import { resolveApplicationDatabaseUrl } from "../../../lib/db/src/connection-config.ts";

const env = {
  DATABASE_URL: "postgresql://local-owner.invalid/local",
  APP_DATABASE_URL: "postgresql://production-app.invalid/live",
  DEVELOPMENT_APP_DATABASE_URL: "postgresql://local-app.invalid/scratch",
};

assert.equal(
  resolveApplicationDatabaseUrl({ ...env, NODE_ENV: "development" }),
  env.DEVELOPMENT_APP_DATABASE_URL,
);
assert.equal(
  resolveApplicationDatabaseUrl({
    ...env, NODE_ENV: "development", DEVELOPMENT_APP_DATABASE_URL: undefined,
  }),
  env.DATABASE_URL,
);
assert.throws(
  () => resolveApplicationDatabaseUrl({
    NODE_ENV: "development", APP_DATABASE_URL: env.APP_DATABASE_URL,
  }),
  /DATABASE_URL or DEVELOPMENT_APP_DATABASE_URL must be set/,
);
for (const NODE_ENV of ["production", undefined]) {
  assert.equal(resolveApplicationDatabaseUrl({ ...env, NODE_ENV }), env.APP_DATABASE_URL);
  assert.throws(
    () => resolveApplicationDatabaseUrl({ ...env, NODE_ENV, APP_DATABASE_URL: undefined }),
    /APP_DATABASE_URL must be set/,
  );
}
assert.throws(
  () => resolveApplicationDatabaseUrl({ ...env, NODE_ENV: "test" }),
  /TEST_APP_DATABASE_URL must be set/,
);
assert.equal(
  resolveApplicationDatabaseUrl({
    ...env, NODE_ENV: "test", TEST_APP_DATABASE_URL: env.DEVELOPMENT_APP_DATABASE_URL,
  }),
  env.DEVELOPMENT_APP_DATABASE_URL,
);
assert.equal(
  resolveApplicationDatabaseUrl({ ...env, NODE_ENV: "production", APP_DATABASE_URL: ` ${env.APP_DATABASE_URL} ` }),
  env.APP_DATABASE_URL,
);
console.log("Database connection selection passed: local mode ignores production credentials; production never falls back to owner credentials.");
