import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "beo_auth_token";

let unauthorizedHandler: (() => void) | null = null;

/**
 * Error thrown when an API request returns a non-OK HTTP status.
 */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Returns the configured API base URL, defaulting to localhost:8080.
 */
export function getApiBaseUrl(): string {
  const envKey = "EXPO_PUBLIC_API_URL";
  return (
    process.env.EXPO_PUBLIC_API_URL ||
    process.env[envKey] ||
    "http://localhost:8080"
  );
}

/**
 * Reads the persisted JWT token from Expo SecureStore.
 */
export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

/**
 * Persists or deletes the JWT token in Expo SecureStore.
 */
export async function setStoredToken(token: string | null): Promise<void> {
  if (token === null) {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

/**
 * Registers a callback invoked whenever an API request returns HTTP 401.
 */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof body?.error === "string" && body.error.length > 0) {
      return body.error;
    }
    if (typeof body?.message === "string" && body.message.length > 0) {
      return body.message;
    }
  } catch {
    // Ignore non-JSON error bodies and fall back to status text.
  }
  return res.statusText || `Request failed with status ${res.status}`;
}

/**
 * Performs an authenticated JSON fetch against the BEO API.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getStoredToken();
  const headers = new Headers(init.headers);

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const isFormData =
    typeof FormData !== "undefined" && init.body instanceof FormData;
  if (typeof init.body === "string" && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = `${getApiBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401) {
      await setStoredToken(null);
      unauthorizedHandler?.();
    }
    const message = await extractErrorMessage(res);
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
