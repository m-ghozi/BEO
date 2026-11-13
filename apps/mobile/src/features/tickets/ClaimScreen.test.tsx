import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { TicketDTO } from "@beo/contracts";
import ClaimScreen from "../../../app/(tabs)/claim";
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

const claimedTicket: TicketDTO = {
  id: "t-9",
  ticket_type_id: "tt-1",
  event_id: "ev-1",
  attendee_name: "Alice",
  attendee_email: "alice@example.com",
  ticket_code: "BEO-9999",
  qr_signature: "BEO-9999|ev-1|feedface",
  status: "valid",
  checked_in_at: null,
  created_at: "2026-11-13T02:00:00Z",
};

describe("ClaimScreen", () => {
  const mockPush = jest.fn();

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
      back: jest.fn(),
    });
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
    (Linking.getInitialURL as jest.Mock).mockResolvedValue(null);
    (Linking.addEventListener as jest.Mock).mockReturnValue({
      remove: jest.fn(),
    });
  });

  it("shows validation error when submitting an empty claim token", async () => {
    const apiSpy = jest.spyOn(api, "apiFetch");
    const { getByRole, getByText } = render(<ClaimScreen />);

    fireEvent.press(getByRole("button", { name: "Claim Ticket" }));

    await waitFor(() => {
      expect(getByText(/Claim token is required/i)).toBeTruthy();
    });
    expect(apiSpy).not.toHaveBeenCalled();
  });

  it("pre-fills token from route search params, submits claim, and refreshes ticket cache", async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ token: "claim-abc-123" });
    const apiSpy = jest
      .spyOn(api, "apiFetch")
      .mockResolvedValueOnce(claimedTicket)
      .mockResolvedValueOnce([claimedTicket]);
    const saveSpy = jest
      .spyOn(offlineCache, "saveTicketsCache")
      .mockResolvedValueOnce(undefined);

    const { getByDisplayValue, getByRole, getByText } = render(<ClaimScreen />);

    await waitFor(() => {
      expect(getByDisplayValue("claim-abc-123")).toBeTruthy();
    });

    fireEvent.press(getByRole("button", { name: "Claim Ticket" }));

    await waitFor(() => {
      expect(getByText(/Ticket claimed/i)).toBeTruthy();
    });

    expect(apiSpy).toHaveBeenNthCalledWith(1, "/v1/tickets/claim", {
      method: "POST",
      body: JSON.stringify({ claim_token: "claim-abc-123" }),
    });
    expect(apiSpy).toHaveBeenNthCalledWith(2, "/v1/me/tickets");
    expect(saveSpy).toHaveBeenCalledWith("user-1", [claimedTicket]);

    expect(getByText("BEO-9999")).toBeTruthy();
    fireEvent.press(getByRole("button", { name: /View Ticket QR/i }));
    expect(mockPush).toHaveBeenCalledWith("/tickets/BEO-9999");
  });

  it("pre-fills token from Linking.getInitialURL deep link (beo://claim?token=...)", async () => {
    (Linking.getInitialURL as jest.Mock).mockResolvedValueOnce(
      "beo://claim?token=deep-token-456"
    );

    const { getByDisplayValue } = render(<ClaimScreen />);

    await waitFor(() => {
      expect(getByDisplayValue("deep-token-456")).toBeTruthy();
    });
  });

  it("displays API error when claim request fails", async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ token: "bad-token" });
    jest
      .spyOn(api, "apiFetch")
      .mockRejectedValueOnce(new api.ApiError(404, "Claim token not found"));

    const { getByRole, getByText } = render(<ClaimScreen />);

    fireEvent.press(getByRole("button", { name: "Claim Ticket" }));

    await waitFor(() => {
      expect(getByText("Claim token not found")).toBeTruthy();
    });
  });
});
