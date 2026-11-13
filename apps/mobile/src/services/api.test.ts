import * as SecureStore from "expo-secure-store";
import {
  ApiError,
  apiFetch,
  getApiBaseUrl,
  getStoredToken,
  setStoredToken,
  setUnauthorizedHandler,
} from "./api";

describe("api service", () => {
  const ENV_KEY = "EXPO_PUBLIC_API_URL";
  const originalFetch = global.fetch;
  const originalEnv = process.env[ENV_KEY];

  beforeEach(async () => {
    jest.clearAllMocks();
    await setStoredToken(null);
    setUnauthorizedHandler(null);
    delete process.env[ENV_KEY];
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalEnv !== undefined) {
      process.env[ENV_KEY] = originalEnv;
    } else {
      delete process.env[ENV_KEY];
    }
  });

  describe("getApiBaseUrl", () => {
    it("defaults to http://localhost:8080 when EXPO_PUBLIC_API_URL is unset", () => {
      expect(getApiBaseUrl()).toBe("http://localhost:8080");
    });

    it("returns EXPO_PUBLIC_API_URL when configured", () => {
      process.env[ENV_KEY] = "https://api.beo.cerdas.club";
      expect(getApiBaseUrl()).toBe("https://api.beo.cerdas.club");
    });
  });

  describe("token storage", () => {
    it("stores, retrieves, and deletes token in SecureStore", async () => {
      expect(await getStoredToken()).toBeNull();

      await setStoredToken("jwt-token-123");
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        expect.any(String),
        "jwt-token-123"
      );
      expect(await getStoredToken()).toBe("jwt-token-123");

      await setStoredToken(null);
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(expect.any(String));
      expect(await getStoredToken()).toBeNull();
    });
  });

  describe("apiFetch", () => {
    it("attaches Authorization header when token is stored and Content-Type for string body", async () => {
      await setStoredToken("my-secret-jwt");
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "1", ok: true }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const data = await apiFetch<{ id: string; ok: boolean }>("/v1/tickets/claim", {
        method: "POST",
        body: JSON.stringify({ claim_token: "abc" }),
      });

      expect(data).toEqual({ id: "1", ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:8080/v1/tickets/claim");
      const headers = new Headers(init.headers);
      expect(headers.get("Authorization")).toBe("Bearer my-secret-jwt");
      expect(headers.get("Content-Type")).toBe("application/json");
    });

    it("does not set Content-Type for FormData body", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ uploaded: true }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const formData = new FormData();
      formData.append("file", "dummy");

      await apiFetch("/v1/upload", {
        method: "POST",
        body: formData,
      });

      const [, init] = mockFetch.mock.calls[0];
      const headers = new Headers(init.headers);
      expect(headers.get("Content-Type")).toBeNull();
    });

    it("throws ApiError on non-ok response", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({ error: "Invalid claim token" }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      await expect(apiFetch("/v1/tickets/claim", { method: "POST" })).rejects.toThrow(
        ApiError
      );
      await expect(
        apiFetch("/v1/tickets/claim", { method: "POST" })
      ).rejects.toMatchObject({
        status: 400,
        message: "Invalid claim token",
      });
    });

    it("clears stored token and invokes unauthorized handler on 401", async () => {
      await setStoredToken("expired-jwt");
      const onUnauthorized = jest.fn();
      setUnauthorizedHandler(onUnauthorized);

      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ message: "Token expired" }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      await expect(apiFetch("/v1/me/tickets")).rejects.toMatchObject({
        status: 401,
        message: "Token expired",
      });

      expect(await getStoredToken()).toBeNull();
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });
  });
});
