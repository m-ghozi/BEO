/**
 * Resolves an Expo push notification data payload into an in-app Expo Router path.
 */
export function resolveNotificationRoute(
  data: Record<string, unknown> | undefined
): string | null {
  if (!data) {
    return null;
  }

  if (typeof data.event_slug === "string" && data.event_slug.trim() !== "") {
    return `/events/${encodeURIComponent(data.event_slug.trim())}`;
  }

  if (typeof data.claim_token === "string" && data.claim_token.trim() !== "") {
    return `/(tabs)/claim?token=${encodeURIComponent(data.claim_token.trim())}`;
  }

  return null;
}
