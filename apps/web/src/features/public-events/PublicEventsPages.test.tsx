import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../auth/AuthContext";
import { EventsListPage } from "./EventsListPage";
import { EventDetailPage } from "./EventDetailPage";
import type { EventDTO, SessionDTO, PostDTO, TicketTypeDTO } from "@beo/contracts";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

const mockEvents: EventDTO[] = [
  {
    id: "evt-1",
    organizer_id: "org-1",
    title: "Jakarta Developer Conference 2026",
    slug: "jakarta-dev-conf-2026",
    event_type: "conference",
    venue: "Balai Kartini, Jakarta",
    status: "published",
    start_at: "2026-12-10T09:00:00Z",
    end_at: "2026-12-10T17:00:00Z",
    created_at: "2026-11-01T00:00:00Z",
  },
  {
    id: "evt-2",
    organizer_id: "org-2",
    title: "Go Programming Workshop",
    slug: "go-programming-workshop",
    event_type: "seminar_workshop",
    venue: "Coworking Space, Bandung",
    status: "published",
    start_at: "2026-12-15T13:00:00Z",
    end_at: "2026-12-15T16:00:00Z",
    created_at: "2026-11-02T00:00:00Z",
  },
  {
    id: "evt-draft",
    organizer_id: "org-3",
    title: "Unpublished Draft Event",
    slug: "unpublished-draft-event",
    event_type: "community",
    venue: "Secret Location",
    status: "draft",
    start_at: "2026-12-20T10:00:00Z",
    end_at: "2026-12-20T12:00:00Z",
    created_at: "2026-11-03T00:00:00Z",
  },
];

const mockSessions: SessionDTO[] = [
  {
    id: "sess-1",
    event_id: "evt-1",
    title: "Keynote: The Future of Cloud Event Platforms",
    speaker_name: "Budi Santoso",
    speaker_bio: "Principal Architect at Cloud Scale",
    start_at: "2026-12-10T09:30:00Z",
    end_at: "2026-12-10T10:30:00Z",
    room_or_stage: "Main Stage",
    created_at: "2026-11-05T00:00:00Z",
  },
];

const mockPosts: PostDTO[] = [
  {
    id: "post-1",
    event_id: "evt-1",
    author_id: "org-1",
    title: "Venue Entry Guidelines",
    body: "Please bring a government ID matching your ticket name for check-in.",
    notify_push: false,
    published_at: "2026-11-12T00:00:00Z",
  },
];

const mockTicketTypes: TicketTypeDTO[] = [
  {
    id: "tt-conf-1",
    event_id: "evt-1",
    name: "Standard Access",
    price: 250000,
    currency: "IDR",
    quota: 200,
    requires_accepted_cfp: false,
    sales_end_at: "2026-12-09T23:59:59Z",
  },
];

describe("Public Events Pages", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("EventsListPage", () => {
    it("renders published events and filters by search and event type", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockEvents), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <MemoryRouter>
              <EventsListPage />
            </MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>
      );

      // Loading state check or wait for events
      await waitFor(() => {
        expect(
          screen.getByText("Jakarta Developer Conference 2026")
        ).toBeInTheDocument();
        expect(
          screen.getByText("Go Programming Workshop")
        ).toBeInTheDocument();
      });

      // Draft event should NOT be rendered
      expect(
        screen.queryByText("Unpublished Draft Event")
      ).not.toBeInTheDocument();

      // Test Search Filter
      const searchInput = screen.getByPlaceholderText(/search events/i);
      fireEvent.change(searchInput, { target: { value: "Bandung" } });

      expect(
        screen.queryByText("Jakarta Developer Conference 2026")
      ).not.toBeInTheDocument();
      expect(
        screen.getByText("Go Programming Workshop")
      ).toBeInTheDocument();

      // Clear Search and Filter by Conference Type
      fireEvent.change(searchInput, { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Conference" }));

      expect(
        screen.getByText("Jakarta Developer Conference 2026")
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Go Programming Workshop")
      ).not.toBeInTheDocument();
    });
  });

  describe("EventDetailPage", () => {
    it("renders event details, sessions schedule, posts, and ticket checkout", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/v1/events/jakarta-dev-conf-2026")) {
          return new Response(JSON.stringify(mockEvents[0]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/v1/events/evt-1/sessions")) {
          return new Response(JSON.stringify(mockSessions), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/v1/events/evt-1/posts")) {
          return new Response(JSON.stringify(mockPosts), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.includes("/v1/events/evt-1/ticket-types")) {
          return new Response(JSON.stringify(mockTicketTypes), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      });

      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <MemoryRouter initialEntries={["/events/jakarta-dev-conf-2026"]}>
              <Routes>
                <Route path="/events/:slug" element={<EventDetailPage />} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>
      );

      // Verify event details
      await waitFor(() => {
        expect(
          screen.getByRole("heading", { name: "Jakarta Developer Conference 2026" })
        ).toBeInTheDocument();
        expect(screen.getByText("Balai Kartini, Jakarta")).toBeInTheDocument();
      });

      // Verify sessions schedule
      await waitFor(() => {
        expect(
          screen.getByText("Keynote: The Future of Cloud Event Platforms")
        ).toBeInTheDocument();
        expect(screen.getByText(/Budi Santoso/i)).toBeInTheDocument();
      });

      // Verify announcements / posts
      await waitFor(() => {
        expect(screen.getByText("Venue Entry Guidelines")).toBeInTheDocument();
        expect(
          screen.getByText(/government ID matching your ticket name/i)
        ).toBeInTheDocument();
      });

      // Verify checkout form rendered with ticket tier
      await waitFor(() => {
        expect(screen.getByText("Standard Access")).toBeInTheDocument();
        expect(screen.getAllByText("IDR 250.000").length).toBeGreaterThanOrEqual(1);
      });
    });

    it("renders 404 state when event slug does not exist", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "event not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );

      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <MemoryRouter initialEntries={["/events/non-existent-event"]}>
              <Routes>
                <Route path="/events/:slug" element={<EventDetailPage />} />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText("Event Not Found")).toBeInTheDocument();
        expect(
          screen.getByRole("link", { name: /back to events directory/i })
        ).toBeInTheDocument();
      });
    });
  });
});
