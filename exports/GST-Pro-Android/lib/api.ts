import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";

// Public backend hostname, baked into the APK at build time (see .env).
const host = process.env.EXPO_PUBLIC_DOMAIN;
export const API_BASE = host ? `https://${host}/api` : "";

const TOKEN_KEY = "gstpro.session";

export const loadToken = () => SecureStore.getItemAsync(TOKEN_KEY);
export const saveToken = (token: string) => SecureStore.setItemAsync(TOKEN_KEY, token);
export const clearToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message);
  }
  get code(): string | undefined {
    return this.data?.code;
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
  if (!API_BASE) throw new ApiError(0, "This app was not set up correctly. Please install it again.");
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
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status}).`, data);
  }
  return data as T;
}

/** POST a file from the phone as the request body (the server reads PDFs for the importers). */
export async function apiUpload<T>(path: string, uri: string, contentType: string): Promise<T> {
  if (!API_BASE) throw new ApiError(0, "This app was not set up correctly. Please install it again.");
  let res: FileSystem.FileSystemUploadResult;
  try {
    res = await FileSystem.uploadAsync(API_BASE + path, uri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { Accept: "application/json", "Content-Type": contentType, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  let data: any = null;
  try { data = JSON.parse(res.body); } catch { /* not JSON: the status decides */ }
  if (res.status < 200 || res.status >= 300) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, data?.error ?? (res.status === 413 ? "That file is too large." : `Request failed (${res.status}).`), data);
  }
  return data as T;
}

/** Adds `asUser` so an admin reads one of their users' records (read-only on the server). */
export const viewAs = (path: string, asUser?: string) =>
  asUser ? `${path}${path.includes("?") ? "&" : "?"}asUser=${encodeURIComponent(asUser)}` : path;
