import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Ticket, Download, QrCode } from "lucide-react";
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
    <div className="mx-auto max-w-2xl py-8">
      {claimedTicket ? (
        <div className="rounded-3xl border border-slate-200/80 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" aria-hidden="true" />
            <div>
              <h2 className="text-base font-bold">
                Ticket claimed successfully!
              </h2>
              <p className="mt-0.5 text-sm text-emerald-800">
                Your ticket has been linked to your account. Present the QR code at
                the venue check-in desk or download the official PDF.
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/60 p-6">
            <div className="flex flex-col items-center justify-between gap-6 sm:flex-row sm:items-start">
              <div className="space-y-3.5 text-center sm:text-left">
                <div>
                  <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-700/15">
                    Status: {claimedTicket.status}
                  </span>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Attendee
                  </p>
                  <p className="text-lg font-bold text-slate-950">
                    {claimedTicket.attendee_name}
                  </p>
                  <p className="text-sm text-slate-600">
                    {claimedTicket.attendee_email}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Ticket Code
                  </p>
                  <p className="font-mono text-base font-semibold tracking-wide text-indigo-600">
                    {claimedTicket.ticket_code}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-center rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
                <img
                  src={`${API_BASE_URL}/v1/tickets/${claimedTicket.ticket_code}/qr.png`}
                  alt={`QR Code for ${claimedTicket.ticket_code}`}
                  className="h-44 w-44 object-contain"
                />
                <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <QrCode className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>Scan at entrance</span>
                </span>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-200/80 pt-6">
              <a
                href={`${API_BASE_URL}/v1/tickets/${claimedTicket.ticket_code}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                download={`ticket-${claimedTicket.ticket_code}.pdf`}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>Download PDF</span>
              </a>

              <Link
                to="/my-tickets"
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
              >
                View My Tickets
              </Link>

              <button
                type="button"
                onClick={handleReset}
                className="ml-auto text-sm font-semibold text-indigo-600 hover:text-indigo-500"
              >
                Claim Another Ticket
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-slate-200/80 bg-white p-8 shadow-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-600/15">
              <Ticket className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-950">
              Claim Your Event Ticket
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Enter your claim token to link your ticket and access your QR
              code and downloadable PDF pass.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div>
              <label
                htmlFor="claimToken"
                className="block text-sm font-semibold text-slate-700"
              >
                Claim Token
              </label>
              <div className="mt-1.5">
                <input
                  id="claimToken"
                  name="claimToken"
                  type="text"
                  required
                  value={claimToken}
                  onChange={(e) => setClaimToken(e.target.value)}
                  placeholder="e.g. clm_abc123"
                  className="block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                You can find this claim token in your invitation email or issued voucher.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {loading ? "Claiming ticket..." : "Claim Ticket"}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-100 pt-6 text-center">
            <Link
              to="/my-tickets"
              className="text-sm font-semibold text-indigo-600 hover:text-indigo-500"
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
