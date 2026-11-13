import React from "react";
import { Text, Pressable, View } from "react-native";
import { render, fireEvent, waitFor, act } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as api from "../services/api";
import * as notifications from "../services/notifications";
import { AuthProvider, useAuth } from "./AuthContext";

function AuthConsumer() {
  const { user, token, isLoading, login, register, logout, syncPushToken } =
    useAuth();

  return (
    <View>
      <Text testID="loading">{String(isLoading)}</Text>
      <Text testID="token">{token ?? "none"}</Text>
      <Text testID="user">{user ? `${user.id}:${user.email}` : "none"}</Text>
      <Pressable
        testID="login-btn"
        onPress={() => {
          void login("alice@example.com", "secret123").catch(() => undefined);
        }}
      />
      <Pressable
        testID="register-btn"
        onPress={() => {
          void register("Alice", "alice@example.com", "secret123").catch(
            () => undefined
          );
        }}
      />
      <Pressable
        testID="logout-btn"
        onPress={() => {
          void logout();
        }}
      />
      <Pressable
        testID="sync-push-btn"
        onPress={() => {
          void syncPushToken();
        }}
      />
    </View>
  );
}

describe("AuthContext", () => {
  const originalFetch = global.fetch;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await api.setStoredToken(null);
    api.setUnauthorizedHandler(null);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("restores persisted token and user on mount", async () => {
    await api.setStoredToken("persisted-jwt");
    await AsyncStorage.setItem(
      "beo_auth_user",
      JSON.stringify({
        id: "user-1",
        name: "Alice",
        email: "alice@example.com",
        account_type: "standard",
        created_at: "2026-01-01T00:00:00Z",
      })
    );

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getByTestId("loading").props.children).toBe("false");
    });
    expect(getByTestId("token").props.children).toBe("persisted-jwt");
    expect(getByTestId("user").props.children).toBe("user-1:alice@example.com");
  });

  it("logs in, persists token and user, and syncs push token in background", async () => {
    jest
      .spyOn(notifications, "registerForPushNotificationsAsync")
      .mockResolvedValue("ExponentPushToken[abc]");

    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          token: "jwt-login-1",
          user: {
            id: "user-1",
            name: "Alice",
            email: "alice@example.com",
            account_type: "standard",
            created_at: "2026-01-01T00:00:00Z",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getByTestId("loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.press(getByTestId("login-btn"));
    });

    await waitFor(() => {
      expect(getByTestId("token").props.children).toBe("jwt-login-1");
      expect(getByTestId("user").props.children).toBe(
        "user-1:alice@example.com"
      );
    });

    expect(await api.getStoredToken()).toBe("jwt-login-1");

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://localhost:8080/v1/auth/login"
    );
    expect(mockFetch.mock.calls[1][0]).toBe(
      "http://localhost:8080/v1/me/push-token"
    );
    expect(JSON.parse(mockFetch.mock.calls[1][1].body as string)).toEqual({
      token: "ExponentPushToken[abc]",
    });
  });

  it("registers a standard account and persists session", async () => {
    jest
      .spyOn(notifications, "registerForPushNotificationsAsync")
      .mockResolvedValue(null);

    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        token: "jwt-reg-1",
        user: {
          id: "user-2",
          name: "Alice",
          email: "alice@example.com",
          account_type: "standard",
          created_at: "2026-01-01T00:00:00Z",
        },
      }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getByTestId("loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.press(getByTestId("register-btn"));
    });

    await waitFor(() => {
      expect(getByTestId("token").props.children).toBe("jwt-reg-1");
      expect(getByTestId("user").props.children).toBe(
        "user-2:alice@example.com"
      );
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8080/v1/auth/register");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Alice",
      email: "alice@example.com",
      password: "secret123",
      account_type: "standard",
    });
  });

  it("logs out and clears token and persisted user", async () => {
    await api.setStoredToken("persisted-jwt");
    await AsyncStorage.setItem(
      "beo_auth_user",
      JSON.stringify({
        id: "user-1",
        name: "Alice",
        email: "alice@example.com",
        account_type: "standard",
        created_at: "2026-01-01T00:00:00Z",
      })
    );

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getByTestId("token").props.children).toBe("persisted-jwt");
    });

    await act(async () => {
      fireEvent.press(getByTestId("logout-btn"));
    });

    await waitFor(() => {
      expect(getByTestId("token").props.children).toBe("none");
      expect(getByTestId("user").props.children).toBe("none");
    });
    expect(await api.getStoredToken()).toBeNull();
    expect(await AsyncStorage.getItem("beo_auth_user")).toBeNull();
  });

  it("clears auth state when unauthorizedHandler is triggered on 401", async () => {
    await api.setStoredToken("expired-jwt");
    await AsyncStorage.setItem(
      "beo_auth_user",
      JSON.stringify({
        id: "user-1",
        name: "Alice",
        email: "alice@example.com",
        account_type: "standard",
        created_at: "2026-01-01T00:00:00Z",
      })
    );

    const { getByTestId } = render(
      <AuthProvider>
        <AuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(getByTestId("token").props.children).toBe("expired-jwt");
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ error: "Unauthorized" }),
    }) as unknown as typeof fetch;

    await act(async () => {
      await expect(api.apiFetch("/v1/me/tickets")).rejects.toMatchObject({
        status: 401,
      });
    });

    await waitFor(() => {
      expect(getByTestId("token").props.children).toBe("none");
      expect(getByTestId("user").props.children).toBe("none");
    });
  });
});
