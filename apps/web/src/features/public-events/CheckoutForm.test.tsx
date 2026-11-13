import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import { CheckoutForm } from "./CheckoutForm";
import type { EventDTO, TicketTypeDTO } from "@beo/contracts";

const mockEvent: EventDTO = {
  id: "evt-uuid-1",
  organizer_id: "org-1",
  title: "Tech Summit 2026",
  slug: "tech-summit-2026",
  event_type: "conference",
  venue: "Grand Ballroom, Jakarta",
  status: "published",
  start_at: "2026-12-01T09:00:00Z",
  end_at: "2026-12-01T17:00:00Z",
  created_at: "2026-11-01T00:00:00Z",
};

const mockPaidTicketType: TicketTypeDTO = {
  id: "tt-paid-1",
  event_id: "evt-uuid-1",
  name: "Regular Pass",
  price: 150000,
  currency: "IDR",
  quota: 100,
  requires_accepted_cfp: false,
  sales_end_at: "2026-11-30T23:59:59Z",
};

const mockFreeTicketType: TicketTypeDTO = {
  id: "tt-free-1",
  event_id: "evt-uuid-1",
  name: "Community RSVP",
  price: 0,
  currency: "IDR",
  quota: 50,
  requires_accepted_cfp: false,
  sales_end_at: "2026-11-30T23:59:59Z",
};

