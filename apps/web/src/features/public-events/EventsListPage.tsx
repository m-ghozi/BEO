import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar, MapPin, Search, ArrowRight, Sparkles, AlertCircle } from "lucide-react";
import type { EventDTO, EventType } from "@beo/contracts";
import { apiFetch } from "../../lib/api";

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

function formatDateRange(startStr: string, endStr: string): string {
  try {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const dateOptions: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
      year: "numeric",
    };
    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
    };

    const startDate = start.toLocaleDateString("en-US", dateOptions);
    const startTime = start.toLocaleTimeString("en-US", timeOptions);
    const endTime = end.toLocaleTimeString("en-US", timeOptions);

    return `${startDate} • ${startTime} – ${endTime}`;
  } catch {
    return `${startStr} – ${endStr}`;
  }
}

export function EventsListPage() {
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");

  const {
    data: events,
    isLoading,
    error,
    refetch,
  } = useQuery<EventDTO[]>({
    queryKey: ["events"],
    queryFn: () => apiFetch<EventDTO[]>("/v1/events"),
  });

  const filteredEvents = (events || []).filter((event) => {
    if (event.status && event.status !== "published") {
      return false;
    }
    const matchesSearch =
      search.trim() === "" ||
      event.title.toLowerCase().includes(search.toLowerCase()) ||
      event.venue.toLowerCase().includes(search.toLowerCase());
    const matchesType = selectedType === "all" || event.event_type === selectedType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-8">
      {/* Editorial Hero Section */}
      <section className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-10 text-white shadow-xl sm:px-12 sm:py-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-indigo-600/30 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-violet-600/20 blur-3xl"
        />
        <div className="relative max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/25 bg-indigo-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-200">
            <Sparkles className="h-3.5 w-3.5 text-indigo-300" aria-hidden="true" />
            Discover What&apos;s Happening
          </span>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-white sm:text-5xl sm:leading-[1.1]">
            BEO — Universal Event Organizer
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-300 sm:text-lg">
            Join conferences, masterclasses, and community meetups. Seamless guest checkout and instant digital ticketing.
          </p>
        </div>
      </section>

      {/* Filter and Search Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search events by title or venue..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 shadow-2xs transition-colors placeholder:text-slate-400 focus:border-indigo-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedType("all")}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
              selectedType === "all"
                ? "bg-slate-950 text-white shadow-xs"
                : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
            }`}
          >
            All Events
          </button>
          {(["community", "seminar_workshop", "conference", "meetup_ted"] as EventType[]).map(
            (t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSelectedType(t)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                  selectedType === t
                    ? "bg-slate-950 text-white shadow-xs"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                {EVENT_TYPE_LABELS[t]}
              </button>
            )
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="flex h-64 flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs"
            >
              <div className="space-y-3">
                <div className="h-5 w-28 animate-pulse rounded-full bg-slate-100" />
                <div className="h-6 w-3/4 animate-pulse rounded-lg bg-slate-100" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
              </div>
              <div className="h-10 w-full animate-pulse rounded-xl bg-slate-100" />
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50/80 p-8 text-center"
        >
          <AlertCircle className="mx-auto h-8 w-8 text-rose-500" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-rose-900">
            Failed to load events. Please try again.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-rose-500"
          >
            Retry
          </button>
        </div>
      )}

      {/* Events Grid */}
      {!isLoading && !error && (
        <>
          {filteredEvents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 py-16 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
              <h3 className="mt-3 text-lg font-bold text-slate-900">No events found</h3>
              <p className="mt-1 text-sm text-slate-500">
                {search || selectedType !== "all"
                  ? "Try adjusting your search query or filter"
                  : "Check back later for newly published community and conference events"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filteredEvents.map((event) => {
                const colorClass =
                  EVENT_TYPE_COLORS[event.event_type] ||
                  "bg-slate-50 text-slate-700 border-slate-200";
                const label = EVENT_TYPE_LABELS[event.event_type] || event.event_type;

                return (
                  <article
                    key={event.id}
                    className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${colorClass}`}
                        >
                          {label}
                        </span>
                      </div>

                      <h2 className="mt-3.5 text-xl font-bold tracking-tight text-slate-950 line-clamp-2 group-hover:text-indigo-600 transition-colors">
                        {event.title}
                      </h2>

                      <div className="mt-4 space-y-2.5 text-sm text-slate-600">
                        <div className="flex items-start gap-2.5">
                          <Calendar
                            className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500"
                            aria-hidden="true"
                          />
                          <span className="tabular-nums">
                            {formatDateRange(event.start_at, event.end_at)}
                          </span>
                        </div>

                        <div className="flex items-start gap-2.5">
                          <MapPin
                            className="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                            aria-hidden="true"
                          />
                          <span className="line-clamp-1">{event.venue}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 border-t border-slate-100 pt-4">
                      <Link
                        to={`/events/${event.slug}`}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-500"
                      >
                        <span>View Details &amp; Tickets</span>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default EventsListPage;
