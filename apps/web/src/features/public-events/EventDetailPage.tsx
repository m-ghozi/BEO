import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { EventDTO, SessionDTO, PostDTO, TicketTypeDTO, EventType } from "@beo/contracts";
import { apiFetch } from "../../lib/api";
import { CheckoutForm } from "./CheckoutForm";

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  community: "Community Meetup",
  seminar_workshop: "Seminar & Workshop",
  conference: "Conference",
  meetup_ted: "Meetup & TED",
};

const EVENT_TYPE_COLORS: Record<EventType, string> = {
  community: "bg-emerald-50 text-emerald-700 border-emerald-200",
  seminar_workshop: "bg-blue-50 text-blue-700 border-blue-200",
  conference: "bg-purple-50 text-purple-700 border-purple-200",
  meetup_ted: "bg-rose-50 text-rose-700 border-rose-200",
};

function formatFullDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      weekday: "short",
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

function formatSessionTime(startStr: string, endStr: string): string {
  try {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
    };
    return `${start.toLocaleTimeString("en-US", timeOptions)} – ${end.toLocaleTimeString(
      "en-US",
      timeOptions
    )}`;
  } catch {
    return `${startStr} – ${endStr}`;
  }
}

export function EventDetailPage() {
  const { slug } = useParams<{ slug: string }>();

  // 1. Fetch Event Details
  const {
    data: event,
    isLoading: eventLoading,
    error: eventError,
  } = useQuery<EventDTO>({
    queryKey: ["event", slug],
    queryFn: () => apiFetch<EventDTO>(`/v1/events/${slug}`),
    enabled: Boolean(slug),
  });

  // 2. Fetch Sessions
  const { data: fetchedSessions } = useQuery<SessionDTO[]>({
    queryKey: ["event-sessions", event?.id],
    queryFn: () =>
      apiFetch<SessionDTO[]>(`/v1/events/${event!.id}/sessions`).catch(
        () => event?.sessions || []
      ),
    enabled: Boolean(event?.id),
  });

  // 3. Fetch Posts / Announcements
  const { data: posts } = useQuery<PostDTO[]>({
    queryKey: ["event-posts", event?.id],
    queryFn: () =>
      apiFetch<PostDTO[]>(`/v1/events/${event!.id}/posts`).catch(() => []),
    enabled: Boolean(event?.id),
  });

  // 4. Fetch Ticket Types
  const { data: ticketTypes } = useQuery<TicketTypeDTO[]>({
    queryKey: ["event-ticket-types", event?.id],
    queryFn: () =>
      apiFetch<TicketTypeDTO[]>(`/v1/events/${event!.id}/ticket-types`).catch(() => []),
    enabled: Boolean(event?.id),
  });

  if (eventLoading) {
    return (
      <div className="py-12">
        <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />
      </div>
    );
  }

  if (eventError || !event) {
    return (
      <div className="py-16 text-center">
        <h2 className="text-2xl font-bold text-gray-900">Event Not Found</h2>
        <p className="mt-2 text-sm text-gray-500">
          The event you are looking for does not exist or may have been unlisted.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500"
        >
          Back to Events Directory
        </Link>
      </div>
    );
  }

  const sessions = fetchedSessions && fetchedSessions.length > 0 ? fetchedSessions : event.sessions || [];
  const typeLabel = EVENT_TYPE_LABELS[event.event_type] || event.event_type;
  const typeColor =
    EVENT_TYPE_COLORS[event.event_type] || "bg-gray-50 text-gray-700 border-gray-200";

  return (
    <div className="space-y-8 py-6">
      {/* Breadcrumb / Back Link */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/" className="hover:text-indigo-600">
          Events
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium truncate">{event.title}</span>
      </div>

      {/* Header Banner */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${typeColor}`}
          >
            {typeLabel}
          </span>
          {event.status === "completed" && (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              Completed
            </span>
          )}
          {event.event_type === "conference" && (
            <Link
              to={`/events/${event.id}/cfp`}
              className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-100"
            >
              Call for Papers (CFP Portal) &rarr;
            </Link>
          )}
        </div>

        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">
          {event.title}
        </h1>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 text-sm text-gray-600">
          <div className="flex items-start gap-3">
            <svg
              className="h-5 w-5 shrink-0 text-indigo-600 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <div>
              <div className="font-semibold text-gray-900">Date &amp; Time</div>
              <div>Starts: {formatFullDateTime(event.start_at)}</div>
              <div>Ends: {formatFullDateTime(event.end_at)}</div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <svg
              className="h-5 w-5 shrink-0 text-indigo-600 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <div>
              <div className="font-semibold text-gray-900">Venue</div>
              <div>{event.venue}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Details/Schedule/Posts on left, Checkout on right */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left column (7 cols) */}
        <div className="space-y-8 lg:col-span-7">
          {/* Announcements / Posts Section */}
          {posts && posts.length > 0 && (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-6 shadow-sm">
              <h2 className="text-xl font-bold text-gray-900">Announcements &amp; Updates</h2>
              <div className="mt-4 space-y-4">
                {posts.map((post) => (
                  <div
                    key={post.id}
                    className="rounded-xl border border-indigo-100 bg-white p-4 shadow-2xs"
                  >
                    <div className="flex items-center justify-between text-xs text-indigo-600">
                      <span className="font-semibold uppercase tracking-wider">Announcement</span>
                      <span>{new Date(post.published_at).toLocaleDateString()}</span>
                    </div>
                    <h3 className="mt-2 text-base font-bold text-gray-900">{post.title}</h3>
                    <p className="mt-2 text-sm text-gray-700 whitespace-pre-line">{post.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Schedule / Sessions Section */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-gray-900">Event Schedule</h2>
            {sessions.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">
                Detailed schedule has not been published yet.
              </p>
            ) : (
              <div className="mt-4 space-y-4 divide-y divide-gray-100">
                {sessions.map((sess) => (
                  <div key={sess.id} className="pt-4 first:pt-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-indigo-600">
                        {formatSessionTime(sess.start_at, sess.end_at)}
                      </span>
                      {sess.room_or_stage && (
                        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                          {sess.room_or_stage}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1 text-base font-bold text-gray-900">{sess.title}</h3>
                    <div className="mt-1 text-sm font-medium text-gray-700">
                      Speaker: {sess.speaker_name}
                    </div>
                    {sess.speaker_bio && (
                      <p className="mt-1 text-xs text-gray-500">{sess.speaker_bio}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column (5 cols): Checkout Form */}
        <div className="lg:col-span-5">
          <div className="sticky top-6">
            {ticketTypes && ticketTypes.length > 0 ? (
              <CheckoutForm event={event} ticketTypes={ticketTypes} />
            ) : (
              <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
                <h3 className="text-lg font-bold text-gray-900">Tickets</h3>
                <p className="mt-2 text-sm text-gray-500">
                  Ticket sales have not opened yet for this event. Please check back soon or follow
                  announcements above.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default EventDetailPage;
