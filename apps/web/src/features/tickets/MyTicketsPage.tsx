import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import type { TicketDTO } from "@beo/contracts";
import { apiFetch, API_BASE_URL } from "../../lib/api";

export function MyTicketsPage() {
  const [tickets, setTickets] = useState<TicketDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<TicketDTO[]>("/v1/me/tickets");
      setTickets(data || []);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load tickets";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            My Tickets
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            View your event tickets, download digital PDF passes, and display QR
            codes for on-site check-in.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/claim"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            Claim a Ticket
          </Link>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="mb-8 flex items-center justify-between rounded-lg bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchTickets}
            className="font-semibold underline hover:text-red-800"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center py-12 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          <p className="mt-4 text-sm font-medium text-gray-600">
            Loading your tickets...
          </p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && tickets && tickets.length === 0 && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <svg
              className="h-7 w-7"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z"
              />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">
            No tickets found
          </h2>
          <p className="mt-1.5 max-w-sm text-sm text-gray-500">
            You don&apos;t have any event tickets in your wallet yet. Claim a ticket
            using a claim token or browse public events.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/claim"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
            >
              Claim a Ticket
            </Link>
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-2xs hover:bg-gray-50"
            >
              Browse Events
            </Link>
          </div>
        </div>
      )}

      {/* Tickets List */}
      {!loading && !error && tickets && tickets.length > 0 && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {tickets.map((ticket) => {
            const isCheckedIn = Boolean(ticket.checked_in_at);
            return (
              <div
                key={ticket.id}
                className="flex flex-col justify-between overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-gray-900/5 transition hover:shadow-lg"
              >
                {/* Ticket Top Info */}
                <div className="p-6">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                        isCheckedIn
                          ? "bg-gray-100 text-gray-700 ring-gray-600/20"
                          : "bg-green-50 text-green-700 ring-green-600/20"
                      }`}
                    >
                      {isCheckedIn ? "Checked In" : ticket.status || "Valid"}
                    </span>
                    <span className="font-mono text-xs font-medium text-gray-500">
                      {ticket.ticket_code}
                    </span>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
                      Attendee
                    </p>
                    <h3 className="mt-0.5 text-lg font-bold text-gray-900">
                      {ticket.attendee_name}
                    </h3>
                    <p className="text-sm text-gray-500">{ticket.attendee_email}</p>
                  </div>

                  {ticket.checked_in_at && (
                    <div className="mt-3 rounded-md bg-gray-50 px-3 py-1.5 text-xs text-gray-600">
                      Checked in on{" "}
                      {new Date(ticket.checked_in_at).toLocaleString()}
                    </div>
                  )}

                  {/* QR Image Preview */}
                  <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <img
                      src={`${API_BASE_URL}/v1/tickets/${ticket.ticket_code}/qr.png`}
                      alt={`QR Code for ${ticket.ticket_code}`}
                      className="h-44 w-44 object-contain"
                    />
                    <span className="mt-2 text-xs font-medium text-gray-500">
                      Show at venue gate
                    </span>
                  </div>
                </div>

                {/* Ticket Footer Actions */}
                <div className="border-t border-gray-100 bg-gray-50/50 p-4">
                  <a
                    href={`${API_BASE_URL}/v1/tickets/${ticket.ticket_code}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={`ticket-${ticket.ticket_code}.pdf`}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                      />
                    </svg>
                    Download PDF
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MyTicketsPage;