describe("CheckoutForm", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      value: {
        ...window.location,
        assign: vi.fn(),
      },
      writable: true,
    });
  });

  it("validates multi-ticket attendees and requires name and email for each ticket", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(
      <AuthProvider>
        <MemoryRouter>
          <CheckoutForm
            event={mockEvent}
            ticketTypes={[mockPaidTicketType]}
          />
        </MemoryRouter>
      </AuthProvider>
    );

    // Buyer email
    fireEvent.change(screen.getByLabelText(/buyer email/i), {
      target: { value: "buyer@example.com" },
    });

    // Change quantity to 2
    const quantityInput = screen.getByLabelText(/ticket quantity/i);
    fireEvent.change(quantityInput, { target: { value: "2" } });

    // Fill attendee 1 but leave attendee 2 empty
    fireEvent.change(screen.getByLabelText(/attendee 1 name/i), {
      target: { value: "Alice Smith" },
    });
    fireEvent.change(screen.getByLabelText(/attendee 1 email/i), {
      target: { value: "alice@example.com" },
    });

    // Click submit
    fireEvent.click(screen.getByRole("button", { name: /reserve tickets|complete registration|checkout/i }));

    // Should show error and NOT call fetch
    await waitFor(() => {
      expect(screen.getByText(/valid name and email/i)).toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Now fill attendee 2 with invalid email
    fireEvent.change(screen.getByLabelText(/attendee 2 name/i), {
      target: { value: "Bob Jones" },
    });
    fireEvent.change(screen.getByLabelText(/attendee 2 email/i), {
      target: { value: "not-an-email" },
    });

    fireEvent.click(screen.getByRole("button", { name: /reserve tickets|complete registration|checkout/i }));

    await waitFor(() => {
      expect(screen.getByText(/valid name and email/i)).toBeInTheDocument();
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Fix attendee 2 email and mock successful response
    fireEvent.change(screen.getByLabelText(/attendee 2 email/i), {
      target: { value: "bob@example.com" },
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "ord-123",
          event_id: "evt-uuid-1",
          buyer_email: "buyer@example.com",
          total_amount: 300000,
          payment_method: "duitku",
          payment_status: "pending",
          created_at: "2026-11-13T00:00:00Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    ).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          payment_url: "https://duitku.com/pay/ord-123",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    fireEvent.click(screen.getByRole("button", { name: /reserve tickets|complete registration|checkout/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/v1/events/evt-uuid-1/orders"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("bob@example.com"),
        })
      );
    });
  });

  it("handles Duitku payment flow with redirect payment_url", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "ord-duitku-1",
          event_id: "evt-uuid-1",
          buyer_email: "buyer@example.com",
          total_amount: 150000,
          payment_method: "duitku",
          payment_status: "pending",
          created_at: "2026-11-13T00:00:00Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    ).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          payment_url: "https://duitku.com/pay/ord-duitku-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    render(
      <AuthProvider>
        <MemoryRouter>
          <CheckoutForm
            event={mockEvent}
            ticketTypes={[mockPaidTicketType]}
          />
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.change(screen.getByLabelText(/buyer email/i), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/attendee 1 name/i), {
      target: { value: "Alice Smith" },
    });
    fireEvent.change(screen.getByLabelText(/attendee 1 email/i), {
      target: { value: "alice@example.com" },
    });

    // Select Duitku payment method
    const duitkuRadio = screen.getByLabelText(/duitku/i);
    fireEvent.click(duitkuRadio);

    fireEvent.click(screen.getByRole("button", { name: /reserve tickets|complete registration|checkout/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/v1/events/evt-uuid-1/orders"),
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/v1/orders/ord-duitku-1/pay/duitku"),
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    // Verifies payment link / redirection UI is displayed
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /proceed to duitku payment|pay now/i });
      expect(link).toHaveAttribute("href", "https://duitku.com/pay/ord-duitku-1");
    });
  });

  it("handles manual transfer proof URL submission flow", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "ord-manual-1",
          event_id: "evt-uuid-1",
          buyer_email: "buyer@example.com",
          total_amount: 150000,
          payment_method: "manual_transfer",
          payment_status: "pending",
          created_at: "2026-11-13T00:00:00Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    render(
      <AuthProvider>
        <MemoryRouter>
          <CheckoutForm
            event={mockEvent}
            ticketTypes={[mockPaidTicketType]}
          />
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.change(screen.getByLabelText(/buyer email/i), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/attendee 1 name/i), {
      target: { value: "Charlie Brown" },
    });
    fireEvent.change(screen.getByLabelText(/attendee 1 email/i), {
      target: { value: "charlie@example.com" },
    });

    // Select Manual Transfer payment method
    const manualRadio = screen.getByLabelText(/manual transfer|bank transfer/i);
    fireEvent.click(manualRadio);

    fireEvent.click(screen.getByRole("button", { name: /reserve tickets|complete registration|checkout/i }));

    // Should transition to proof submission view
    await waitFor(() => {
      expect(screen.getByLabelText(/proof file url|transfer receipt url/i)).toBeInTheDocument();
    });

    // Mock proof submission API call
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "pending_verification",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    fireEvent.change(screen.getByLabelText(/proof file url|transfer receipt url/i), {
      target: { value: "https://storage.example.com/receipts/proof-001.jpg" },
    });

    fireEvent.click(screen.getByRole("button", { name: /submit payment proof|upload proof/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/v1/orders/ord-manual-1/proof"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            proof_file_url: "https://storage.example.com/receipts/proof-001.jpg",
          }),
        })
      );
    });

    // Verifies pending verification message is shown
    await waitFor(() => {
      expect(screen.getByText(/pending verification/i)).toBeInTheDocument();
    });
  });

  it("handles manual transfer proof file upload via proof-upload endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "ord-manual-2",
          event_id: "evt-uuid-1",
          buyer_email: "buyer@example.com",
          total_amount: 150000,
          payment_method: "manual_transfer",
          payment_status: "pending",
          created_at: "2026-11-13T00:00:00Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    render(
      <AuthProvider>
        <MemoryRouter>
          <CheckoutForm
            event={mockEvent}
            ticketTypes={[mockPaidTicketType]}
          />
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.change(screen.getByLabelText(/buyer email/i), {
      target: { value: "buyer@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/attendee 1 name/i), {
      target: { value: "Charlie Brown" },
    });
    fireEvent.change(screen.getByLabelText(/attendee 1 email/i), {
      target: { value: "charlie@example.com" },
    });

    fireEvent.click(screen.getByLabelText(/manual transfer|bank transfer/i));
    fireEvent.click(screen.getByRole("button", { name: /reserve tickets|complete registration|checkout/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/upload transfer receipt/i)).toBeInTheDocument();
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: "pending_verification",
          proof_file_url: "/v1/uploads/receipt.png",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const file = new File(["receipt-bytes"], "receipt.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/upload transfer receipt/i), {
      target: { files: [file] },
    });

    fireEvent.click(screen.getByRole("button", { name: /submit payment proof/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/v1/orders/ord-manual-2/proof-upload"),
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/pending verification/i)).toBeInTheDocument();
    });
  });

  it("handles free ticket instant confirmation without payment redirects", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "ord-free-1",
          event_id: "evt-uuid-1",
          buyer_email: "freebie@example.com",
          total_amount: 0,
          payment_method: "free",
          payment_status: "paid",
          tickets: [
            {
              id: "tkt-1",
              attendee_name: "Dana Free",
              attendee_email: "dana@example.com",
              ticket_code: "BEO-FREE-001",
              qr_signature: "sig123",
              claim_token: "claim-tok+123",
              status: "valid",
              created_at: "2026-11-13T00:00:00Z",
            },
          ],
          created_at: "2026-11-13T00:00:00Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    render(
      <AuthProvider>
        <MemoryRouter>
          <CheckoutForm
            event={mockEvent}
            ticketTypes={[mockFreeTicketType]}
          />
        </MemoryRouter>
      </AuthProvider>
    );

    fireEvent.change(screen.getByLabelText(/buyer email/i), {
      target: { value: "freebie@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/attendee 1 name/i), {
      target: { value: "Dana Free" },
    });
    fireEvent.change(screen.getByLabelText(/attendee 1 email/i), {
      target: { value: "dana@example.com" },
    });

    fireEvent.click(screen.getByRole("button", { name: /reserve tickets|complete registration|checkout/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/v1/events/evt-uuid-1/orders"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"payment_method":"free"'),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/registration confirmed|order confirmed/i)).toBeInTheDocument();
    });

    expect(screen.getByText("claim-tok+123")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /claim ticket/i })).toHaveAttribute(
      "href",
      "/claim?token=claim-tok%2B123"
    );
    expect(
      screen.getByRole("button", { name: /copy claim link/i })
    ).toBeInTheDocument();
  });
});
