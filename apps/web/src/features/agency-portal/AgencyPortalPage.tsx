import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  type TicketDTO,
  IssueAgencyTicketsSchema,
} from "@beo/contracts";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { Building2, Plus, Trash2, Copy, Check, Ticket as TicketIcon } from "lucide-react";

interface AttendeeRow {
  name: string;
  email: string;
}

export function AgencyPortalPage() {
  const { user } = useAuth();
  const [eventId, setEventId] = useState("");
  const [ticketTypeId, setTicketTypeId] = useState("");
  const [attendees, setAttendees] = useState<AttendeeRow[]>([
    { name: "", email: "" },
  ]);
  const [issuedTickets, setIssuedTickets] = useState<TicketDTO[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const handleAddAttendee = () => {
    setAttendees((prev) => [...prev, { name: "", email: "" }]);
  };

  const handleRemoveAttendee = (index: number) => {
    setAttendees((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAttendeeChange = (
    index: number,
    field: "name" | "email",
    value: string
  ) => {
    setAttendees((prev) =>
      prev.map((att, i) => (i === index ? { ...att, [field]: value } : att))
    );
  };

  const handleCopyClaimUrl = async (token: string) => {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "";
    const claimUrl = `${origin}/claim?token=${token}`;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(claimUrl);
      }
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2500);
    } catch {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2500);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedEventId = eventId.trim();
    const trimmedTicketTypeId = ticketTypeId.trim();

    if (!trimmedEventId) {
      setErrorMessage("Event ID is required");
      return;
    }

    const validation = IssueAgencyTicketsSchema.safeParse({
      ticket_type_id: trimmedTicketTypeId,
      attendees: attendees.map((a) => ({
        name: a.name.trim(),
        email: a.email.trim(),
      })),
    });

    if (!validation.success) {
      const firstError = validation.error.errors[0]?.message || "Invalid input";
      setErrorMessage(firstError);
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiFetch<TicketDTO[]>(
        `/v1/agency/events/${encodeURIComponent(trimmedEventId)}/issue`,
        {
          method: "POST",
          body: JSON.stringify(validation.data),
        }
      );

      setIssuedTickets((prev) => [...result, ...prev]);
      setAttendees([{ name: "", email: "" }]);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Failed to issue tickets");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-600/15">
            <Building2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">
              Agency Portal
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Issue tickets from your allocated quota and distribute claim tokens to attendees. Logged in as{" "}
              <span className="font-semibold text-slate-900">{user?.name || user?.email}</span>.
            </p>
          </div>
        </div>
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          <div className="flex items-center gap-2 font-semibold">
            <span>Error:</span>
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* Issue Form */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
        <h2 className="mb-5 text-lg font-bold text-slate-950">
          Issue Allocated Tickets
        </h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label
                htmlFor="eventId"
                className="mb-1.5 block text-sm font-semibold text-slate-700"
              >
                Event ID
              </label>
              <input
                type="text"
                id="eventId"
                name="eventId"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                placeholder="e.g. evt-uuid"
                className="block w-full rounded-xl border border-slate-300 px-3.5 py-2 font-mono text-sm text-slate-900 placeholder-slate-400 shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                required
              />
            </div>

            <div>
              <label
                htmlFor="ticketTypeId"
                className="mb-1.5 block text-sm font-semibold text-slate-700"
              >
                Ticket Type ID
              </label>
              <input
                type="text"
                id="ticketTypeId"
                name="ticketTypeId"
                value={ticketTypeId}
                onChange={(e) => setTicketTypeId(e.target.value)}
                placeholder="e.g. tt-uuid"
                className="block w-full rounded-xl border border-slate-300 px-3.5 py-2 font-mono text-sm text-slate-900 placeholder-slate-400 shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                required
              />
            </div>
          </div>

          {/* Attendees List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-semibold text-slate-700">
                Attendees ({attendees.length})
              </label>
              <button
                type="button"
                onClick={handleAddAttendee}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add Attendee</span>
              </button>
            </div>

            <div className="space-y-3">
              {attendees.map((att, idx) => (
                <div
                  key={idx}
                  className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 sm:flex-row sm:items-center"
                >
                  <div className="flex-1">
                    <label
                      htmlFor={`attendee-name-${idx}`}
                      className="sr-only"
                    >
                      Attendee Name
                    </label>
                    <input
                      type="text"
                      id={`attendee-name-${idx}`}
                      aria-label="Attendee Name"
                      placeholder="Attendee Name"
                      value={att.name}
                      onChange={(e) =>
                        handleAttendeeChange(idx, "name", e.target.value)
                      }
                      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                      required
                    />
                  </div>
                  <div className="flex-1">
                    <label
                      htmlFor={`attendee-email-${idx}`}
                      className="sr-only"
                    >
                      Attendee Email
                    </label>
                    <input
                      type="email"
                      id={`attendee-email-${idx}`}
                      aria-label="Attendee Email"
                      placeholder="Attendee Email"
                      value={att.email}
                      onChange={(e) =>
                        handleAttendeeChange(idx, "email", e.target.value)
                      }
                      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                      required
                    />
                  </div>
                  {attendees.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveAttendee(idx)}
                      className="self-end rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 sm:self-center"
                      title="Remove attendee"
                      aria-label="Remove attendee"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {isLoading ? "Issuing Tickets..." : "Issue Tickets"}
            </button>
          </div>
        </form>
      </div>

      {/* Issued Tickets Section */}
      {issuedTickets.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <TicketIcon className="h-5 w-5 text-indigo-600" aria-hidden="true" />
            <h2 className="text-xl font-bold text-slate-950">
              Issued Tickets &amp; Claim Links ({issuedTickets.length})
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {issuedTickets.map((tkt) => {
              const origin =
                typeof window !== "undefined" && window.location?.origin
                  ? window.location.origin
                  : "";
              const claimPath = `/claim?token=${tkt.claim_token || ""}`;
              const fullClaimUrl = `${origin}${claimPath}`;
              const isCopied = copiedToken === tkt.claim_token;

              return (
                <div
                  key={tkt.id}
                  className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-slate-950">
                        {tkt.attendee_name}
                      </h3>
                      <p className="text-sm text-slate-500">{tkt.attendee_email}</p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                      {tkt.status}
                    </span>
                  </div>

                  <div className="space-y-1.5 rounded-xl bg-slate-50 p-3 font-mono text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Ticket Code:</span>
                      <span className="font-semibold text-slate-800">
                        {tkt.ticket_code}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Claim Token:</span>
                      <span className="break-all text-indigo-700">
                        {tkt.claim_token}
                      </span>
                    </div>
                  </div>

                  {tkt.claim_token && (
                    <div className="space-y-1.5 pt-1">
                      <label className="block text-xs font-medium text-slate-500">
                        Attendee Claim URL:
                      </label>
                      <div className="flex items-center gap-2">
                        <Link
                          to={claimPath}
                          className="flex-1 truncate text-xs font-semibold text-indigo-600 hover:underline"
                          title={fullClaimUrl}
                        >
                          {claimPath}
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleCopyClaimUrl(tkt.claim_token!)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
                        >
                          {isCopied ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                              <span className="text-emerald-600">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                              <span>Copy Claim URL</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default AgencyPortalPage;
