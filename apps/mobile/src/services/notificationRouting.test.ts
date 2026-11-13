import { resolveNotificationRoute } from "./notificationRouting";

describe("resolveNotificationRoute", () => {
  it("routes event_slug payloads to the event detail screen", () => {
    expect(resolveNotificationRoute({ event_slug: "beo-conf-2026" })).toBe(
      "/events/beo-conf-2026"
    );
  });

  it("trims and URL-encodes event_slug values", () => {
    expect(resolveNotificationRoute({ event_slug: "  my event/2026  " })).toBe(
      "/events/my%20event%2F2026"
    );
  });

  it("routes claim_token payloads to the claim tab with token query param", () => {
    expect(resolveNotificationRoute({ claim_token: "  tok_abc+123  " })).toBe(
      "/(tabs)/claim?token=tok_abc%2B123"
    );
  });

  it("prioritizes event_slug when both event_slug and claim_token are present", () => {
    expect(
      resolveNotificationRoute({
        event_slug: "beo-conf-2026",
        claim_token: "tok_abc",
      })
    ).toBe("/events/beo-conf-2026");
  });

  it("returns null for undefined, empty, whitespace-only, or non-string payloads", () => {
    expect(resolveNotificationRoute(undefined)).toBeNull();
    expect(resolveNotificationRoute({})).toBeNull();
    expect(resolveNotificationRoute({ event_slug: "   " })).toBeNull();
    expect(resolveNotificationRoute({ claim_token: "" })).toBeNull();
    expect(resolveNotificationRoute({ event_slug: 12345 })).toBeNull();
    expect(resolveNotificationRoute({ claim_token: null })).toBeNull();
  });
});
