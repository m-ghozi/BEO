import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { TicketDTO } from "@beo/contracts";
import MyTicketsScreen from "../../../app/(tabs)/index";
import TicketQRScreen from "../../../app/tickets/[code]";
import * as api from "../../services/api";
import * as offlineCache from "../../services/offlineCache";
import { useAuth } from "../../context/AuthContext";

jest.mock("../../context/AuthContext", () => ({
  useAuth: jest.fn(),
}));

const mockUser = {
  id: "user-1",
  name: "Alice",
  email: "alice@example.com",
  account_type: "standard",
  created_at: "2026-11-13T00:00:00Z",
};

const sampleTickets: TicketDTO[] = [
  {
    id: "t-1",
    ticket_type_id: "tt-1",
    event_id: "ev-1",
    attendee_name: "Alice",
    attendee_email: "alice@example.com",
    ticket_code: "BEO-1234",
    qr_signature: "BEO-1234|ev-1|deadbeef",
    status: "valid",
    checked_in_at: null,
    created_at: "2026-11-13T01:00:00Z",
  },
  {
    id: "t-2",
    ticket_type_id: "tt-1",
    event_id: "ev-1",
    attendee_name: "Bob",
    attendee_email: "bob@example.com",
    ticket_code: "BEO-5678",
    qr_signature: "BEO-5678|ev-1|cafebabe",
    status: "valid",
    checked_in_at: "2026-11-13T09:00:00Z",
    created_at: "2026-11-13T01:05:00Z",
  },
];

describe("MyTicketsScreen & TicketQRScreen", () => {
  const mockPush = jest.fn();
  const mockBack = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser,
      token: "jwt-token",
      isLoading: false,
    });
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
      replace: jest.fn(),
      back: mockBack,
    });
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
  });

  it("fetches GET /v1/me/tickets, caches them, and navigates to /tickets/[code] on press", async () => {
    const apiSpy = jest
      .spyOn(api, "apiFetch")
      .mockResolvedValueOnce(sampleTickets);
    const saveSpy = jest
      .spyOn(offlineCache, "saveTicketsCache")
      .mockResolvedValueOnce(undefined);

    const { getByText } = render(<MyTicketsScreen />);

    await waitFor(() => {
      expect(getByText("BEO-1234")).toBeTruthy();
    });

    expect(apiSpy).toHaveBeenCalledWith("/v1/me/tickets");
    expect(saveSpy).toHaveBeenCalledWith("user-1", sampleTickets);
    expect(getByText("Alice")).toBeTruthy();
    expect(getByText("Valid")).toBeTruthy();
    expect(getByText("Checked In")).toBeTruthy();

    fireEvent.press(getByText("BEO-1234"));
    expect(mockPush).toHaveBeenCalledWith("/tickets/BEO-1234");
  });

  it("shows empty state with navigation to Claim tab when user has no tickets", async () => {
    jest.spyOn(api, "apiFetch").mockResolvedValueOnce([]);
    jest.spyOn(offlineCache, "saveTicketsCache").mockResolvedValueOnce(undefined);

    const { getByRole, getByText } = render(<MyTicketsScreen />);

    await waitFor(() => {
      expect(getByText(/no tickets yet/i)).toBeTruthy();
    });

    fireEvent.press(getByRole("button", { name: /claim a ticket/i }));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/claim");
  });

  it("falls back to loadTicketsCache and shows Offline Mode banner when fetch fails", async () => {
    jest
      .spyOn(api, "apiFetch")
      .mockRejectedValueOnce(new Error("Network request failed"));
    jest.spyOn(offlineCache, "loadTicketsCache").mockResolvedValueOnce({
      tickets: [sampleTickets[0]],
      updatedAt: "2026-11-13T08:00:00.000Z",
    });

    const { getByText } = render(<MyTicketsScreen />);

    await waitFor(() => {
      expect(getByText(/Offline Mode/i)).toBeTruthy();
    });

    expect(getByText("BEO-1234")).toBeTruthy();
    expect(getByText("Alice")).toBeTruthy();
  });

  it("renders TicketQRScreen from offline cache without network calls", async () => {
    const apiSpy = jest.spyOn(api, "apiFetch");
    (useLocalSearchParams as jest.Mock).mockReturnValue({ code: "BEO-1234" });
    jest.spyOn(offlineCache, "loadTicketsCache").mockResolvedValueOnce({
      tickets: sampleTickets,
      updatedAt: "2026-11-13T08:00:00.000Z",
    });

    const { getByTestId, getByText } = render(<TicketQRScreen />);

    await waitFor(() => {
      expect(getByTestId("ticket-qr-code")).toBeTruthy();
    });

    expect(apiSpy).not.toHaveBeenCalled();
    expect(getByTestId("ticket-qr-code").props.accessibilityLabel).toBe(
      "BEO-1234|ev-1|deadbeef"
    );
    expect(getByText("BEO-1234")).toBeTruthy();
    expect(getByText("Alice")).toBeTruthy();
    expect(getByText("alice@example.com")).toBeTruthy();
    expect(getByText("Valid")).toBeTruthy();
  });
});
