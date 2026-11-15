// Production entry for single-process hosting (Hostinger): the API also serves
// the built web app from the same origin. Build with `pnpm run build:hostinger`.
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
// Set here, not in the host's environment: the host also builds with those
// variables, and NODE_ENV=production there would skip the build tools.
process.env.NODE_ENV = "production";
process.env.WEB_DIST_DIR ??= path.join(root, "artifacts/gst-platform/dist/public");

await import("./artifacts/api-server/dist/index.mjs");
