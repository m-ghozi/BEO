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
      // Fallback
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
      // Reset attendees to initial single empty row
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
      <div className="border-b border-gray-200 pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              Agency Portal
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Issue tickets from your allocated quota and distribute claim tokens to attendees. Logged in as{" "}
              <span className="font-semibold text-gray-700">{user?.name || user?.email}</span>.
            </p>
          </div>
        </div>
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <div className="flex items-center gap-2 font-semibold">
            <span>Error:</span>
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* Issue Form */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Issue Allocated Tickets
        </h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label
                htmlFor="eventId"
                className="block text-sm font-medium text-gray-700 mb-1"
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="ticketTypeId"
                className="block text-sm font-medium text-gray-700 mb-1"
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                required
              />
            </div>
          </div>

          {/* Attendees List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">
                Attendees ({attendees.length})
              </label>
              <button
                type="button"
                onClick={handleAddAttendee}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-500"
              >
                <Plus className="h-4 w-4" />
                Add Attendee
              </button>
            </div>

            <div className="space-y-3">
              {attendees.map((att, idx) => (
                <div
                  key={idx}
                  className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3 sm:flex-row sm:items-center"
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
                      className="block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
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
                      className="block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                      required
                    />
                  </div>
                  {attendees.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveAttendee(idx)}
                      className="self-end rounded-md p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 sm:self-center"
                      title="Remove attendee"
                      aria-label="Remove attendee"
                    >
                      <Trash2 className="h-4 w-4" />
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
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50"
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
            <TicketIcon className="h-5 w-5 text-indigo-600" />
            <h2 className="text-xl font-bold text-gray-900">
              Issued Tickets & Claim Links ({issuedTickets.length})
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
                  className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {tkt.attendee_name}
                      </h3>
                      <p className="text-sm text-gray-500">{tkt.attendee_email}</p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                      {tkt.status}
                    </span>
                  </div>

                  <div className="rounded-lg bg-gray-50 p-3 text-xs space-y-1.5 font-mono">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Ticket Code:</span>
                      <span className="font-semibold text-gray-800">
                        {tkt.ticket_code}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-500">Claim Token:</span>
                      <span className="text-indigo-700 break-all">
                        {tkt.claim_token}
                      </span>
                    </div>
                  </div>

                  {tkt.claim_token && (
                    <div className="space-y-2 pt-1">
                      <label className="block text-xs font-medium text-gray-500">
                        Attendee Claim URL:
                      </label>
                      <div className="flex items-center gap-2">
                        <Link
                          to={claimPath}
                          className="flex-1 truncate text-xs font-medium text-indigo-600 hover:underline"
                          title={fullClaimUrl}
                        >
                          {claimPath}
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleCopyClaimUrl(tkt.claim_token!)}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-2xs hover:bg-gray-50"
                        >
                          {isCopied ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-green-600" />
                              <span className="text-green-600">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 text-gray-500" />
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
