import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EventDTO, PostDTO, SessionDTO, TicketDTO } from "@beo/contracts";
import {
  loadEventDetailCache,
  loadTicketsCache,
  saveEventDetailCache,
  saveTicketsCache,
} from "./offlineCache";

describe("offlineCache service", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it("saves and loads tickets cache for a user", async () => {
    const tickets: TicketDTO[] = [
      {
        id: "t-1",
        ticket_type_id: "tt-1",
        event_id: "ev-1",
        attendee_name: "Ada Lovelace",
        attendee_email: "ada@example.com",
        ticket_code: "BEO-1234",
        qr_signature: "sig-xyz",
        status: "valid",
        created_at: "2026-11-13T00:00:00Z",
      },
    ];

    expect(await loadTicketsCache("user-1")).toBeNull();

    await saveTicketsCache("user-1", tickets);
    const cached = await loadTicketsCache("user-1");

    expect(cached).not.toBeNull();
    expect(cached?.tickets).toEqual(tickets);
    expect(typeof cached?.updatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(cached!.updatedAt))).toBe(false);
  });

  it("returns null when tickets cache contains corrupt JSON", async () => {
    await AsyncStorage.setItem("beo:tickets:user-corrupt", "{invalid-json");
    const cached = await loadTicketsCache("user-corrupt");
    expect(cached).toBeNull();
  });

  it("saves and loads event detail cache by slug", async () => {
    const event: EventDTO = {
      id: "ev-1",
      organizer_id: "org-1",
      title: "BEO Conf 2026",
      slug: "beo-conf-2026",
      event_type: "conference",
      start_at: "2026-12-01T09:00:00Z",
      end_at: "2026-12-01T17:00:00Z",
      venue: "Jakarta Convention Center",
      status: "published",
      created_at: "2026-11-01T00:00:00Z",
    };

    const sessions: SessionDTO[] = [
      {
        id: "s-1",
        event_id: "ev-1",
        title: "Opening Keynote",
        speaker_name: "Grace Hopper",
        speaker_bio: "Pioneer",
        start_at: "2026-12-01T09:30:00Z",
        end_at: "2026-12-01T10:30:00Z",
        room_or_stage: "Main Hall",
        created_at: "2026-11-01T00:00:00Z",
      },
    ];

    const posts: PostDTO[] = [
      {
        id: "p-1",
        event_id: "ev-1",
        author_id: "org-1",
        title: "Doors Open at 8 AM",
        body: "Please have your QR ticket ready.",
        notify_push: true,
        published_at: "2026-11-30T12:00:00Z",
      },
    ];

    expect(await loadEventDetailCache("beo-conf-2026")).toBeNull();

    await saveEventDetailCache("beo-conf-2026", { event, sessions, posts });
    const cached = await loadEventDetailCache("beo-conf-2026");

    expect(cached).not.toBeNull();
    expect(cached?.event).toEqual(event);
    expect(cached?.sessions).toEqual(sessions);
    expect(cached?.posts).toEqual(posts);
    expect(typeof cached?.updatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(cached!.updatedAt))).toBe(false);
  });

  it("returns null when event detail cache contains corrupt JSON", async () => {
    await AsyncStorage.setItem("beo:event:bad-slug", "not-json");
    const cached = await loadEventDetailCache("bad-slug");
    expect(cached).toBeNull();
  });
});
