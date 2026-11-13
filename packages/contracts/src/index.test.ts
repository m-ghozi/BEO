import { describe, expect, it } from "vitest";
import {
  CreateEventSchema,
  ReserveOrderSchema,
  RegisterSchema,
  ClaimTicketSchema,
  CFPDecisionInputSchema,
  UpdateCommissionSchema,
  ProcessPayoutSchema,
  EventType,
} from "./index";

describe("CreateEventSchema", () => {
  const validBaseEvent = {
    title: "Jakarta Tech Community Meetup",
    slug: "jakarta-tech-community-meetup",
    start_at: "2026-11-20T09:00:00Z",
    end_at: "2026-11-20T17:00:00Z",
    venue: "Main Hall, Jakarta",
  };

  it("accepts all 4 event_type values", () => {
    const validTypes: EventType[] = [
      "community",
      "seminar_workshop",
      "conference",
      "meetup_ted",
    ];

    for (const event_type of validTypes) {
      const result = CreateEventSchema.safeParse({
        ...validBaseEvent,
        event_type,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid event_type values", () => {
    const result = CreateEventSchema.safeParse({
      ...validBaseEvent,
      event_type: "invalid_type",
    });
    expect(result.success).toBe(false);
  });

  it("validates slug format and rejects invalid slugs", () => {
    const validSlugs = ["valid-slug", "event-2026", "a", "conf-day-1"];
    for (const slug of validSlugs) {
      const res = CreateEventSchema.safeParse({
        ...validBaseEvent,
        event_type: "community",
        slug,
      });
      expect(res.success).toBe(true);
    }

    const invalidSlugs = [
      "Invalid Slug With Spaces",
      "UPPERCASE",
      "slug--double-dash",
      "-leading-dash",
      "trailing-dash-",
      "slug_with_underscore",
      "slug@symbol",
      "",
    ];

    for (const slug of invalidSlugs) {
      const res = CreateEventSchema.safeParse({
        ...validBaseEvent,
        event_type: "community",
        slug,
      });
      expect(res.success).toBe(false);
    }
  });
});

describe("ReserveOrderSchema", () => {
  const validBaseOrder = {
    ticket_type_id: "tt-12345",
    buyer_email: "buyer@example.com",
    payment_method: "duitku",
    attendees: [
      {
        name: "Alice Doe",
        email: "alice@example.com",
      },
    ],
  };

  it("accepts valid order reservation", () => {
    const result = ReserveOrderSchema.safeParse(validBaseOrder);
    expect(result.success).toBe(true);
  });

  it("requires at least 1 attendee", () => {
    const result = ReserveOrderSchema.safeParse({
      ...validBaseOrder,
      attendees: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid attendee email", () => {
    const result = ReserveOrderSchema.safeParse({
      ...validBaseOrder,
      attendees: [
        {
          name: "Alice Doe",
          email: "not-an-email",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty attendee name", () => {
    const result = ReserveOrderSchema.safeParse({
      ...validBaseOrder,
      attendees: [
        {
          name: "",
          email: "alice@example.com",
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("RegisterSchema & ClaimTicketSchema", () => {
  it("validates registration schema", () => {
    const valid = RegisterSchema.safeParse({
      name: "John Doe",
      email: "john@example.com",
      password: "password123",
      account_type: "standard",
    });
    expect(valid.success).toBe(true);

    const invalid = RegisterSchema.safeParse({
      name: "",
      email: "invalid-email",
      password: "123",
      account_type: "invalid",
    });
    expect(invalid.success).toBe(false);
  });

  it("validates claim ticket schema", () => {
    const valid = ClaimTicketSchema.safeParse({
      claim_token: "tok-abc-123",
    });
    expect(valid.success).toBe(true);

    const invalid = ClaimTicketSchema.safeParse({
      claim_token: "",
    });
    expect(invalid.success).toBe(false);
  });
});

describe("CFPDecisionInputSchema", () => {
  it("accepts valid decision values and rejects status field", () => {
    for (const decision of [
      "accepted",
      "rejected",
      "revision_required",
    ] as const) {
      expect(CFPDecisionInputSchema.safeParse({ decision }).success).toBe(true);
    }

    expect(
      CFPDecisionInputSchema.safeParse({ status: "accepted" }).success
    ).toBe(false);
    expect(
      CFPDecisionInputSchema.safeParse({ decision: "pending" }).success
    ).toBe(false);
  });
});

describe("UpdateCommissionSchema", () => {
  it("accepts rates between 0 and 100 inclusive", () => {
    expect(UpdateCommissionSchema.safeParse({ rate_percent: 0 }).success).toBe(true);
    expect(UpdateCommissionSchema.safeParse({ rate_percent: 5.5 }).success).toBe(true);
    expect(UpdateCommissionSchema.safeParse({ rate_percent: 100 }).success).toBe(true);
  });

  it("rejects rates below 0 or above 100", () => {
    expect(UpdateCommissionSchema.safeParse({ rate_percent: -0.1 }).success).toBe(false);
    expect(UpdateCommissionSchema.safeParse({ rate_percent: 100.1 }).success).toBe(false);
    expect(UpdateCommissionSchema.safeParse({ rate_percent: "5" }).success).toBe(false);
  });
});

describe("ProcessPayoutSchema", () => {
  it("accepts valid payout actions with optional trimmed note", () => {
    for (const action of ["approve", "complete", "reject"] as const) {
      expect(ProcessPayoutSchema.safeParse({ action }).success).toBe(true);
      const withNote = ProcessPayoutSchema.safeParse({
        action,
        note: "  verified transfer  ",
      });
      expect(withNote.success).toBe(true);
      if (withNote.success) {
        expect(withNote.data.note).toBe("verified transfer");
      }
    }
  });

  it("rejects invalid payout actions", () => {
    expect(ProcessPayoutSchema.safeParse({ action: "pending" }).success).toBe(false);
    expect(ProcessPayoutSchema.safeParse({ action: "" }).success).toBe(false);
  });
});
