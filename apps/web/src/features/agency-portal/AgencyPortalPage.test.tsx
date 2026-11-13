import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../auth/AuthContext";
import { AppRoutes } from "../../App";

const standardUser = {
  id: "usr-std-01",
  name: "Standard User",
  email: "standard@example.com",
  account_type: "standard" as const,
  created_at: "2026-11-01T00:00:00Z",
};

const agencyUser = {
  id: "usr-agency-01",
  name: "Acme Agency",
  email: "agency@example.com",
  account_type: "agency" as const,
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

describe("AgencyPortalPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("blocks non-agency account from accessing /agency with 403 Forbidden alert", async () => {
    localStorage.setItem("beo_token", "fake-token");
    localStorage.setItem("beo_user", JSON.stringify(standardUser));

    renderAppAtRoute("/agency");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/403/);
    expect(alert).toHaveTextContent(/Permission Denied/i);
    expect(alert).toHaveTextContent(/agency/i);
    expect(screen.queryByLabelText(/Event ID/i)).not.toBeInTheDocument();
  });

  it("renders agency portal for agency account and issues tickets rendering claim_token URLs", async () => {
    localStorage.setItem("beo_token", "fake-agency-token");
    localStorage.setItem("beo_user", JSON.stringify(agencyUser));

    const mockTickets = [
      {
        id: "tkt-001",
        order_id: "ord-001",
        ticket_type_id: "tt-101",
        event_id: "evt-999",
        agency_id: "usr-agency-01",
        attendee_name: "Alice Smith",
        attendee_email: "alice@example.com",
        ticket_code: "BEO-TKT-ALICE1",
        qr_signature: "sig-alice",
        claim_token: "claim-tok-alice-12345",
        status: "valid",
        created_at: "2026-11-13T00:00:00Z",
      },
      {
        id: "tkt-002",
        order_id: "ord-001",
        ticket_type_id: "tt-101",
        event_id: "evt-999",
        agency_id: "usr-agency-01",
        attendee_name: "Bob Jones",
        attendee_email: "bob@example.com",
        ticket_code: "BEO-TKT-BOB2",
        qr_signature: "sig-bob",
        claim_token: "claim-tok-bob-67890",
        status: "valid",
        created_at: "2026-11-13T00:00:00Z",
      },
    ];

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockTickets), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    // Mock clipboard
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    renderAppAtRoute("/agency");

    // Agency Portal heading and inputs should be visible
    expect(await screen.findByRole("heading", { name: /Agency Portal/i })).toBeInTheDocument();

    const eventIdInput = screen.getByLabelText(/Event ID/i);
    const ticketTypeIdInput = screen.getByLabelText(/Ticket Type ID/i);

    fireEvent.change(eventIdInput, { target: { value: "evt-999" } });
    fireEvent.change(ticketTypeIdInput, { target: { value: "tt-101" } });

    // Fill first attendee
    const nameInputs = screen.getAllByLabelText(/Attendee Name/i);
    const emailInputs = screen.getAllByLabelText(/Attendee Email/i);
    fireEvent.change(nameInputs[0], { target: { value: "Alice Smith" } });
    fireEvent.change(emailInputs[0], { target: { value: "alice@example.com" } });

    // Add second attendee
    const addAttendeeBtn = screen.getByRole("button", { name: /Add Attendee/i });
    fireEvent.click(addAttendeeBtn);

    const updatedNameInputs = screen.getAllByLabelText(/Attendee Name/i);
    const updatedEmailInputs = screen.getAllByLabelText(/Attendee Email/i);
    expect(updatedNameInputs).toHaveLength(2);

    fireEvent.change(updatedNameInputs[1], { target: { value: "Bob Jones" } });
    fireEvent.change(updatedEmailInputs[1], { target: { value: "bob@example.com" } });

    // Submit form
    const issueBtn = screen.getByRole("button", { name: /Issue Tickets/i });
    fireEvent.click(issueBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [callUrl, callInit] = fetchSpy.mock.calls[0];
    expect(callUrl).toContain("/v1/agency/events/evt-999/issue");
    expect(callInit?.method).toBe("POST");
    expect(JSON.parse(callInit?.body as string)).toEqual({
      ticket_type_id: "tt-101",
      attendees: [
        { name: "Alice Smith", email: "alice@example.com" },
        { name: "Bob Jones", email: "bob@example.com" },
      ],
    });

    // Verify rendered issued tickets and copyable claim URLs
    expect(await screen.findByText("BEO-TKT-ALICE1")).toBeInTheDocument();
    expect(screen.getByText("BEO-TKT-BOB2")).toBeInTheDocument();

    expect(screen.getAllByText(/claim-tok-alice-12345/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/claim-tok-bob-67890/).length).toBeGreaterThanOrEqual(1);

    // Verify claim URL link text
    expect(screen.getByText(/\/claim\?token=claim-tok-alice-12345/)).toBeInTheDocument();
    expect(screen.getByText(/\/claim\?token=claim-tok-bob-67890/)).toBeInTheDocument();

    // Verify copy button works
    const copyButtons = screen.getAllByRole("button", { name: /Copy Link|Copy Claim URL/i });
    expect(copyButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(copyButtons[0]);

    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("/claim?token=claim-tok-alice-12345")
    );
  });

  it("surfaces 403 or quota exceeded API error cleanly with role=alert", async () => {
    localStorage.setItem("beo_token", "fake-agency-token");
    localStorage.setItem("beo_user", JSON.stringify(agencyUser));

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "agency quota exceeded" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    renderAppAtRoute("/agency");

    const eventIdInput = await screen.findByLabelText(/Event ID/i);
    const ticketTypeIdInput = screen.getByLabelText(/Ticket Type ID/i);
    fireEvent.change(eventIdInput, { target: { value: "evt-999" } });
    fireEvent.change(ticketTypeIdInput, { target: { value: "tt-101" } });

    const nameInput = screen.getByLabelText(/Attendee Name/i);
    const emailInput = screen.getByLabelText(/Attendee Email/i);
    fireEvent.change(nameInput, { target: { value: "Charlie Brown" } });
    fireEvent.change(emailInput, { target: { value: "charlie@example.com" } });

    const issueBtn = screen.getByRole("button", { name: /Issue Tickets/i });
    fireEvent.click(issueBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/agency quota exceeded/i);
  });
});
