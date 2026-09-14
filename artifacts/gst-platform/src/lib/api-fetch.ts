/**
 * Authenticated fetch for the handful of endpoints that have no generated
 * hook yet (the e-way bill routes are absent from the OpenAPI spec).
 *
 * The session travels as an `HttpOnly` cookie, so there is no token to read
 * here and none for a script to steal; `credentials: "include"` is what sends
 * it. State-changing requests echo the CSRF token from its script-readable
 * companion cookie.
 *
 * Prefer the generated hooks from `@workspace/api-client-react` wherever they
 * exist — this is a stopgap, not a second client.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)gst_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const method = (options?.method ?? "GET").toUpperCase();
  const csrf = SAFE_METHODS.has(method) ? null : readCsrfCookie();

  return fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...(options?.headers ?? {}),
    },
  });
}
