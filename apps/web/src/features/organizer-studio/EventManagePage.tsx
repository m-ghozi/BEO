import { useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AllocateAgencyQuotaSchema,
  CreatePostSchema,
  CreateSessionSchema,
  CreateTicketTypeSchema,
  ManualPaymentVerificationSchema,
  type EventAgencyDTO,
  type EventDTO,
  type EventMemberDTO,
  type EventOrderDTO,
  type PostDTO,
  type SessionDTO,
  type TicketTypeDTO,
} from "@beo/contracts";
import { API_BASE_URL, apiFetch, ApiError } from "../../lib/api";

type ManageTab =
  | "sessions"
  | "posts"
  | "tickets"
  | "verification"
  | "agencies"
  | "members";

const TABS: { id: ManageTab; label: string }[] = [
  { id: "sessions", label: "Sessions" },
  { id: "posts", label: "Posts" },
  { id: "tickets", label: "Ticket Types" },
  { id: "verification", label: "Manual Verification" },
  { id: "agencies", label: "Agencies" },
  { id: "members", label: "Team Members" },
];

type TeamRole = "co_organizer" | "reviewer" | "checkin_staff";

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function EventManagePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();
  const stateEvent = (location.state as { event?: EventDTO } | null)?.event;

  const [activeTab, setActiveTab] = useState<ManageTab>("sessions");

  // Fetch events list to resolve event metadata if navigated directly
  const { data: eventsList = [] } = useQuery<EventDTO[]>({
    queryKey: ["events"],
    queryFn: () => apiFetch<EventDTO[]>("/v1/events"),
    enabled: !stateEvent,
  });

  const event =
    stateEvent ?? eventsList.find((ev) => ev.id === eventId) ?? null;

  // Sessions query & form state
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<
    SessionDTO[]
  >({
    queryKey: ["event-sessions", eventId],
    queryFn: () => apiFetch<SessionDTO[]>(`/v1/events/${eventId}/sessions`),
    enabled: Boolean(eventId),
  });

  const [sessTitle, setSessTitle] = useState("");
  const [speakerName, setSpeakerName] = useState("");
  const [speakerBio, setSpeakerBio] = useState("");
  const [sessStart, setSessStart] = useState("");
  const [sessEnd, setSessEnd] = useState("");
  const [roomOrStage, setRoomOrStage] = useState("");
  const [sessError, setSessError] = useState<string | null>(null);
  const [sessSuccess, setSessSuccess] = useState<string | null>(null);

  const addSessionMutation = useMutation({
    mutationFn: (payload: {
      title: string;
      speaker_name: string;
      speaker_bio: string;
      start_at: string;
      end_at: string;
      room_or_stage: string;
    }) =>
      apiFetch<SessionDTO>(`/v1/events/${eventId}/sessions`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["event-sessions", eventId] });
      setSessTitle("");
      setSpeakerName("");
      setSpeakerBio("");
      setSessStart("");
      setSessEnd("");
      setRoomOrStage("");
      setSessError(null);
      setSessSuccess(`Session "${created.title}" added.`);
    },
  });

  const handleAddSession = (e: FormEvent) => {
    e.preventDefault();
    setSessError(null);
    setSessSuccess(null);

    if (!sessStart || !sessEnd) {
      setSessError("Session start and end times are required.");
      return;
    }
    const startDate = new Date(sessStart);
    const endDate = new Date(sessEnd);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setSessError("Invalid session date/time.");
      return;
    }
    if (endDate <= startDate) {
      setSessError("Session end time must be after start time.");
      return;
    }

    const parsed = CreateSessionSchema.safeParse({
      title: sessTitle,
      speaker_name: speakerName,
      speaker_bio: speakerBio,
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
      room_or_stage: roomOrStage,
    });

    if (!parsed.success) {
      setSessError(parsed.error.issues[0]?.message ?? "Invalid session input.");
      return;
    }

    addSessionMutation.mutate(parsed.data);
  };

  // Posts query & form state
  const { data: posts = [], isLoading: postsLoading } = useQuery<PostDTO[]>({
    queryKey: ["event-posts", eventId],
    queryFn: () => apiFetch<PostDTO[]>(`/v1/events/${eventId}/posts`),
    enabled: Boolean(eventId),
  });

  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [notifyPush, setNotifyPush] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState<string | null>(null);

  const publishPostMutation = useMutation({
    mutationFn: (payload: {
      title: string;
      body: string;
      notify_push: boolean;
    }) =>
      apiFetch<PostDTO>(`/v1/events/${eventId}/posts`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["event-posts", eventId] });
      setPostTitle("");
      setPostBody("");
      setNotifyPush(false);
      setPostError(null);
      setPostSuccess(`Announcement "${created.title}" published.`);
    },
  });

  const handlePublishPost = (e: FormEvent) => {
    e.preventDefault();
    setPostError(null);
    setPostSuccess(null);

    const parsed = CreatePostSchema.safeParse({
      title: postTitle,
      body: postBody,
      notify_push: notifyPush,
    });

    if (!parsed.success) {
      setPostError(parsed.error.issues[0]?.message ?? "Invalid post input.");
      return;
    }

    publishPostMutation.mutate(parsed.data);
  };

  // Ticket Types query & form state
  const { data: ticketTypes = [], isLoading: ticketTypesLoading } = useQuery<
    TicketTypeDTO[]
  >({
    queryKey: ["event-ticket-types", eventId],
    queryFn: () =>
      apiFetch<TicketTypeDTO[]>(`/v1/events/${eventId}/ticket-types`),
    enabled: Boolean(eventId),
  });

  const [ttName, setTtName] = useState("");
  const [ttPrice, setTtPrice] = useState("0");
  const [ttCurrency, setTtCurrency] = useState("IDR");
  const [ttQuota, setTtQuota] = useState("100");
  const [ttRequiresCfp, setTtRequiresCfp] = useState(false);
  const [ttSalesEnd, setTtSalesEnd] = useState("");
  const [ttError, setTtError] = useState<string | null>(null);
  const [ttSuccess, setTtSuccess] = useState<string | null>(null);

  const createTicketTypeMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      price: number;
      currency: string;
      quota: number;
      requires_accepted_cfp: boolean;
      sales_end_at: string;
    }) =>
      apiFetch<TicketTypeDTO>(`/v1/events/${eventId}/ticket-types`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({
        queryKey: ["event-ticket-types", eventId],
      });
      setTtName("");
      setTtPrice("0");
      setTtQuota("100");
      setTtRequiresCfp(false);
      setTtSalesEnd("");
      setTtError(null);
      setTtSuccess(`Ticket type "${created.name}" created (ID: ${created.id}).`);
    },
  });

  const handleCreateTicketType = (e: FormEvent) => {
    e.preventDefault();
    setTtError(null);
    setTtSuccess(null);

    if (!ttSalesEnd) {
      setTtError("Sales end date/time is required.");
      return;
    }
    const salesEndDate = new Date(ttSalesEnd);
    if (Number.isNaN(salesEndDate.getTime())) {
      setTtError("Invalid sales end date/time.");
      return;
    }

    const parsed = CreateTicketTypeSchema.safeParse({
      name: ttName,
      price: Number(ttPrice),
      currency: ttCurrency || "IDR",
      quota: Number(ttQuota),
      requires_accepted_cfp: ttRequiresCfp,
      sales_end_at: salesEndDate.toISOString(),
    });

    if (!parsed.success) {
      setTtError(
        parsed.error.issues[0]?.message ?? "Invalid ticket type input."
      );
      return;
    }

    createTicketTypeMutation.mutate({
      name: parsed.data.name,
      price: parsed.data.price,
      currency: parsed.data.currency,
      quota: parsed.data.quota,
      requires_accepted_cfp: parsed.data.requires_accepted_cfp,
      sales_end_at: parsed.data.sales_end_at,
    });
  };

  // Orders & Manual Transfer Verification state
  const { data: orders = [], isLoading: ordersLoading } = useQuery<
    EventOrderDTO[]
  >({
    queryKey: ["event-orders", eventId],
    queryFn: () => apiFetch<EventOrderDTO[]>(`/v1/events/${eventId}/orders`),
    enabled: Boolean(eventId),
  });

  const [verifyOrderId, setVerifyOrderId] = useState("");
  const [verifyReason, setVerifyReason] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifySuccess, setVerifySuccess] = useState<string | null>(null);

  const verifyMutation = useMutation({
    mutationFn: ({
      orderId,
      approve,
      reason,
    }: {
      orderId: string;
      approve: boolean;
      reason: string;
    }) =>
      apiFetch<{ status: string }>(`/v1/orders/${orderId}/verify`, {
        method: "POST",
        body: JSON.stringify({ approve, reason }),
      }),
    onSuccess: (res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["event-orders", eventId] });
      setVerifyError(null);
      setVerifySuccess(
        `Order ${vars.orderId} marked as "${res.status}".`
      );
      setVerifyOrderId("");
      setVerifyReason("");
    },
  });

  const handleVerifyOrder = (approve: boolean) => {
    setVerifyError(null);
    setVerifySuccess(null);

    const trimmedOrderId = verifyOrderId.trim();
    if (!trimmedOrderId) {
      setVerifyError("Order ID is required.");
      return;
    }

    const parsed = ManualPaymentVerificationSchema.safeParse({
      approve,
      reason: verifyReason,
    });

    if (!parsed.success) {
      setVerifyError(
        parsed.error.issues[0]?.message ??
          "A rejection reason is required when rejecting payment."
      );
      return;
    }

    verifyMutation.mutate({
      orderId: trimmedOrderId,
      approve: parsed.data.approve,
      reason: parsed.data.reason ?? "",
    });
  };

  // Agency Quota Allocation query & state
  const { data: agencies = [], isLoading: agenciesLoading } = useQuery<
    EventAgencyDTO[]
  >({
    queryKey: ["event-agencies", eventId],
    queryFn: () => apiFetch<EventAgencyDTO[]>(`/v1/events/${eventId}/agencies`),
    enabled: Boolean(eventId),
  });

  const [agencyUserId, setAgencyUserId] = useState("");
  const [agencyTicketTypeId, setAgencyTicketTypeId] = useState("");
  const [agencyQuotaLimit, setAgencyQuotaLimit] = useState("10");
  const [agencyError, setAgencyError] = useState<string | null>(null);
  const [agencySuccess, setAgencySuccess] = useState<string | null>(null);

  const allocateAgencyMutation = useMutation({
    mutationFn: (payload: {
      agency_user_id: string;
      ticket_type_id: string;
      quota_limit: number;
    }) =>
      apiFetch<{
        id: string;
        agency_user_id: string;
        ticket_type_id: string;
        quota_limit: number;
      }>(`/v1/events/${eventId}/agencies`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["event-agencies", eventId] });
      setAgencyUserId("");
      setAgencyTicketTypeId("");
      setAgencyQuotaLimit("10");
      setAgencyError(null);
      setAgencySuccess(
        `Allocated ${created.quota_limit} tickets to agency ${created.agency_user_id}.`
      );
    },
  });

  const handleAllocateAgency = (e: FormEvent) => {
    e.preventDefault();
    setAgencyError(null);
    setAgencySuccess(null);

    const parsed = AllocateAgencyQuotaSchema.safeParse({
      agency_user_id: agencyUserId,
      ticket_type_id: agencyTicketTypeId,
      quota_limit: Number(agencyQuotaLimit),
    });

    if (!parsed.success) {
      setAgencyError(
        parsed.error.issues[0]?.message ?? "Invalid agency allocation input."
      );
      return;
    }

    allocateAgencyMutation.mutate(parsed.data);
  };

  // Team Member Assignment query & state
  const { data: members = [], isLoading: membersLoading } = useQuery<
    EventMemberDTO[]
  >({
    queryKey: ["event-members", eventId],
    queryFn: () => apiFetch<EventMemberDTO[]>(`/v1/events/${eventId}/members`),
    enabled: Boolean(eventId),
  });

  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<TeamRole>("co_organizer");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberSuccess, setMemberSuccess] = useState<string | null>(null);

  const assignMemberMutation = useMutation({
    mutationFn: (payload: { email: string; role: TeamRole }) =>
      apiFetch<{ status: string }>(`/v1/events/${eventId}/members`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["event-members", eventId] });
      setMemberEmail("");
      setMemberError(null);
      setMemberSuccess(`Assigned ${vars.email} as ${vars.role}.`);
    },
  });

  const handleAssignMember = (e: FormEvent) => {
    e.preventDefault();
    setMemberError(null);
    setMemberSuccess(null);

    const trimmedEmail = memberEmail.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setMemberError("Valid member email is required.");
      return;
    }

    assignMemberMutation.mutate({ email: trimmedEmail, role: memberRole });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/organizer"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            &larr; Back to Organizer Studio
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">
            {event ? event.title : `Manage Event (${eventId})`}
          </h1>
          {event && (
            <p className="text-sm text-gray-600">
              {event.venue} &middot; /{event.slug}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {eventId && (
            <Link
              to={`/events/${eventId}/checkin`}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Check-in Terminal
            </Link>
          )}
          {event?.slug && (
            <Link
              to={`/events/${event.slug}`}
              className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
            >
              View Public Page &rarr;
            </Link>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex flex-wrap gap-4" aria-label="Tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab 1: Sessions */}
      {activeTab === "sessions" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">Add Session</h2>
            {(sessError || addSessionMutation.error) && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {sessError ??
                  getErrorMessage(
                    addSessionMutation.error,
                    "Failed to add session"
                  )}
              </div>
            )}
            {sessSuccess && (
              <div
                role="status"
                className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              >
                {sessSuccess}
              </div>
            )}
            <form
              noValidate
              onSubmit={handleAddSession}
              className="mt-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="sess-title"
                  className="block text-sm font-medium text-gray-700"
                >
                  Session Title
                </label>
                <input
                  id="sess-title"
                  type="text"
                  value={sessTitle}
                  onChange={(e) => setSessTitle(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="sess-speaker"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Speaker Name
                  </label>
                  <input
                    id="sess-speaker"
                    type="text"
                    value={speakerName}
                    onChange={(e) => setSpeakerName(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="sess-room"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Room / Stage
                  </label>
                  <input
                    id="sess-room"
                    type="text"
                    value={roomOrStage}
                    onChange={(e) => setRoomOrStage(e.target.value)}
                    placeholder="e.g. Main Stage"
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="sess-bio"
                  className="block text-sm font-medium text-gray-700"
                >
                  Speaker Bio
                </label>
                <textarea
                  id="sess-bio"
                  rows={2}
                  value={speakerBio}
                  onChange={(e) => setSpeakerBio(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="sess-start"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Start Time
                  </label>
                  <input
                    id="sess-start"
                    type="datetime-local"
                    value={sessStart}
                    onChange={(e) => setSessStart(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="sess-end"
                    className="block text-sm font-medium text-gray-700"
                  >
                    End Time
                  </label>
                  <input
                    id="sess-end"
                    type="datetime-local"
                    value={sessEnd}
                    onChange={(e) => setSessEnd(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={addSessionMutation.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {addSessionMutation.isPending ? "Saving..." : "Add Session"}
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">
              Scheduled Sessions
            </h2>
            {sessionsLoading ? (
              <p className="mt-4 text-sm text-gray-500">Loading sessions...</p>
            ) : sessions.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">
                No sessions scheduled yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-gray-200">
                {sessions.map((s) => (
                  <li key={s.id} className="py-3">
                    <p className="font-medium text-gray-900">{s.title}</p>
                    <p className="text-sm text-gray-600">
                      {s.speaker_name}
                      {s.room_or_stage ? ` · ${s.room_or_stage}` : ""}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(s.start_at).toLocaleString()} &ndash;{" "}
                      {new Date(s.end_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Posts / Announcements */}
      {activeTab === "posts" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">
              Publish Announcement
            </h2>
            {(postError || publishPostMutation.error) && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {postError ??
                  getErrorMessage(
                    publishPostMutation.error,
                    "Failed to publish post"
                  )}
              </div>
            )}
            {postSuccess && (
              <div
                role="status"
                className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              >
                {postSuccess}
              </div>
            )}
            <form
              noValidate
              onSubmit={handlePublishPost}
              className="mt-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="post-title"
                  className="block text-sm font-medium text-gray-700"
                >
                  Title
                </label>
                <input
                  id="post-title"
                  type="text"
                  value={postTitle}
                  onChange={(e) => setPostTitle(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="post-body"
                  className="block text-sm font-medium text-gray-700"
                >
                  Message Body
                </label>
                <textarea
                  id="post-body"
                  rows={4}
                  value={postBody}
                  onChange={(e) => setPostBody(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={notifyPush}
                  onChange={(e) => setNotifyPush(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                />
                Send Expo Push Notification to attendees
              </label>
              <button
                type="submit"
                disabled={publishPostMutation.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {publishPostMutation.isPending
                  ? "Publishing..."
                  : "Publish Post"}
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">
              Published Posts
            </h2>
            {postsLoading ? (
              <p className="mt-4 text-sm text-gray-500">Loading posts...</p>
            ) : posts.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">
                No announcements published yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-gray-200">
                {posts.map((p) => (
                  <li key={p.id} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-gray-900">{p.title}</p>
                      {p.notify_push && (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                          Push Sent
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-600 whitespace-pre-line">
                      {p.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Ticket Types */}
      {activeTab === "tickets" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">
              Create Ticket Type
            </h2>
            {(ttError || createTicketTypeMutation.error) && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {ttError ??
                  getErrorMessage(
                    createTicketTypeMutation.error,
                    "Failed to create ticket type"
                  )}
              </div>
            )}
            {ttSuccess && (
              <div
                role="status"
                className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              >
                {ttSuccess}
              </div>
            )}
            <form
              noValidate
              onSubmit={handleCreateTicketType}
              className="mt-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="tt-name"
                  className="block text-sm font-medium text-gray-700"
                >
                  Ticket Name
                </label>
                <input
                  id="tt-name"
                  type="text"
                  value={ttName}
                  onChange={(e) => setTtName(e.target.value)}
                  placeholder="e.g. Early Bird, VIP Pass"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="tt-price"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Price
                  </label>
                  <input
                    id="tt-price"
                    type="number"
                    min="0"
                    value={ttPrice}
                    onChange={(e) => setTtPrice(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="tt-currency"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Currency
                  </label>
                  <input
                    id="tt-currency"
                    type="text"
                    value={ttCurrency}
                    onChange={(e) => setTtCurrency(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="tt-quota"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Quota
                  </label>
                  <input
                    id="tt-quota"
                    type="number"
                    min="1"
                    value={ttQuota}
                    onChange={(e) => setTtQuota(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    required
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="tt-sales-end"
                  className="block text-sm font-medium text-gray-700"
                >
                  Sales End Date &amp; Time
                </label>
                <input
                  id="tt-sales-end"
                  type="datetime-local"
                  value={ttSalesEnd}
                  onChange={(e) => setTtSalesEnd(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={ttRequiresCfp}
                  onChange={(e) => setTtRequiresCfp(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                />
                Requires Accepted CFP Submission
              </label>
              <button
                type="submit"
                disabled={createTicketTypeMutation.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {createTicketTypeMutation.isPending
                  ? "Creating..."
                  : "Create Ticket Type"}
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">
              Ticket Types
            </h2>
            {ticketTypesLoading ? (
              <p className="mt-4 text-sm text-gray-500">
                Loading ticket types...
              </p>
            ) : ticketTypes.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">
                No ticket types created yet. Ticket types you create here will
                appear with their IDs for agency quota allocation.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-gray-200">
                {ticketTypes.map((tt) => (
                  <li key={tt.id} className="py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900">
                        {tt.name}
                      </span>
                      <span className="font-semibold text-indigo-600">
                        {tt.price === 0
                          ? "Free"
                          : `${tt.currency} ${tt.price.toLocaleString()}`}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      ID: <code className="font-mono">{tt.id}</code> &middot;
                      Quota: {tt.quota}
                      {typeof tt.sold_count === "number"
                        ? ` · Sold: ${tt.sold_count}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Manual Transfer Verification */}
      {activeTab === "verification" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">
              Verify Manual Bank Transfer
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Approve or reject a pending manual transfer order. A reason is
              required when rejecting.
            </p>

            {(verifyError || verifyMutation.error) && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {verifyError ??
                  getErrorMessage(
                    verifyMutation.error,
                    "Verification request failed"
                  )}
              </div>
            )}

            {verifySuccess && (
              <div
                role="status"
                className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
              >
                {verifySuccess}
              </div>
            )}

            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="verify-order-id"
                  className="block text-sm font-medium text-gray-700"
                >
                  Order ID
                </label>
                <input
                  id="verify-order-id"
                  type="text"
                  value={verifyOrderId}
                  onChange={(e) => setVerifyOrderId(e.target.value)}
                  placeholder="e.g. ord-..."
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label
                  htmlFor="verify-reason"
                  className="block text-sm font-medium text-gray-700"
                >
                  Notes / Rejection Reason
                </label>
                <textarea
                  id="verify-reason"
                  rows={3}
                  value={verifyReason}
                  onChange={(e) => setVerifyReason(e.target.value)}
                  placeholder="Required when rejecting (e.g. Proof amount does not match)"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={verifyMutation.isPending}
                  onClick={() => handleVerifyOrder(true)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  Approve Payment
                </button>
                <button
                  type="button"
                  disabled={verifyMutation.isPending}
                  onClick={() => handleVerifyOrder(false)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  Reject Payment
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">
              Pending Verification &amp; Orders
            </h2>
            {ordersLoading ? (
              <p className="mt-4 text-sm text-gray-500">Loading orders...</p>
            ) : orders.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">
                No orders placed for this event yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-gray-200 text-sm">
                {orders.map((ord) => {
                  const isPendingVerification =
                    ord.payment_status === "pending_verification";
                  const proofHref = ord.proof_file_url
                    ? ord.proof_file_url.startsWith("/v1/uploads/")
                      ? `${API_BASE_URL.replace(/\/+$/, "")}${ord.proof_file_url}`
                      : ord.proof_file_url
                    : null;

                  return (
                    <li key={ord.id} className="py-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium text-gray-900">
                            {ord.buyer_email}
                          </p>
                          <p className="text-xs text-gray-500">
                            ID: <code className="font-mono">{ord.id}</code>{" "}
                            &middot; {ord.payment_method} &middot; IDR{" "}
                            {ord.total_amount.toLocaleString("id-ID")}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            ord.payment_status === "paid"
                              ? "bg-emerald-50 text-emerald-700"
                              : ord.payment_status === "pending_verification"
                                ? "bg-amber-50 text-amber-700"
                                : ord.payment_status === "rejected"
                                  ? "bg-red-50 text-red-700"
                                  : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {ord.payment_status}
                        </span>
                      </div>

                      {isPendingVerification && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          {proofHref ? (
                            <a
                              href={proofHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-medium text-indigo-600 underline hover:text-indigo-500"
                            >
                              View Payment Proof &rarr;
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400">
                              No proof URL attached
                            </span>
                          )}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={verifyMutation.isPending}
                              onClick={() =>
                                verifyMutation.mutate({
                                  orderId: ord.id,
                                  approve: true,
                                  reason: "",
                                })
                              }
                              className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={verifyMutation.isPending}
                              onClick={() => {
                                setVerifyOrderId(ord.id);
                                if (verifyReason.trim()) {
                                  verifyMutation.mutate({
                                    orderId: ord.id,
                                    approve: false,
                                    reason: verifyReason.trim(),
                                  });
                                } else {
                                  setVerifyError(
                                    "Please enter a rejection reason before rejecting."
                                  );
                                }
                              }}
                              className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Agencies */}
      {activeTab === "agencies" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">
              Allocate Agency Quota
            </h2>
            {(agencyError || allocateAgencyMutation.error) && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {agencyError ??
                  getErrorMessage(
                    allocateAgencyMutation.error,
                    "Failed to allocate agency quota"
                  )}
              </div>
            )}
            {agencySuccess && (
              <div
                role="status"
                className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              >
                {agencySuccess}
              </div>
            )}
            <form
              noValidate
              onSubmit={handleAllocateAgency}
              className="mt-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="agency-user-id"
                  className="block text-sm font-medium text-gray-700"
                >
                  Agency User ID
                </label>
                <input
                  id="agency-user-id"
                  type="text"
                  value={agencyUserId}
                  onChange={(e) => setAgencyUserId(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="agency-ticket-type-id"
                  className="block text-sm font-medium text-gray-700"
                >
                  Ticket Type ID
                </label>
                <input
                  id="agency-ticket-type-id"
                  type="text"
                  value={agencyTicketTypeId}
                  onChange={(e) => setAgencyTicketTypeId(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="agency-quota-limit"
                  className="block text-sm font-medium text-gray-700"
                >
                  Quota Limit
                </label>
                <input
                  id="agency-quota-limit"
                  type="number"
                  min="1"
                  value={agencyQuotaLimit}
                  onChange={(e) => setAgencyQuotaLimit(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={allocateAgencyMutation.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {allocateAgencyMutation.isPending
                  ? "Allocating..."
                  : "Allocate Quota"}
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">
              Allocated Agency Quotas
            </h2>
            {agenciesLoading ? (
              <p className="mt-4 text-sm text-gray-500">
                Loading agency quotas...
              </p>
            ) : agencies.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">
                No agency quotas allocated yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-gray-200 text-sm">
                {agencies.map((ag) => (
                  <li key={ag.id} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-gray-900">
                        {ag.agency_name || ag.agency_id}
                      </p>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {ag.status}
                      </span>
                    </div>
                    {ag.agency_email && (
                      <p className="text-xs text-gray-500">{ag.agency_email}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-500">
                      Ticket Type: <code className="font-mono">{ag.ticket_type_id}</code>{" "}
                      &middot; Allocated: {ag.allocated_quota} &middot; Issued:{" "}
                      {ag.issued_count}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Tab 6: Team Members */}
      {activeTab === "members" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">
              Assign Team Member
            </h2>
            {(memberError || assignMemberMutation.error) && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {memberError ??
                  getErrorMessage(
                    assignMemberMutation.error,
                    "Failed to assign team member"
                  )}
              </div>
            )}
            {memberSuccess && (
              <div
                role="status"
                className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
              >
                {memberSuccess}
              </div>
            )}
            <form
              noValidate
              onSubmit={handleAssignMember}
              className="mt-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="member-email"
                  className="block text-sm font-medium text-gray-700"
                >
                  User Email
                </label>
                <input
                  id="member-email"
                  type="email"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  placeholder="staff@example.com"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="member-role"
                  className="block text-sm font-medium text-gray-700"
                >
                  Role
                </label>
                <select
                  id="member-role"
                  value={memberRole}
                  onChange={(e) => setMemberRole(e.target.value as TeamRole)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="co_organizer">Co-Organizer</option>
                  <option value="reviewer">CFP Reviewer</option>
                  <option value="checkin_staff">Check-in Staff</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={assignMemberMutation.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {assignMemberMutation.isPending
                  ? "Assigning..."
                  : "Assign Member"}
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-semibold text-gray-900">
              Team Members
            </h2>
            {membersLoading ? (
              <p className="mt-4 text-sm text-gray-500">
                Loading team members...
              </p>
            ) : members.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">
                No team members assigned yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-gray-200 text-sm">
                {members.map((m) => (
                  <li
                    key={m.user_id}
                    className="flex items-center justify-between py-3"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{m.name}</p>
                      <p className="text-xs text-gray-500">{m.email}</p>
                    </div>
                    <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                      {m.role}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
