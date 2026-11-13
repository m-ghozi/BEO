import React from "react";
import { render, waitFor, fireEvent } from "@testing-library/react-native";
import { useLocalSearchParams } from "expo-router";
import type { EventDTO, PostDTO, SessionDTO } from "@beo/contracts";
import EventDetailScreen from "../../../app/events/[slug]";
import * as api from "../../services/api";
import * as offlineCache from "../../services/offlineCache";

const sampleEvent: EventDTO = {
  id: "ev-1",
  organizer_id: "org-1",
  title: "BEO Summit 2026",
  slug: "beo-summit-2026",
  event_type: "conference",
  start_at: "2026-11-20T09:00:00Z",
  end_at: "2026-11-20T17:00:00Z",
  venue: "Jakarta Convention Center",
  status: "published",
  created_at: "2026-11-01T00:00:00Z",
};

const sampleSessions: SessionDTO[] = [
  {
    id: "sess-1",
    event_id: "ev-1",
    title: "Opening Keynote",
    speaker_name: "Dr. Maya Putri",
    speaker_bio: "Principal Architect",
    start_at: "2026-11-20T09:30:00Z",
    end_at: "2026-11-20T10:30:00Z",
    room_or_stage: "Main Hall",
    created_at: "2026-11-02T00:00:00Z",
  },
];

const samplePosts: PostDTO[] = [
  {
    id: "post-1",
    event_id: "ev-1",
    author_id: "org-1",
    title: "Doors Open at 8:30 AM",
    body: "Please have your QR pass ready at Gate A.",
    notify_push: true,
    published_at: "2026-11-19T12:00:00Z",
  },
];

describe("EventDetailScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      slug: "beo-summit-2026",
    });
  });

  it("fetches event, sessions, and posts, caches them, and renders metadata, schedule, and announcements", async () => {
    const apiSpy = jest
      .spyOn(api, "apiFetch")
      .mockImplementation(async (path: string) => {
        if (path === "/v1/events/beo-summit-2026") return sampleEvent;
        if (path === "/v1/events/ev-1/sessions") return sampleSessions;
        if (path === "/v1/events/ev-1/posts") return samplePosts;
        throw new Error(`Unexpected path: ${path}`);
      });

    const saveSpy = jest
      .spyOn(offlineCache, "saveEventDetailCache")
      .mockResolvedValueOnce(undefined);

    const { getByText } = render(<EventDetailScreen />);

    await waitFor(() => {
      expect(getByText("BEO Summit 2026")).toBeTruthy();
    });

    expect(apiSpy).toHaveBeenCalledWith("/v1/events/beo-summit-2026");
    expect(apiSpy).toHaveBeenCalledWith("/v1/events/ev-1/sessions");
    expect(apiSpy).toHaveBeenCalledWith("/v1/events/ev-1/posts");
    expect(saveSpy).toHaveBeenCalledWith("beo-summit-2026", {
      event: sampleEvent,
      sessions: sampleSessions,
      posts: samplePosts,
    });

    expect(getByText("Jakarta Convention Center")).toBeTruthy();
    expect(getByText(/conference/i)).toBeTruthy();
    expect(getByText("Opening Keynote")).toBeTruthy();
    expect(getByText(/Dr\. Maya Putri/)).toBeTruthy();
    expect(getByText(/Main Hall/)).toBeTruthy();
    expect(getByText("Doors Open at 8:30 AM")).toBeTruthy();
    expect(
      getByText("Please have your QR pass ready at Gate A.")
    ).toBeTruthy();
  });

  it("falls back to cached event detail and shows Offline Mode banner on fetch error", async () => {
    jest
      .spyOn(api, "apiFetch")
      .mockRejectedValueOnce(new Error("Network request failed"));

    const loadSpy = jest
      .spyOn(offlineCache, "loadEventDetailCache")
      .mockResolvedValueOnce({
        event: sampleEvent,
        sessions: sampleSessions,
        posts: samplePosts,
        updatedAt: "2026-11-19T15:00:00Z",
      });

    const { getByText } = render(<EventDetailScreen />);

    await waitFor(() => {
      expect(getByText("Offline Mode")).toBeTruthy();
    });

    expect(loadSpy).toHaveBeenCalledWith("beo-summit-2026");
    expect(getByText("BEO Summit 2026")).toBeTruthy();
    expect(getByText("Opening Keynote")).toBeTruthy();
    expect(getByText("Doors Open at 8:30 AM")).toBeTruthy();
  });

  it("shows error state and allows retrying when fetch fails and no cache exists", async () => {
    const apiSpy = jest
      .spyOn(api, "apiFetch")
      .mockRejectedValueOnce(new Error("Server unavailable"))
      .mockImplementation(async (path: string) => {
        if (path === "/v1/events/beo-summit-2026") return sampleEvent;
        if (path === "/v1/events/ev-1/sessions") return sampleSessions;
        if (path === "/v1/events/ev-1/posts") return samplePosts;
        throw new Error(`Unexpected path: ${path}`);
      });

    jest
      .spyOn(offlineCache, "loadEventDetailCache")
      .mockResolvedValueOnce(null);
    jest
      .spyOn(offlineCache, "saveEventDetailCache")
      .mockResolvedValueOnce(undefined);

    const { getByText, getByRole } = render(<EventDetailScreen />);

    await waitFor(() => {
      expect(getByText("Server unavailable")).toBeTruthy();
    });

    fireEvent.press(getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(getByText("BEO Summit 2026")).toBeTruthy();
    });
    expect(apiSpy).toHaveBeenCalledTimes(4);
  });
});
