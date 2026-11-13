import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClaimTicketSchema, type TicketDTO } from "@beo/contracts";
import { apiFetch, API_BASE_URL } from "../../lib/api";

export function ClaimTicketPage() {
  const [searchParams] = useSearchParams();
  const initialToken = searchParams.get("token") || "";

  const [claimToken, setClaimToken] = useState(initialToken);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimedTicket, setClaimedTicket] = useState<TicketDTO | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const validation = ClaimTicketSchema.safeParse({
      claim_token: claimToken.trim(),
    });

    if (!validation.success) {
      setError(validation.error.issues[0]?.message || "Invalid claim token");
      return;
    }

    try {
      setLoading(true);
      const ticket = await apiFetch<TicketDTO>("/v1/tickets/claim", {
        method: "POST",
        body: JSON.stringify({ claim_token: claimToken.trim() }),
      });
      setClaimedTicket(ticket);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to claim ticket";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setClaimedTicket(null);
    setClaimToken("");
    setError(null);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
      {claimedTicket ? (
        <div className="rounded-2xl bg-white p-8 shadow-xl ring-1 ring-gray-900/5">
          <div className="mb-6 flex items-center gap-3 rounded-lg bg-green-50 p-4 text-green-800 ring-1 ring-green-200">
            <svg
              className="h-6 w-6 shrink-0 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
            <div>
              <h2 className="text-base font-semibold">
                Ticket claimed successfully!
              </h2>
              <p className="text-sm text-green-700">
                Your ticket has been linked to your account. Present the QR code at
                the venue check-in desk or download the official PDF.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50/50 p-6">
            <div className="flex flex-col items-center justify-between gap-6 sm:flex-row sm:items-start">
              <div className="space-y-3 text-center sm:text-left">
                <div>
                  <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-700/10">
                    Status: {claimedTicket.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                    Attendee
                  </p>
                  <p className="text-lg font-bold text-gray-900">
                    {claimedTicket.attendee_name}
                  </p>
                  <p className="text-sm text-gray-600">
                    {claimedTicket.attendee_email}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                    Ticket Code
                  </p>
                  <p className="font-mono text-base font-semibold tracking-wide text-indigo-600">
                    {claimedTicket.ticket_code}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-center rounded-xl border border-gray-200 bg-white p-4 shadow-2xs">
                <img
                  src={`${API_BASE_URL}/v1/tickets/${claimedTicket.ticket_code}/qr.png`}
                  alt={`QR Code for ${claimedTicket.ticket_code}`}
                  className="h-44 w-44 object-contain"
                />
                <span className="mt-2 text-xs font-medium text-gray-500">
                  Scan at entrance
                </span>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-200 pt-6">
              <a
                href={`${API_BASE_URL}/v1/tickets/${claimedTicket.ticket_code}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                download={`ticket-${claimedTicket.ticket_code}.pdf`}
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
                    d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                </svg>
                Download PDF
              </a>

              <Link
                to="/my-tickets"
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-2xs hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                View My Tickets
              </Link>

              <button
                type="button"
                onClick={handleReset}
                className="ml-auto text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                Claim Another Ticket
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-white p-8 shadow-xl ring-1 ring-gray-900/5">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
              <svg
                className="h-6 w-6"
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
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Claim Your Event Ticket
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              Enter your claim token to link your ticket and access your QR
              code and downloadable PDF pass.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div>
              <label
                htmlFor="claimToken"
                className="block text-sm font-medium text-gray-700"
              >
                Claim Token
              </label>
              <div className="mt-1">
                <input
                  id="claimToken"
                  name="claimToken"
                  type="text"
                  required
                  value={claimToken}
                  onChange={(e) => setClaimToken(e.target.value)}
                  placeholder="e.g. clm_abc123"
                  className="block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 font-mono text-sm text-gray-900 shadow-2xs placeholder:text-gray-400 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-500">
                You can find this claim token in your invitation email or issued voucher.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50"
            >
              {loading ? "Claiming ticket..." : "Claim Ticket"}
            </button>
          </form>

          <div className="mt-6 border-t border-gray-100 pt-6 text-center">
            <Link
              to="/my-tickets"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              Already claimed? View your tickets in wallet &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClaimTicketPage;
