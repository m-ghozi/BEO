import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import { ClaimTicketPage } from "./ClaimTicketPage";
import type { TicketDTO } from "@beo/contracts";

const mockUser = {
  id: "usr-123",
  name: "Jane Attendee",
  email: "jane@example.com",
  account_type: "standard" as const,
  created_at: "2026-11-01T00:00:00Z",
};

const mockClaimedTicket: TicketDTO = {
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
};

describe("ClaimTicketPage", () => {
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

  it("pre-fills token from query parameter ?token=abc-123, calls POST /v1/tickets/claim and shows claimed ticket details with PDF/QR links", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockClaimedTicket), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/claim?token=abc-123"]}>
          <Routes>
            <Route path="/claim" element={<ClaimTicketPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    const tokenInput = screen.getByLabelText(/claim token/i) as HTMLInputElement;
    expect(tokenInput.value).toBe("abc-123");

    const claimButton = screen.getByRole("button", { name: /claim ticket/i });
    fireEvent.click(claimButton);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toContain("/v1/tickets/claim");
    expect(calledInit?.method).toBe("POST");
    expect(JSON.parse(String(calledInit?.body))).toEqual({
      claim_token: "abc-123",
    });

    await waitFor(() => {
      expect(screen.getByText(/ticket claimed successfully/i)).toBeInTheDocument();
    });

    expect(screen.getByText("Jane Attendee")).toBeInTheDocument();
    expect(screen.getByText("TC-ABC-123")).toBeInTheDocument();

    const qrImage = screen.getByAltText(/qr code for TC-ABC-123/i);
    expect(qrImage).toHaveAttribute(
      "src",
      expect.stringContaining("/v1/tickets/TC-ABC-123/qr.png")
    );

    const pdfLink = screen.getByRole("link", { name: /download pdf/i });
    expect(pdfLink).toHaveAttribute(
      "href",
      expect.stringContaining("/v1/tickets/TC-ABC-123/pdf")
    );

    const myTicketsLink = screen.getByRole("link", { name: /view my tickets/i });
    expect(myTicketsLink).toHaveAttribute("href", "/my-tickets");
  });

  it("allows manual token entry when no query param is provided", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockClaimedTicket), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/claim"]}>
          <Routes>
            <Route path="/claim" element={<ClaimTicketPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    const tokenInput = screen.getByLabelText(/claim token/i);
    expect(tokenInput).toHaveValue("");

    fireEvent.change(tokenInput, { target: { value: "manual-token-789" } });
    fireEvent.click(screen.getByRole("button", { name: /claim ticket/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [, calledInit] = fetchSpy.mock.calls[0];
    expect(JSON.parse(String(calledInit?.body))).toEqual({
      claim_token: "manual-token-789",
    });

    await waitFor(() => {
      expect(screen.getByText(/ticket claimed successfully/i)).toBeInTheDocument();
    });
  });

  it("displays error alert when claim API fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Claim token has already been claimed" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/claim?token=used-token"]}>
          <Routes>
            <Route path="/claim" element={<ClaimTicketPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /claim ticket/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Claim token has already been claimed"
      );
    });
  });

  it("prevents submitting empty token and displays client error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/claim"]}>
          <Routes>
            <Route path="/claim" element={<ClaimTicketPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /claim ticket/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /claim token is required/i
      );
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows user to claim another ticket after a successful claim", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockClaimedTicket), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={["/claim?token=abc-123"]}>
          <Routes>
            <Route path="/claim" element={<ClaimTicketPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /claim ticket/i }));

    await waitFor(() => {
      expect(screen.getByText(/ticket claimed successfully/i)).toBeInTheDocument();
    });

    const claimAnotherBtn = screen.getByRole("button", { name: /claim another ticket/i });
    fireEvent.click(claimAnotherBtn);

    expect(screen.getByLabelText(/claim token/i)).toBeInTheDocument();
    expect(screen.queryByText(/ticket claimed successfully/i)).not.toBeInTheDocument();
  });
});
