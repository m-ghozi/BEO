import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";

describe("LoginPage and RegisterPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("LoginPage", () => {
    it("renders email and password inputs and sign in button", () => {
      render(
        <AuthProvider>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /sign up/i })).toHaveAttribute(
        "href",
        "/register"
      );
    });

    it("displays error message when login API call fails", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Invalid email or password" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
      );

      render(
        <AuthProvider>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </AuthProvider>
      );

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "wrong@example.com" },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: "badpwd" },
      });
      fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Invalid email or password"
        );
      });
    });

    it("navigates on successful login", async () => {
      const mockUser = {
        id: "usr-1",
        name: "Test User",
        email: "test@example.com",
        account_type: "standard" as const,
        created_at: "2026-11-13T00:00:00Z",
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: mockUser,
            token: "valid-token",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );

      render(
        <AuthProvider>
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<div>Target Home Destination</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      );

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "test@example.com" },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: "secret123" },
      });
      fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

      await waitFor(() => {
        expect(
          screen.getByText("Target Home Destination")
        ).toBeInTheDocument();
      });
    });
  });

  describe("RegisterPage", () => {
    it("renders name, email, password, and account type radio options", () => {
      render(
        <AuthProvider>
          <MemoryRouter>
            <RegisterPage />
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /standard/i })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /agency/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /sign up/i })).toBeInTheDocument();
    });

    it("displays error message when registration API returns error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Email already registered" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        })
      );

      render(
        <AuthProvider>
          <MemoryRouter>
            <RegisterPage />
          </MemoryRouter>
        </AuthProvider>
      );

      fireEvent.change(screen.getByLabelText(/full name/i), {
        target: { value: "John Doe" },
      });
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "john@example.com" },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: "password123" },
      });
      fireEvent.click(screen.getByRole("button", { name: /sign up/i }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Email already registered"
        );
      });
    });

    it("allows selecting agency account type and registers successfully", async () => {
      const mockUser = {
        id: "usr-agency-1",
        name: "Agency Partner",
        email: "agency@example.com",
        account_type: "agency" as const,
        created_at: "2026-11-13T00:00:00Z",
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: mockUser,
            token: "valid-agency-token",
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" },
          }
        )
      );

      render(
        <AuthProvider>
          <MemoryRouter initialEntries={["/register"]}>
            <Routes>
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/" element={<div>Registered Home Destination</div>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      );

      fireEvent.change(screen.getByLabelText(/full name/i), {
        target: { value: "Agency Partner" },
      });
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "agency@example.com" },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: "password123" },
      });
      fireEvent.click(screen.getByText("Agency"));
      fireEvent.click(screen.getByRole("button", { name: /sign up/i }));

      await waitFor(() => {
        expect(
          screen.getByText("Registered Home Destination")
        ).toBeInTheDocument();
      });
    });
  });
});
