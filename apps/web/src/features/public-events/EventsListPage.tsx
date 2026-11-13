import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { EventDTO, EventType } from "@beo/contracts";
import { apiFetch } from "../../lib/api";

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
    // Only published events are shown publicly
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
    <div className="space-y-8 py-6">
      {/* Hero Section */}
      <div className="rounded-2xl bg-gradient-to-r from-indigo-900 via-indigo-800 to-indigo-950 p-8 sm:p-12 text-white shadow-xl">
        <div className="max-w-2xl">
          <span className="inline-block rounded-full bg-indigo-500/30 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-200 border border-indigo-400/20">
            Discover What&apos;s Happening
          </span>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-5xl">
            BEO — Universal Event Organizer
          </h1>
          <p className="mt-4 text-base text-indigo-200 sm:text-lg">
            Join conferences, masterclasses, and community meetups. Seamless guest checkout and instant digital ticketing.
          </p>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <input
            type="search"
            placeholder="Search events by title or venue..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm shadow-xs placeholder:text-gray-400 focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedType("all")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedType === "all"
                ? "bg-indigo-600 text-white shadow-xs"
                : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
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
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedType === t
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
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
              className="h-64 animate-pulse rounded-2xl border border-gray-200 bg-gray-50 p-6"
            />
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-800">
            Failed to load events. Please try again.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-red-500"
          >
            Retry
          </button>
        </div>
      )}

      {/* Events Grid */}
      {!isLoading && !error && (
        <>
          {filteredEvents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center">
              <h3 className="text-lg font-semibold text-gray-900">No events found</h3>
              <p className="mt-1 text-sm text-gray-500">
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
                  "bg-gray-50 text-gray-700 border-gray-200";
                const label = EVENT_TYPE_LABELS[event.event_type] || event.event_type;

                return (
                  <div
                    key={event.id}
                    className="flex flex-col justify-between overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${colorClass}`}
                        >
                          {label}
                        </span>
                      </div>

                      <h2 className="mt-3 text-xl font-bold text-gray-900 line-clamp-2">
                        {event.title}
                      </h2>

                      <div className="mt-4 space-y-2 text-sm text-gray-600">
                        <div className="flex items-start gap-2">
                          <svg
                            className="h-4 w-4 shrink-0 text-gray-400 mt-0.5"
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
                          <span>{formatDateRange(event.start_at, event.end_at)}</span>
                        </div>

                        <div className="flex items-start gap-2">
                          <svg
                            className="h-4 w-4 shrink-0 text-gray-400 mt-0.5"
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
                          <span className="line-clamp-1">{event.venue}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-gray-100">
                      <Link
                        to={`/events/${event.slug}`}
                        className="block w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 transition-colors"
                      >
                        View Details &amp; Tickets
                      </Link>
                    </div>
                  </div>
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
