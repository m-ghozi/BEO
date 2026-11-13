import type { TicketDTO } from "@beo/contracts";

export interface TicketStatusMeta {
  label: "Checked In" | "Cancelled" | "Valid";
  badgeStyle: "checkedIn" | "cancelled" | "valid";
}

/**
 * Derives the display label and visual variant for a ticket's current status.
 */
export function getTicketStatusMeta(
  ticket: Pick<TicketDTO, "checked_in_at" | "status">
): TicketStatusMeta {
  if (ticket.checked_in_at) {
    return { label: "Checked In", badgeStyle: "checkedIn" };
  }
  if (ticket.status === "cancelled") {
    return { label: "Cancelled", badgeStyle: "cancelled" };
  }
  return { label: "Valid", badgeStyle: "valid" };
}
