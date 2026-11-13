import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, ProtectedRoute } from "../auth/AuthContext";
import { CheckinPage } from "./CheckinPage";

const staffUser = {
  id: "usr-staff-01",
  name: "Gate Staff",
  email: "staff@example.com",
  account_type: "standard" as const,
  created_at: "2026-11-01T00:00:00Z",
};

function renderCheckinPage(eventId = "evt-checkin-01") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/events/${eventId}/checkin`]}>
          <Routes>
            <Route
              path="/events/:eventId/checkin"
              element={
                <ProtectedRoute>
                  <CheckinPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("CheckinPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("beo_token", "fake-staff-token");
    localStorage.setItem("beo_user", JSON.stringify(staffUser));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("auto-focuses HID input, submits scan_mode: 'hid', and renders success banner + recent scan log", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ticket_id: "tkt-001",
          ticket_code: "BEO-2026-XYZ",
          attendee_name: "Alice Johnson",
          attendee_email: "alice@example.com",
          checked_in_at: "2026-11-13T04:00:00Z",
          result: "success",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    renderCheckinPage("evt-checkin-01");

    const hidInput = screen.getByLabelText(/Hardware HID Scanner Input/i);
    expect(hidInput).toHaveFocus();

    fireEvent.change(hidInput, { target: { value: "QR-PAYLOAD-123" } });
    fireEvent.keyDown(hidInput, { key: "Enter", code: "Enter" });
    fireEvent.submit(hidInput.closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    const banner = screen.getByRole("status");
    expect(within(banner).getByText(/Alice Johnson/i)).toBeInTheDocument();
    expect(within(banner).getByText(/BEO-2026-XYZ/i)).toBeInTheDocument();
    expect(within(banner).getByText(/Check-in Successful/i)).toBeInTheDocument();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/v1/events/evt-checkin-01/checkin"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          qr_payload: "QR-PAYLOAD-123",
          scan_mode: "hid",
        }),
      })
    );
  });

  it("ignores duplicate Enter submissions while a checkin request is in-flight", async () => {
    let resolveFetch!: (value: Response) => void;
    const pendingPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(pendingPromise);

    renderCheckinPage("evt-checkin-01");

    const hidInput = screen.getByLabelText(/Hardware HID Scanner Input/i);
    const form = hidInput.closest("form")!;

    fireEvent.change(hidInput, { target: { value: "QR-INFLIGHT-1" } });
    fireEvent.submit(form);

    // Rapid duplicate Enter / submit while first request is still in-flight
    fireEvent.change(hidInput, { target: { value: "QR-INFLIGHT-1" } });
    fireEvent.keyDown(hidInput, { key: "Enter", code: "Enter" });
    fireEvent.submit(form);

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch(
        new Response(
          JSON.stringify({
            ticket_id: "tkt-002",
            ticket_code: "BEO-2026-INFLIGHT",
            attendee_name: "Bob Builder",
            attendee_email: "bob@example.com",
            checked_in_at: "2026-11-13T04:01:00Z",
            result: "success",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    });

    await waitFor(() => {
      expect(within(screen.getByRole("status")).getByText(/Bob Builder/i)).toBeInTheDocument();
    });
  });

  it("renders duplicate amber warning on 409 Conflict and invalid error on 404", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "ticket already checked in" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "invalid or unrecognized ticket" }),
          {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }
        )
      );

    renderCheckinPage("evt-checkin-01");

    const hidInput = screen.getByLabelText(/Hardware HID Scanner Input/i);
    const form = hidInput.closest("form")!;

    // 1. Trigger 409 duplicate
    fireEvent.change(hidInput, { target: { value: "QR-DUP-999" } });
    fireEvent.submit(form);

    const dupAlert = await screen.findByRole("alert");
    expect(dupAlert).toHaveTextContent(/Duplicate/i);
    expect(dupAlert).toHaveTextContent(/ticket already checked in/i);

    // 2. Trigger 404 invalid
    fireEvent.change(hidInput, { target: { value: "QR-BAD-000" } });
    fireEvent.submit(form);

    await waitFor(() => {
      const invalidAlert = screen.getByRole("alert");
      expect(invalidAlert).toHaveTextContent(/invalid or unrecognized ticket/i);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("toggles webcam scanner and stops all MediaStream tracks on unmount", async () => {
    const stopTrackMock = vi.fn();
    const mockStream = {
      getTracks: () => [{ stop: stopTrackMock }],
    } as unknown as MediaStream;

    const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: getUserMediaMock,
      },
    });

    // Ensure HTMLVideoElement.prototype.play does not throw in jsdom
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    const { unmount } = renderCheckinPage("evt-checkin-01");

    const toggleBtn = screen.getByRole("button", {
      name: /Enable Webcam Scanner/i,
    });
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith({
        video: { facingMode: "environment" },
      });
    });

    expect(
      screen.getByRole("button", { name: /Disable Webcam Scanner/i })
    ).toBeInTheDocument();

    unmount();

    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });

  it("stops all MediaStream tracks when toggling webcam off", async () => {
    const stopTrackMock = vi.fn();
    const mockStream = {
      getTracks: () => [{ stop: stopTrackMock }],
    } as unknown as MediaStream;

    const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: getUserMediaMock,
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    renderCheckinPage("evt-checkin-01");

    fireEvent.click(
      screen.getByRole("button", { name: /Enable Webcam Scanner/i })
    );

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Disable Webcam Scanner/i })
    );

    await waitFor(() => {
      expect(stopTrackMock).toHaveBeenCalledTimes(1);
    });
  });

  it("submits manual ticket code with scan_mode: 'manual' and displays success banner", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ticket_id: "tkt-manual-01",
          ticket_code: "BEO-MAN-999",
          attendee_name: "Charlie Manual",
          attendee_email: "charlie@example.com",
          checked_in_at: "2026-11-13T05:00:00Z",
          result: "success",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    renderCheckinPage("evt-checkin-01");

    const manualInput = screen.getByLabelText(/Manual Ticket Code/i);
    fireEvent.change(manualInput, { target: { value: "BEO-MAN-999" } });
    fireEvent.submit(manualInput.closest("form")!);

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/v1/events/evt-checkin-01/checkin"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          qr_payload: "BEO-MAN-999",
          scan_mode: "manual",
        }),
      })
    );

    const banner = screen.getByRole("status");
    expect(within(banner).getByText(/Charlie Manual/i)).toBeInTheDocument();
    expect(within(banner).getByText(/BEO-MAN-999/i)).toBeInTheDocument();
  });
});
