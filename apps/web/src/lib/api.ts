export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export const API_BASE_URL =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE_URL) ||
  "http://localhost:8080";

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const baseUrl = API_BASE_URL.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${baseUrl}${normalizedPath}`;

  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) {
        headers[k] = v;
      }
    } else {
      Object.assign(headers, init.headers);
    }
  }

  // Automatically attach JWT token from localStorage if present
  if (typeof localStorage !== "undefined") {
    const token = localStorage.getItem("beo_token");
    if (token && !headers["Authorization"] && !headers["authorization"]) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  // Set default Content-Type for non-FormData bodies
  if (
    init?.body &&
    !(init.body instanceof FormData) &&
    !headers["Content-Type"] &&
    !headers["content-type"]
  ) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("beo_token");
        localStorage.removeItem("beo_user");
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("beo:unauthorized"));
      }
    }

    let errorMessage = response.statusText || "Request failed";
    try {
      const data = await response.json();
      if (data && typeof data === "object") {
        if (typeof data.error === "string") {
          errorMessage = data.error;
        } else if (typeof data.message === "string") {
          errorMessage = data.message;
        }
      }
    } catch {
      // response was not JSON
    }

    throw new ApiError(response.status, errorMessage);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}
