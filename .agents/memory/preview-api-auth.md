---
name: Preview API authentication
description: Environment and database prerequisites for cookie-authenticated browser requests in the GST platform preview.
---

The API workflow must provide the browser preview origin through `ALLOWED_ORIGINS`; wildcard CORS cannot be combined with credentialed cookies. The development database must also be synchronized with the current Drizzle schema before auth can work, including rate-limit and user-session columns.

**Why:** A stale API process can hide both configuration and schema drift until it is restarted; then browser sessions fail and unrelated authenticated mutations appear to be form errors.

**How to apply:** When restarting the API after auth or security changes, verify the startup logs, check `/api/healthz` with an `Origin` header, and confirm the development schema is current before debugging protected CRUD forms.