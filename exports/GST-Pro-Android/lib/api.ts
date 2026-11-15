import * as SecureStore from "expo-secure-store";

// Public backend hostname, baked into the APK at build time (see .env).
const host = process.env.EXPO_PUBLIC_DOMAIN;
export const API_BASE = host ? `https://${host}/api` : "";

const TOKEN_KEY = "gstpro.session";

export const loadToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const saveToken = (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token);
export const clearToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: () => void = () => {};

export function setSession(next: string | null, handler?: () => void) {
  token = next;
  if (handler) onUnauthorized = handler;
}

/**
 * The server accepts a bearer token from native clients and skips the browser
 * CSRF check for it. Cookies are omitted so the token is the only credential.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!API_BASE) throw new ApiError(0, "This build has no server address. Rebuild with EXPO_PUBLIC_DOMAIN set.");
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method: init.method ?? "GET",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`);
  }
  return data as T;
}
