import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EventDTO, PostDTO, SessionDTO, TicketDTO } from "@beo/contracts";

export type EventPostDTO = PostDTO;

export interface CachedTickets {
  tickets: TicketDTO[];
  updatedAt: string;
}

export interface CachedEventDetail {
  event: EventDTO;
  sessions: SessionDTO[];
  posts: EventPostDTO[];
  updatedAt: string;
}

function ticketsCacheKey(userId: string): string {
  return `beo:tickets:${userId}`;
}

function eventDetailCacheKey(slug: string): string {
  return `beo:event:${slug}`;
}

async function readJsonSafely<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Persists a user's claimed tickets locally for offline gate access.
 */
export async function saveTicketsCache(
  userId: string,
  tickets: TicketDTO[]
): Promise<void> {
  const payload: CachedTickets = {
    tickets,
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(ticketsCacheKey(userId), JSON.stringify(payload));
}

/**
 * Loads cached tickets for a user, returning null if missing or corrupt.
 */
export async function loadTicketsCache(
  userId: string
): Promise<CachedTickets | null> {
  const parsed = await readJsonSafely<CachedTickets>(ticketsCacheKey(userId));
  if (!parsed || !Array.isArray(parsed.tickets) || typeof parsed.updatedAt !== "string") {
    return null;
  }
  return parsed;
}

/**
 * Persists an event's schedule and organizer announcements locally.
 */
export async function saveEventDetailCache(
  slug: string,
  detail: Omit<CachedEventDetail, "updatedAt">
): Promise<void> {
  const payload: CachedEventDetail = {
    ...detail,
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(eventDetailCacheKey(slug), JSON.stringify(payload));
}

/**
 * Loads cached event details by slug, returning null if missing or corrupt.
 */
export async function loadEventDetailCache(
  slug: string
): Promise<CachedEventDetail | null> {
  const parsed = await readJsonSafely<CachedEventDetail>(eventDetailCacheKey(slug));
  if (
    !parsed ||
    !parsed.event ||
    !Array.isArray(parsed.sessions) ||
    !Array.isArray(parsed.posts) ||
    typeof parsed.updatedAt !== "string"
  ) {
    return null;
  }
  return parsed;
}
