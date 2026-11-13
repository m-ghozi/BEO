import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar, MapPin, Megaphone, Clock, ChevronRight, ArrowRight, Ticket } from "lucide-react";
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
  community: "bg-emerald-50 text-emerald-700 border-emerald-200/80",
  seminar_workshop: "bg-sky-50 text-sky-700 border-sky-200/80",
  conference: "bg-violet-50 text-violet-700 border-violet-200/80",
  meetup_ted: "bg-rose-50 text-rose-700 border-rose-200/80",
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

  const {
    data: event,
    isLoading: eventLoading,
    error: eventError,
  } = useQuery<EventDTO>({
    queryKey: ["event", slug],
    queryFn: () => apiFetch<EventDTO>(`/v1/events/${slug}`),
    enabled: Boolean(slug),
  });

  const { data: fetchedSessions } = useQuery<SessionDTO[]>({
    queryKey: ["event-sessions", event?.id],
    queryFn: () =>
      apiFetch<SessionDTO[]>(`/v1/events/${event!.id}/sessions`).catch(
        () => event?.sessions || []
      ),
    enabled: Boolean(event?.id),
  });

  const { data: posts } = useQuery<PostDTO[]>({
    queryKey: ["event-posts", event?.id],
    queryFn: () =>
      apiFetch<PostDTO[]>(`/v1/events/${event!.id}/posts`).catch(() => []),
    enabled: Boolean(event?.id),
  });

  const { data: ticketTypes } = useQuery<TicketTypeDTO[]>({
    queryKey: ["event-ticket-types", event?.id],
    queryFn: () =>
      apiFetch<TicketTypeDTO[]>(`/v1/events/${event!.id}/ticket-types`).catch(() => []),
    enabled: Boolean(event?.id),
  });

  if (eventLoading) {
    return (
      <div className="space-y-6 py-4">
        <div className="h-52 animate-pulse rounded-3xl bg-slate-200/70" />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="h-72 animate-pulse rounded-2xl bg-slate-200/70 lg:col-span-7" />
          <div className="h-96 animate-pulse rounded-2xl bg-slate-200/70 lg:col-span-5" />
        </div>
      </div>
    );
  }

  if (eventError || !event) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white py-16 px-6 text-center shadow-2xs">
        <h2 className="text-2xl font-bold text-slate-950">Event Not Found</h2>
        <p className="mt-2 text-sm text-slate-500">
          The event you are looking for does not exist or may have been unlisted.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500"
        >
          Back to Events Directory
        </Link>
      </div>
    );
  }

  const sessions =
    fetchedSessions && fetchedSessions.length > 0 ? fetchedSessions : event.sessions || [];
  const typeLabel = EVENT_TYPE_LABELS[event.event_type] || event.event_type;
  const typeColor =
    EVENT_TYPE_COLORS[event.event_type] || "bg-slate-50 text-slate-700 border-slate-200";

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-slate-500">
        <Link to="/" className="font-medium transition-colors hover:text-indigo-600">
          Events
        </Link>
        <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
        <span className="truncate font-semibold text-slate-900">{event.title}</span>
      </nav>

      {/* Header Banner */}
      <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-2xs sm:p-8">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${typeColor}`}
          >
            {typeLabel}
          </span>
          {event.status === "completed" && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
              Completed
            </span>
          )}
          {event.event_type === "conference" && (
            <Link
              to={`/events/${event.id}/cfp`}
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100"
            >
              <span>Call for Papers (CFP Portal)</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>

        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
          {event.title}
        </h1>

        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 pt-6 text-sm text-slate-600 sm:grid-cols-2">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Calendar className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="font-semibold text-slate-900">Date &amp; Time</div>
              <div className="mt-0.5 tabular-nums">Starts: {formatFullDateTime(event.start_at)}</div>
              <div className="tabular-nums">Ends: {formatFullDateTime(event.end_at)}</div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <MapPin className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="font-semibold text-slate-900">Venue</div>
              <div className="mt-0.5">{event.venue}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Grid: Details/Schedule/Posts on left, Sticky Checkout on right */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left column (7 cols) */}
        <div className="space-y-8 lg:col-span-7">
          {posts && posts.length > 0 && (
            <section className="rounded-2xl border border-indigo-200/70 bg-indigo-50/40 p-6 shadow-2xs">
              <div className="flex items-center gap-2.5">
                <Megaphone className="h-5 w-5 text-indigo-600" aria-hidden="true" />
                <h2 className="text-xl font-bold tracking-tight text-slate-950">
                  Announcements &amp; Updates
                </h2>
              </div>
              <div className="mt-4 space-y-4">
                {posts.map((post) => (
                  <article
                    key={post.id}
                    className="rounded-xl border border-indigo-100 bg-white p-4 shadow-2xs"
                  >
                    <div className="flex items-center justify-between text-xs text-indigo-600">
                      <span className="font-semibold uppercase tracking-wider">Announcement</span>
                      <span className="tabular-nums text-slate-500">
                        {new Date(post.published_at).toLocaleDateString()}
                      </span>
                    </div>
                    <h3 className="mt-2 text-base font-bold text-slate-950">{post.title}</h3>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                      {post.body}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Schedule / Sessions Section */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <Clock className="h-5 w-5 text-indigo-600" aria-hidden="true" />
              <h2 className="text-xl font-bold tracking-tight text-slate-950">Event Schedule</h2>
            </div>
            {sessions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Detailed schedule has not been published yet.
              </p>
            ) : (
              <div className="mt-5 space-y-4 divide-y divide-slate-100">
                {sessions.map((sess) => (
                  <div key={sess.id} className="pt-4 first:pt-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-indigo-600 tabular-nums">
                        {formatSessionTime(sess.start_at, sess.end_at)}
                      </span>
                      {sess.room_or_stage && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                          {sess.room_or_stage}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1.5 text-base font-bold text-slate-950">{sess.title}</h3>
                    <div className="mt-1 text-sm font-medium text-slate-700">
                      Speaker: {sess.speaker_name}
                    </div>
                    {sess.speaker_bio && (
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        {sess.speaker_bio}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right column (5 cols): Sticky Checkout Panel */}
        <div className="lg:col-span-5">
          <div className="sticky top-24">
            {ticketTypes && ticketTypes.length > 0 ? (
              <CheckoutForm event={event} ticketTypes={ticketTypes} />
            ) : (
              <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-2xs">
                <Ticket className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-bold text-slate-950">Tickets</h3>
                <p className="mt-2 text-sm text-slate-500">
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
