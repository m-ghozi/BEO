import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../auth/AuthContext";
import { AppRoutes } from "../../App";
import { AdminDashboardPage } from "./AdminDashboardPage";

const standardUser = {
  id: "usr-std-01",
  name: "Standard User",
  email: "standard@example.com",
  account_type: "standard" as const,
  created_at: "2026-11-01T00:00:00Z",
};

const adminUser = {
  id: "usr-admin-01",
  name: "Platform Admin",
  email: "admin@example.com",
  account_type: "platform_admin" as const,
  created_at: "2026-11-01T00:00:00Z",
};

function renderAppAtRoute(initialRoute: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialRoute]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function renderAdminPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter>
            <AdminDashboardPage />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    ),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AdminDashboardPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("blocks non-admin users from accessing /admin with 403 Forbidden alert", async () => {
    localStorage.setItem("beo_token", "fake-token");
    localStorage.setItem("beo_user", JSON.stringify(standardUser));

    renderAppAtRoute("/admin");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/403/);
    expect(alert).toHaveTextContent(/Permission Denied/i);
    expect(alert).toHaveTextContent(/platform_admin/i);
    expect(screen.queryByRole("link", { name: /^Admin$/i })).not.toBeInTheDocument();
  });

  it("shows Admin nav link and renders overview metrics for platform_admin", async () => {
    localStorage.setItem("beo_token", "fake-admin-token");
    localStorage.setItem("beo_user", JSON.stringify(adminUser));

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/v1/admin/overview")) {
          return jsonResponse({
            total_users: 42,
            total_events: 12,
            paid_orders: 88,
            gross_revenue: 15000000,
            total_commission: 750000,
            pending_payouts: 3,
          });
        }
        return jsonResponse({});
      });

    renderAppAtRoute("/admin");

    expect(
      await screen.findByRole("link", { name: /^Admin$/i })
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Total Users")).toBeInTheDocument();
    });
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Total Events")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Paid Orders")).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText("Gross Revenue")).toBeInTheDocument();
    expect(screen.getByText(/15\.000\.000|15,000,000/)).toBeInTheDocument();
    expect(screen.getByText("Platform Commission")).toBeInTheDocument();
    expect(screen.getByText(/750\.000|750,000/)).toBeInTheDocument();
    expect(screen.getByText("Pending Payouts")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/v1/admin/overview"),
      expect.anything()
    );
  });

  it("processes payout approve, complete, and reject actions via POST /v1/admin/payouts/:id/process", async () => {
    localStorage.setItem("beo_token", "fake-admin-token");
    localStorage.setItem("beo_user", JSON.stringify(adminUser));

    const mockPayouts = [
      {
        id: "pay-101",
        organizer_id: "org-1",
        organizer_name: "Alice Organizer",
        organizer_email: "alice@org.test",
        amount: 500000,
        bank_name: "BCA",
        bank_account_number: "1234567890",
        bank_account_name: "Alice Org",
        status: "pending",
        created_at: "2026-11-13T08:00:00Z",
      },
      {
        id: "pay-102",
        organizer_id: "org-2",
        organizer_name: "Bob Organizer",
        organizer_email: "bob@org.test",
        amount: 300000,
        bank_name: "Mandiri",
        bank_account_number: "0987654321",
        bank_account_name: "Bob Org",
        status: "approved",
        created_at: "2026-11-13T09:00:00Z",
      },
    ];

    const processCalls: Array<{ url: string; body: unknown }> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/admin/overview")) {
        return jsonResponse({
          total_users: 10,
          total_events: 2,
          paid_orders: 5,
          gross_revenue: 1000000,
          total_commission: 50000,
          pending_payouts: 1,
        });
      }
      if (url.endsWith("/v1/admin/payouts")) {
        return jsonResponse(mockPayouts);
      }
      if (url.includes("/v1/admin/payouts/") && url.endsWith("/process")) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        processCalls.push({ url, body });
        const id = url.split("/v1/admin/payouts/")[1].split("/process")[0];
        const statusMap: Record<string, string> = {
          approve: "approved",
          complete: "paid",
          reject: "rejected",
        };
        const target = mockPayouts.find((p) => p.id === id) ?? mockPayouts[0];
        return jsonResponse({
          ...target,
          status: statusMap[body.action] ?? target.status,
        });
      }
      return jsonResponse({});
    });

    const { queryClient } = renderAdminPage();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByRole("tab", { name: /Payout Requests/i }));

    await waitFor(() => {
      expect(screen.getByText("Alice Organizer")).toBeInTheDocument();
      expect(screen.getByText("Bob Organizer")).toBeInTheDocument();
    });

    // Approve pay-101
    fireEvent.click(screen.getAllByRole("button", { name: /^Approve$/i })[0]);
    await waitFor(() => {
      expect(processCalls).toHaveLength(1);
    });
    expect(processCalls[0].url).toContain("/v1/admin/payouts/pay-101/process");
    expect(processCalls[0].body).toEqual({ action: "approve" });

    // Mark Paid on pay-102 (second row's Mark Paid button)
    fireEvent.click(screen.getAllByRole("button", { name: /^Mark Paid$/i })[1]);
    await waitFor(() => {
      expect(processCalls).toHaveLength(2);
    });
    expect(processCalls[1].url).toContain("/v1/admin/payouts/pay-102/process");
    expect(processCalls[1].body).toEqual({ action: "complete" });

    // Reject pay-101 with note
    const noteInput = screen.getByLabelText(
      /Note for Alice Organizer payout/i
    );
    fireEvent.change(noteInput, { target: { value: "Invalid bank account" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^Reject$/i })[0]);
    await waitFor(() => {
      expect(processCalls).toHaveLength(3);
    });
    expect(processCalls[2].url).toContain("/v1/admin/payouts/pay-101/process");
    expect(processCalls[2].body).toEqual({
      action: "reject",
      note: "Invalid bank account",
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["admin", "payouts"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["admin", "overview"],
    });
  });

  it("updates commission rate via PUT /v1/admin/commissions/:eventType", async () => {
    localStorage.setItem("beo_token", "fake-admin-token");
    localStorage.setItem("beo_user", JSON.stringify(adminUser));

    const putCalls: Array<{ url: string; body: unknown }> = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/admin/overview")) {
        return jsonResponse({
          total_users: 1,
          total_events: 1,
          paid_orders: 0,
          gross_revenue: 0,
          total_commission: 0,
          pending_payouts: 0,
        });
      }
      if (url.endsWith("/v1/admin/commissions")) {
        return jsonResponse([
          {
            event_type: "community",
            rate_percent: 2.5,
            updated_at: "2026-11-13T00:00:00Z",
          },
          {
            event_type: "conference",
            rate_percent: 5,
            updated_at: "2026-11-13T00:00:00Z",
          },
        ]);
      }
      if (
        url.includes("/v1/admin/commissions/") &&
        init?.method === "PUT"
      ) {
        const body = init.body ? JSON.parse(String(init.body)) : {};
        putCalls.push({ url, body });
        return jsonResponse({
          event_type: "conference",
          rate_percent: body.rate_percent,
          updated_at: "2026-11-13T12:00:00Z",
        });
      }
      return jsonResponse({});
    });

    const { queryClient } = renderAdminPage();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByRole("tab", { name: /Commission Rates/i }));

    const confInput = await screen.findByLabelText(
      /Commission rate for conference/i
    );
    fireEvent.change(confInput, { target: { value: "7.5" } });

    const saveButtons = screen.getAllByRole("button", { name: /^Save$/i });
    fireEvent.click(saveButtons[1]);

    await waitFor(() => {
      expect(putCalls).toHaveLength(1);
    });
    expect(putCalls[0].url).toContain("/v1/admin/commissions/conference");
    expect(putCalls[0].body).toEqual({ rate_percent: 7.5 });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["admin", "commissions"],
    });
  });

  it("renders Events & Users and Audit Logs tabs", async () => {
    localStorage.setItem("beo_token", "fake-admin-token");
    localStorage.setItem("beo_user", JSON.stringify(adminUser));

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/v1/admin/overview")) {
        return jsonResponse({
          total_users: 1,
          total_events: 1,
          paid_orders: 0,
          gross_revenue: 0,
          total_commission: 0,
          pending_payouts: 0,
        });
      }
      if (url.includes("/v1/admin/events")) {
        return jsonResponse([
          {
            id: "evt-1",
            organizer_id: "org-1",
            organizer_name: "Alice Organizer",
            organizer_email: "alice@org.test",
            title: "Tech Summit 2026",
            slug: "tech-summit-2026",
            event_type: "conference",
            start_at: "2026-12-01T09:00:00Z",
            end_at: "2026-12-01T17:00:00Z",
            venue: "Jakarta",
            status: "published",
            created_at: "2026-11-01T00:00:00Z",
          },
        ]);
      }
      if (url.includes("/v1/admin/users")) {
        return jsonResponse([adminUser, standardUser]);
      }
      if (url.includes("/v1/admin/audit-events")) {
        return jsonResponse([
          {
            id: "aud-1",
            event_type: "payout.approved",
            ip_address: "127.0.0.1",
            metadata: { payout_id: "pay-101" },
            created_at: "2026-11-13T10:00:00Z",
          },
        ]);
      }
      return jsonResponse({});
    });

    renderAdminPage();

    fireEvent.click(screen.getByRole("tab", { name: /Events & Users/i }));
    const eventLink = await screen.findByRole("link", {
      name: /Tech Summit 2026/i,
    });
    expect(eventLink).toHaveAttribute("href", "/events/tech-summit-2026");
    expect(screen.getByText("standard@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Audit Logs/i }));
    expect(await screen.findByText("payout.approved")).toBeInTheDocument();
    expect(screen.getByText("127.0.0.1")).toBeInTheDocument();
    expect(screen.getByText('{"payout_id":"pay-101"}')).toBeInTheDocument();
  });
});
