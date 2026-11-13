import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  MapPin,
  Wallet,
  Plus,
  QrCode,
  ExternalLink,
  Layers,
  CheckCircle2,
  FileEdit,
} from "lucide-react";
import {
  CreateEventSchema,
  EVENT_TYPES,
  type EventDTO,
  type EventStatus,
  type EventType,
} from "@beo/contracts";
import { apiFetch, ApiError } from "../../lib/api";

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  community: "Community Meetup",
  seminar_workshop: "Seminar & Workshop",
  conference: "Conference",
  meetup_ted: "Meetup & TED",
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export function OrganizerDashboardPage() {
  const queryClient = useQueryClient();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [eventType, setEventType] = useState<EventType>("community");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [venue, setVenue] = useState("");
  const [status, setStatus] = useState<EventStatus>("published");
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const {
    data: myEvents = [],
    isLoading,
    error,
  } = useQuery<EventDTO[]>({
    queryKey: ["organizer", "events"],
    queryFn: () => apiFetch<EventDTO[]>("/v1/organizer/events"),
  });

  const createMutation = useMutation({
    mutationFn: (payload: {
      title: string;
      slug: string;
      event_type: EventType;
      start_at: string;
      end_at: string;
      venue: string;
      status: EventStatus;
    }) =>
      apiFetch<EventDTO>("/v1/events", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["organizer", "events"] });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      setTitle("");
      setSlug("");
      setSlugEdited(false);
      setEventType("community");
      setStartAt("");
      setEndAt("");
      setVenue("");
      setStatus("published");
      setFormError(null);
      setShowCreateForm(false);
      setSuccessMsg(`Event "${created.title}" created successfully.`);
    },
  });

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slugEdited) {
      setSlug(slugify(val));
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMsg(null);

    if (!startAt || !endAt) {
      setFormError("Start and end date/time are required.");
      return;
    }

    const startDate = new Date(startAt);
    const endDate = new Date(endAt);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setFormError("Invalid start or end date/time.");
      return;
    }
    if (endDate <= startDate) {
      setFormError("End time must be after start time.");
      return;
    }

    const parsed = CreateEventSchema.safeParse({
      title,
      slug,
      event_type: eventType,
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
      venue,
      status,
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Invalid event details.");
      return;
    }

    createMutation.mutate({
      ...parsed.data,
      status: parsed.data.status ?? "published",
    });
  };

  const apiErrorMsg =
    createMutation.error instanceof ApiError
      ? createMutation.error.message
      : createMutation.error instanceof Error
        ? createMutation.error.message
        : null;

  const publishedCount = myEvents.filter((e) => e.status === "published").length;
  const draftCount = myEvents.filter((e) => e.status === "draft").length;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-950">
            Organizer Studio
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Create and manage your events, sessions, tickets, and payouts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/organizer/wallet"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
          >
            <Wallet className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <span>Wallet &amp; Payouts</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              setShowCreateForm((prev) => !prev);
              setFormError(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500"
          >
            {showCreateForm ? (
              <span>Close Form</span>
            ) : (
              <>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>+ Create Event</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Events
            </span>
            <Layers className="h-4 w-4 text-indigo-500" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-950 tabular-nums">
            {myEvents.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Published
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-950 tabular-nums">
            {publishedCount}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Drafts
            </span>
            <FileEdit className="h-4 w-4 text-amber-500" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-extrabold text-slate-950 tabular-nums">
            {draftCount}
          </p>
        </div>
      </div>

      {successMsg && (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm font-medium text-emerald-800"
        >
          {successMsg}
        </div>
      )}

      {/* Create Event Form */}
      {showCreateForm && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-950">Create New Event</h2>

          {(formError || apiErrorMsg) && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {formError ?? apiErrorMsg}
            </div>
          )}

          <form
            noValidate
            onSubmit={handleSubmit}
            className="mt-5 grid gap-4 sm:grid-cols-2"
          >
            <div>
              <label
                htmlFor="event-title"
                className="block text-sm font-semibold text-slate-700"
              >
                Event Title
              </label>
              <input
                id="event-title"
                type="text"
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="e.g. Jakarta Tech Summit 2026"
                className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                required
              />
            </div>

            <div>
              <label
                htmlFor="event-slug"
                className="block text-sm font-semibold text-slate-700"
              >
                URL Slug
              </label>
              <input
                id="event-slug"
                type="text"
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value);
                }}
                placeholder="e.g. jakarta-tech-summit-2026"
                className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2 font-mono text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                required
              />
            </div>

            <div>
              <label
                htmlFor="event-type"
                className="block text-sm font-semibold text-slate-700"
              >
                Event Type
              </label>
              <select
                id="event-type"
                value={eventType}
                onChange={(e) => setEventType(e.target.value as EventType)}
                className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              >
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {EVENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="event-status"
                className="block text-sm font-semibold text-slate-700"
              >
                Status
              </label>
              <select
                id="event-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as EventStatus)}
                className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="event-start"
                className="block text-sm font-semibold text-slate-700"
              >
                Start Date &amp; Time
              </label>
              <input
                id="event-start"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                required
              />
            </div>

            <div>
              <label
                htmlFor="event-end"
                className="block text-sm font-semibold text-slate-700"
              >
                End Date &amp; Time
              </label>
              <input
                id="event-end"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="event-venue"
                className="block text-sm font-semibold text-slate-700"
              >
                Venue
              </label>
              <input
                id="event-venue"
                type="text"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="e.g. Jakarta Convention Center, Hall A"
                className="mt-1.5 block w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm shadow-2xs focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
                required
              />
            </div>

            <div className="flex justify-end gap-3 sm:col-span-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50"
              >
                {createMutation.isPending ? "Creating..." : "Create Event"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Events List */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-950">Your Events</h2>

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center text-sm text-slate-500">
            Loading events...
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
          >
            {error instanceof Error ? error.message : "Failed to load events."}
          </div>
        ) : myEvents.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
            <h3 className="text-base font-bold text-slate-900">
              No events yet
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Create your first event to start managing sessions, tickets, and
              attendees.
            </p>
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500"
            >
              + Create Event
            </button>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {myEvents.map((ev) => (
              <article
                key={ev.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs transition-all hover:border-indigo-200 hover:shadow-sm"
              >
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-600/15">
                      {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        ev.status === "published"
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {ev.status}
                    </span>
                  </div>

                  <h3 className="mt-3 text-lg font-bold text-slate-950">
                    {ev.title}
                  </h3>
                  <p className="mt-0.5 font-mono text-xs text-slate-400">
                    /{ev.slug}
                  </p>

                  <div className="mt-3 space-y-1.5 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      <span>{ev.venue}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      <span>
                        {formatDate(ev.start_at)} &ndash; {formatDate(ev.end_at)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                  <Link
                    to={`/organizer/events/${ev.id}`}
                    state={{ event: ev }}
                    className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-indigo-500"
                  >
                    Manage Event
                  </Link>
                  <Link
                    to={`/events/${ev.id}/checkin`}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <QrCode className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    <span>Check-in</span>
                  </Link>
                  <Link
                    to={`/events/${ev.slug}`}
                    className="ml-auto inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
                  >
                    <span>View Public &rarr;</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
