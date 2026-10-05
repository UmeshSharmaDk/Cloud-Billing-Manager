---
name: Workspace CLI TypeScript runtime
description: Runtime behavior for one-off Node scripts that import TypeScript workspace packages.
---

Run operator and database scripts that import workspace TypeScript package exports with `tsx`, not plain Node. Node 24 can strip TypeScript, but it still rejects extensionless directory imports used by workspace source exports. The API server build hides this because its bundler resolves those imports.

**Why:** A direct Node invocation failed with `ERR_UNSUPPORTED_DIR_IMPORT` before it reached the script's guarded database operation; the existing `tsx` runner loaded it successfully.

**How to apply:** Add `tsx` as a development dependency of the package owning such scripts, use it in the package scripts, and verify guarded commands without supplying operator secrets.
