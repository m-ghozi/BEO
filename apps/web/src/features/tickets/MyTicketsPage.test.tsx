import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import { MyTicketsPage } from "./MyTicketsPage";
import type { TicketDTO } from "@beo/contracts";

const mockUser = {
  id: "usr-123",
  name: "Jane Attendee",
  email: "jane@example.com",
  account_type: "standard" as const,
  created_at: "2026-11-01T00:00:00Z",
};

const mockTickets: TicketDTO[] = [
  {
    id: "tkt-001",
    ticket_type_id: "tt-regular",
    event_id: "evt-001",
    attendee_name: "Jane Attendee",
    attendee_email: "jane@example.com",
    ticket_code: "TC-ABC-123",
    qr_signature: "sig-xyz-789",
    claim_token: "abc-123",
    claimed_by_user_id: "usr-123",
    status: "valid",
    created_at: "2026-11-13T00:00:00Z",
  },
  {
    id: "tkt-002",
    ticket_type_id: "tt-vip",
    event_id: "evt-002",
    attendee_name: "John Doe",
    attendee_email: "john@example.com",
    ticket_code: "TC-VIP-999",
    qr_signature: "sig-vip-456",
    claim_token: null,
    claimed_by_user_id: "usr-123",
    status: "checked_in",
    checked_in_at: "2026-11-13T09:30:00Z",
    created_at: "2026-11-12T00:00:00Z",
  },
];

describe("MyTicketsPage", () => {
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

  it("renders list of tickets with QR code previews and PDF download links", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockTickets), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/my-tickets"]}>
          <Routes>
            <Route path="/my-tickets" element={<MyTicketsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    // Initial loading indicator
    expect(screen.getByText(/loading your tickets/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("TC-ABC-123")).toBeInTheDocument();
    });

    expect(screen.getByText("Jane Attendee")).toBeInTheDocument();
    expect(screen.getByText("TC-VIP-999")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();

    // Check QR previews
    const qr1 = screen.getByAltText(/qr code for TC-ABC-123/i);
    expect(qr1).toHaveAttribute(
      "src",
      expect.stringContaining("/v1/tickets/TC-ABC-123/qr.png")
    );

    const qr2 = screen.getByAltText(/qr code for TC-VIP-999/i);
    expect(qr2).toHaveAttribute(
      "src",
      expect.stringContaining("/v1/tickets/TC-VIP-999/qr.png")
    );

    // Check PDF download links
    const pdfLinks = screen.getAllByRole("link", { name: /download pdf/i });
    expect(pdfLinks).toHaveLength(2);
    expect(pdfLinks[0]).toHaveAttribute(
      "href",
      expect.stringContaining("/v1/tickets/TC-ABC-123/pdf")
    );
    expect(pdfLinks[1]).toHaveAttribute(
      "href",
      expect.stringContaining("/v1/tickets/TC-VIP-999/pdf")
    );

    // Checked-in badge/note check
    expect(screen.getByText("Checked In")).toBeInTheDocument();
  });

  it("renders empty state when user has no tickets", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/my-tickets"]}>
          <Routes>
            <Route path="/my-tickets" element={<MyTicketsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/no tickets found/i)).toBeInTheDocument();
    });

    const claimLinks = screen.getAllByRole("link", { name: /claim a ticket/i });
    expect(claimLinks.length).toBeGreaterThanOrEqual(1);
    expect(claimLinks[0]).toHaveAttribute("href", "/claim");
  });

  it("renders error state when fetch fails and allows retry", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Server unavailable" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockTickets), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/my-tickets"]}>
          <Routes>
            <Route path="/my-tickets" element={<MyTicketsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Server unavailable");
    });

    // Click retry
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(screen.getByText("TC-ABC-123")).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
