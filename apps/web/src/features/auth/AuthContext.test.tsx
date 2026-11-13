import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth, ProtectedRoute } from "./AuthContext";
import { apiFetch, ApiError } from "../../lib/api";

function TestAuthConsumer() {
  const { user, token, isAuthenticated, login, register, logout } = useAuth();

  return (
    <div>
      <div data-testid="auth-status">{isAuthenticated ? "authenticated" : "anonymous"}</div>
      <div data-testid="user-email">{user ? user.email : "none"}</div>
      <div data-testid="user-role">{user ? user.account_type : "none"}</div>
      <div data-testid="user-token">{token || "none"}</div>
      <button
        onClick={() =>
          login({ email: "user@example.com", password: "password123" })
        }
      >
        Trigger Login
      </button>
      <button
        onClick={() =>
          register({
            name: "Agency Admin",
            email: "agency@example.com",
            password: "password123",
            account_type: "agency",
          })
        }
      >
        Trigger Register
      </button>
      <button onClick={() => logout()}>Trigger Logout</button>
    </div>
  );
}

describe("AuthContext and ProtectedRoute", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("initializes with unauthenticated state when localStorage is empty", () => {
    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("auth-status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("user-email")).toHaveTextContent("none");
    expect(screen.getByTestId("user-token")).toHaveTextContent("none");
  });

  it("restores user and token from localStorage if present", () => {
    const mockUser = {
      id: "usr-1",
      name: "Existing User",
      email: "existing@example.com",
      account_type: "standard" as const,
      created_at: "2026-11-13T00:00:00Z",
    };
    localStorage.setItem("beo_token", "saved-jwt-token");
    localStorage.setItem("beo_user", JSON.stringify(mockUser));

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated");
    expect(screen.getByTestId("user-email")).toHaveTextContent("existing@example.com");
    expect(screen.getByTestId("user-token")).toHaveTextContent("saved-jwt-token");
  });

  it("handles login by calling API, saving to localStorage, and updating state", async () => {
    const mockUser = {
      id: "usr-1",
      name: "Logged In User",
      email: "user@example.com",
      account_type: "standard" as const,
      created_at: "2026-11-13T00:00:00Z",
    };
    const mockToken = "jwt-login-token-123";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: mockUser,
          token: mockToken,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    fireEvent.click(screen.getByText("Trigger Login"));

    await waitFor(() => {
      expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated");
    });
    expect(screen.getByTestId("user-email")).toHaveTextContent("user@example.com");
    expect(screen.getByTestId("user-token")).toHaveTextContent(mockToken);
    expect(localStorage.getItem("beo_token")).toBe(mockToken);
    expect(JSON.parse(localStorage.getItem("beo_user") || "{}")).toEqual(mockUser);
  });

  it("handles register by calling API, saving to localStorage, and updating state", async () => {
    const mockUser = {
      id: "usr-agency-1",
      name: "Agency Admin",
      email: "agency@example.com",
      account_type: "agency" as const,
      created_at: "2026-11-13T00:00:00Z",
    };
    const mockToken = "jwt-agency-token-456";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          user: mockUser,
          token: mockToken,
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    fireEvent.click(screen.getByText("Trigger Register"));

    await waitFor(() => {
      expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated");
    });
    expect(screen.getByTestId("user-email")).toHaveTextContent("agency@example.com");
    expect(screen.getByTestId("user-role")).toHaveTextContent("agency");
    expect(localStorage.getItem("beo_token")).toBe(mockToken);
  });

  it("handles logout by clearing localStorage and state", async () => {
    localStorage.setItem("beo_token", "existing-token");
    localStorage.setItem(
      "beo_user",
      JSON.stringify({
        id: "usr-1",
        name: "User",
        email: "user@example.com",
        account_type: "standard",
        created_at: "2026-11-13T00:00:00Z",
      })
    );

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    expect(screen.getByTestId("auth-status")).toHaveTextContent("authenticated");

    fireEvent.click(screen.getByText("Trigger Logout"));

    expect(screen.getByTestId("auth-status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("user-token")).toHaveTextContent("none");
    expect(localStorage.getItem("beo_token")).toBeNull();
    expect(localStorage.getItem("beo_user")).toBeNull();
  });

  describe("ProtectedRoute", () => {
    it("redirects unauthenticated users to /login", () => {
      render(
        <AuthProvider>
          <MemoryRouter initialEntries={["/protected"]}>
            <Routes>
              <Route path="/login" element={<div>Login Page Screen</div>} />
              <Route
                path="/protected"
                element={
                  <ProtectedRoute>
                    <div>Secret Protected Content</div>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByText("Login Page Screen")).toBeInTheDocument();
      expect(screen.queryByText("Secret Protected Content")).not.toBeInTheDocument();
    });

    it("renders children when authenticated and no accountType restriction", () => {
      localStorage.setItem("beo_token", "token-123");
      localStorage.setItem(
        "beo_user",
        JSON.stringify({
          id: "usr-1",
          name: "Standard User",
          email: "std@example.com",
          account_type: "standard",
          created_at: "2026-11-13T00:00:00Z",
        })
      );

      render(
        <AuthProvider>
          <MemoryRouter initialEntries={["/protected"]}>
            <Routes>
              <Route
                path="/protected"
                element={
                  <ProtectedRoute>
                    <div>Secret Protected Content</div>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByText("Secret Protected Content")).toBeInTheDocument();
    });

    it("displays 403 Permission Denied when user account_type does not match required accountType", () => {
      localStorage.setItem("beo_token", "token-123");
      localStorage.setItem(
        "beo_user",
        JSON.stringify({
          id: "usr-1",
          name: "Standard User",
          email: "std@example.com",
          account_type: "standard",
          created_at: "2026-11-13T00:00:00Z",
        })
      );

      render(
        <AuthProvider>
          <MemoryRouter initialEntries={["/agency"]}>
            <Routes>
              <Route
                path="/agency"
                element={
                  <ProtectedRoute accountType="agency">
                    <div>Agency Portal Content</div>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByRole("alert")).toHaveTextContent(
        /403.*Permission Denied/i
      );
      expect(screen.queryByText("Agency Portal Content")).not.toBeInTheDocument();
    });

    it("renders children when user account_type matches required accountType", () => {
      localStorage.setItem("beo_token", "token-agency");
      localStorage.setItem(
        "beo_user",
        JSON.stringify({
          id: "usr-agency",
          name: "Agency User",
          email: "agency@example.com",
          account_type: "agency",
          created_at: "2026-11-13T00:00:00Z",
        })
      );

      render(
        <AuthProvider>
          <MemoryRouter initialEntries={["/agency"]}>
            <Routes>
              <Route
                path="/agency"
                element={
                  <ProtectedRoute accountType="agency">
                    <div>Agency Portal Content</div>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByText("Agency Portal Content")).toBeInTheDocument();
    });
  });

  describe("apiFetch", () => {
    it("attaches Authorization header if beo_token is in localStorage", async () => {
      localStorage.setItem("beo_token", "saved-token-abc");

      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const res = await apiFetch<{ message: string }>("/v1/events");
      expect(res.message).toBe("ok");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/v1/events"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer saved-token-abc",
          }),
        })
      );
    });

    it("throws ApiError with status and message on error response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "Invalid credentials" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      await expect(apiFetch("/v1/auth/login")).rejects.toThrow(
        "Invalid credentials"
      );
      await expect(apiFetch("/v1/auth/login")).rejects.toBeInstanceOf(ApiError);
    });

    it("clears localStorage session on 401 response", async () => {
      localStorage.setItem("beo_token", "expired-token");
      localStorage.setItem("beo_user", JSON.stringify({ id: "usr-1" }));

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Token expired" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      try {
        await apiFetch("/v1/me");
      } catch {
        // Expected ApiError
      }

      expect(localStorage.getItem("beo_token")).toBeNull();
      expect(localStorage.getItem("beo_user")).toBeNull();
    });
  });
});
