import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../auth/AuthContext";
import { WalletPayoutsPage } from "./WalletPayoutsPage";

const mockUser = {
  id: "org-001",
  name: "Organizer One",
  email: "org@example.com",
  account_type: "standard" as const,
  created_at: "2026-11-01T00:00:00Z",
};

function renderWithProviders(queryClient?: QueryClient) {
  const qc =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

  return {
    queryClient: qc,
    ...render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <MemoryRouter>
            <WalletPayoutsPage />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    ),
  };
}

describe("WalletPayoutsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("beo_token", "fake-token");
    localStorage.setItem("beo_user", JSON.stringify(mockUser));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("blocks payout request when amount <= 0 or amount > balance", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/organizer/payouts")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ balance: 500000 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText(/500\.000|500,000/)).toBeInTheDocument();
    });

    const amountInput = screen.getByLabelText(/amount/i);
    const bankNameInput = screen.getByLabelText(/bank name/i);
    const accountNumberInput = screen.getByLabelText(/account number/i);
    const accountNameInput = screen.getByLabelText(/account holder name/i);
    const submitBtn = screen.getByRole("button", { name: /request payout/i });

    fireEvent.change(bankNameInput, { target: { value: "BCA" } });
    fireEvent.change(accountNumberInput, { target: { value: "1234567890" } });
    fireEvent.change(accountNameInput, { target: { value: "Organizer One" } });

    // Case 1: amount <= 0
    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/greater than 0/i);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2); // Initial GET wallet + GET payouts

    // Case 2: amount > balance
    fireEvent.change(amountInput, { target: { value: "600000" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/exceeds.*balance/i);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("submits POST /v1/organizer/payouts for valid amount and invalidates wallet and payouts queries", async () => {
    let balance = 500000;
    const payouts: unknown[] = [];

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/organizer/payouts") && init?.method === "POST") {
        balance = 300000;
        const created = {
          id: "pay-001",
          organizer_id: "org-001",
          amount: 200000,
          bank_name: "BCA",
          bank_account_number: "1234567890",
          bank_account_name: "Organizer One",
          status: "pending",
          created_at: "2026-11-13T10:00:00Z",
        };
        payouts.unshift(created);
        return new Response(JSON.stringify(created), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/v1/organizer/payouts")) {
        return new Response(JSON.stringify(payouts), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ balance }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    renderWithProviders(qc);

    await waitFor(() => {
      expect(screen.getByText(/500\.000|500,000/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/amount/i), {
      target: { value: "200000" },
    });
    fireEvent.change(screen.getByLabelText(/bank name/i), {
      target: { value: "BCA" },
    });
    fireEvent.change(screen.getByLabelText(/account number/i), {
      target: { value: "1234567890" },
    });
    fireEvent.change(screen.getByLabelText(/account holder name/i), {
      target: { value: "Organizer One" },
    });

    fireEvent.click(screen.getByRole("button", { name: /request payout/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/v1/organizer/payouts"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            amount: 200000,
            bank_name: "BCA",
            bank_account_number: "1234567890",
            bank_account_name: "Organizer One",
          }),
        })
      );
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["organizer", "wallet"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["organizer", "payouts"],
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/300\.000|300,000/)).toBeInTheDocument();
    });
  });
});
