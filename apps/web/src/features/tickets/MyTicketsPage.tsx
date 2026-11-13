import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Ticket, Plus, Download, CheckCircle2, QrCode } from "lucide-react";
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
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-950">
            My Tickets
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            View your event tickets, download digital PDF passes, and display QR
            codes for on-site check-in.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/claim"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Claim a Ticket</span>
          </Link>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchTickets}
            className="font-semibold underline hover:text-rose-900"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center py-12 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
          <p className="mt-4 text-sm font-medium text-slate-600">
            Loading your tickets...
          </p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && tickets && tickets.length === 0 && (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-white p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Ticket className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-950">
            No tickets found
          </h2>
          <p className="mt-1.5 max-w-sm text-sm text-slate-500">
            You don&apos;t have any event tickets in your wallet yet. Claim a ticket
            using a claim token or browse public events.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/claim"
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500"
            >
              Claim a Ticket
            </Link>
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
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
              <article
                key={ticket.id}
                className="flex flex-col justify-between overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                {/* Pass Header */}
                <div className="border-b border-dashed border-slate-200 bg-slate-50/70 px-6 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                        isCheckedIn
                          ? "bg-slate-100 text-slate-700 ring-slate-600/20"
                          : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                      }`}
                    >
                      {!isCheckedIn && (
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      )}
                      {isCheckedIn ? "Checked In" : ticket.status || "Valid"}
                    </span>
                    <span className="font-mono text-xs font-semibold text-slate-600">
                      {ticket.ticket_code}
                    </span>
                  </div>
                </div>

                {/* Pass Body */}
                <div className="p-6">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Attendee
                    </p>
                    <h3 className="mt-0.5 text-lg font-bold text-slate-950">
                      {ticket.attendee_name}
                    </h3>
                    <p className="text-sm text-slate-500">{ticket.attendee_email}</p>
                  </div>

                  {ticket.checked_in_at && (
                    <div className="mt-3 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 tabular-nums">
                      Checked in on {new Date(ticket.checked_in_at).toLocaleString()}
                    </div>
                  )}

                  {/* Crisp QR Frame */}
                  <div className="mt-5 flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4">
                    <div className="rounded-xl bg-white p-2.5 shadow-2xs ring-1 ring-slate-200/70">
                      <img
                        src={`${API_BASE_URL}/v1/tickets/${ticket.ticket_code}/qr.png`}
                        alt={`QR Code for ${ticket.ticket_code}`}
                        className="h-40 w-40 object-contain"
                      />
                    </div>
                    <span className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                      <QrCode className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      <span>Show at venue gate</span>
                    </span>
                  </div>
                </div>

                {/* Ticket Footer Actions */}
                <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                  <a
                    href={`${API_BASE_URL}/v1/tickets/${ticket.ticket_code}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={`ticket-${ticket.ticket_code}.pdf`}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    <span>Download PDF</span>
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MyTicketsPage;
