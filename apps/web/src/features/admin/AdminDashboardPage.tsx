import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ProcessPayoutSchema,
  UpdateCommissionSchema,
  type AdminEventDTO,
  type AdminOverviewDTO,
  type AdminPayoutRequestDTO,
  type AuditEventDTO,
  type CommissionRateDTO,
  type ProcessPayoutInput,
  type UserDTO,
} from "@beo/contracts";
import { apiFetch, ApiError } from "../../lib/api";

type AdminTab = "overview" | "payouts" | "commissions" | "events-users" | "audit";

const TABS: { id: AdminTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "payouts", label: "Payout Requests" },
  { id: "commissions", label: "Commission Rates" },
  { id: "events-users", label: "Events & Users" },
  { id: "audit", label: "Audit Logs" },
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  community: "Community",
  seminar_workshop: "Seminar / Workshop",
  conference: "Conference",
  meetup_ted: "Meetup / TED",
};

function formatIDR(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const styles: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-blue-100 text-blue-800",
    paid: "bg-emerald-100 text-emerald-800",
    published: "bg-emerald-100 text-emerald-800",
    rejected: "bg-red-100 text-red-800",
    cancelled: "bg-red-100 text-red-800",
    draft: "bg-gray-100 text-gray-700",
    platform_admin: "bg-purple-100 text-purple-800",
    agency: "bg-indigo-100 text-indigo-800",
    standard: "bg-gray-100 text-gray-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
        styles[normalized] ?? "bg-gray-100 text-gray-700"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function AdminDashboardPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [payoutNotes, setPayoutNotes] = useState<Record<string, string>>({});
  const [draftRates, setDraftRates] = useState<Record<string, string>>({});

  // --- Queries ---
  const overviewQuery = useQuery<AdminOverviewDTO>({
    queryKey: ["admin", "overview"],
    queryFn: () => apiFetch<AdminOverviewDTO>("/v1/admin/overview"),
    enabled: activeTab === "overview",
  });

  const payoutsQuery = useQuery<AdminPayoutRequestDTO[]>({
    queryKey: ["admin", "payouts"],
    queryFn: () => apiFetch<AdminPayoutRequestDTO[]>("/v1/admin/payouts"),
    enabled: activeTab === "payouts",
  });

  const commissionsQuery = useQuery<CommissionRateDTO[]>({
    queryKey: ["admin", "commissions"],
    queryFn: () => apiFetch<CommissionRateDTO[]>("/v1/admin/commissions"),
    enabled: activeTab === "commissions",
  });

  const eventsQuery = useQuery<AdminEventDTO[]>({
    queryKey: ["admin", "events"],
    queryFn: () => apiFetch<AdminEventDTO[]>("/v1/admin/events"),
    enabled: activeTab === "events-users",
  });

  const usersQuery = useQuery<UserDTO[]>({
    queryKey: ["admin", "users"],
    queryFn: () => apiFetch<UserDTO[]>("/v1/admin/users"),
    enabled: activeTab === "events-users",
  });

  const auditQuery = useQuery<AuditEventDTO[]>({
    queryKey: ["admin", "audit-events"],
    queryFn: () => apiFetch<AuditEventDTO[]>("/v1/admin/audit-events"),
    enabled: activeTab === "audit",
  });

  // --- Mutations ---
  const processPayoutMutation = useMutation({
    mutationFn: ({
      payoutId,
      payload,
    }: {
      payoutId: string;
      payload: ProcessPayoutInput;
    }) =>
      apiFetch<AdminPayoutRequestDTO>(`/v1/admin/payouts/${payoutId}/process`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "payouts"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
      setFeedback({
        type: "success",
        message: `Payout ${updated.id} updated to ${updated.status}.`,
      });
    },
    onError: (err) => {
      setFeedback({ type: "error", message: getErrorMessage(err) });
    },
  });

  const updateCommissionMutation = useMutation({
    mutationFn: ({
      eventType,
      ratePercent,
    }: {
      eventType: string;
      ratePercent: number;
    }) =>
      apiFetch<CommissionRateDTO>(`/v1/admin/commissions/${eventType}`, {
        method: "PUT",
        body: JSON.stringify({ rate_percent: ratePercent }),
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "commissions"] });
      setDraftRates((prev) => ({
        ...prev,
        [updated.event_type]: String(updated.rate_percent),
      }));
      setFeedback({
        type: "success",
        message: `Commission rate for ${
          EVENT_TYPE_LABELS[updated.event_type] ?? updated.event_type
        } saved (${updated.rate_percent}%).`,
      });
    },
    onError: (err) => {
      setFeedback({ type: "error", message: getErrorMessage(err) });
    },
  });

  const handlePayoutAction = (
    payoutId: string,
    action: ProcessPayoutInput["action"]
  ) => {
    setFeedback(null);
    const rawNote = payoutNotes[payoutId]?.trim();
    const parsed = ProcessPayoutSchema.safeParse({
      action,
      ...(rawNote ? { note: rawNote } : {}),
    });

    if (!parsed.success) {
      setFeedback({
        type: "error",
        message: parsed.error.issues[0]?.message ?? "Invalid payout action.",
      });
      return;
    }

    processPayoutMutation.mutate({ payoutId, payload: parsed.data });
  };

  const handleSaveCommission = (rate: CommissionRateDTO) => {
    setFeedback(null);
    const rawValue = draftRates[rate.event_type] ?? String(rate.rate_percent);
    const numValue = Number(rawValue);

    const parsed = UpdateCommissionSchema.safeParse({ rate_percent: numValue });
    if (!parsed.success) {
      setFeedback({
        type: "error",
        message:
          parsed.error.issues[0]?.message ??
          "Commission rate must be between 0 and 100.",
      });
      return;
    }

    updateCommissionMutation.mutate({
      eventType: String(rate.event_type),
      ratePercent: parsed.data.rate_percent,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Platform Admin
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Monitor platform metrics, process organizer payouts, configure
            commission rates, and inspect audit logs.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav
          role="tablist"
          aria-label="Admin sections"
          className="-mb-px flex flex-wrap gap-6"
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setActiveTab(tab.id);
                  setFeedback(null);
                }}
                className={`whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {feedback && (
        <div
          role={feedback.type === "error" ? "alert" : "status"}
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.type === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <section aria-label="Platform Overview" className="space-y-4">
          {overviewQuery.isLoading && (
            <p className="text-sm text-gray-500">Loading platform metrics...</p>
          )}
          {overviewQuery.error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {getErrorMessage(overviewQuery.error)}
            </div>
          )}
          {overviewQuery.data && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  label: "Total Users",
                  value: overviewQuery.data.total_users.toLocaleString(),
                },
                {
                  label: "Total Events",
                  value: overviewQuery.data.total_events.toLocaleString(),
                },
                {
                  label: "Paid Orders",
                  value: overviewQuery.data.paid_orders.toLocaleString(),
                },
                {
                  label: "Gross Revenue",
                  value: formatIDR(overviewQuery.data.gross_revenue),
                },
                {
                  label: "Platform Commission",
                  value: formatIDR(overviewQuery.data.total_commission),
                },
                {
                  label: "Pending Payouts",
                  value: overviewQuery.data.pending_payouts.toLocaleString(),
                },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-xl border border-gray-200 bg-white p-5 shadow-2xs"
                >
                  <p className="text-sm font-medium text-gray-500">
                    {card.label}
                  </p>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-gray-900">
                    {card.value}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Payout Requests Tab */}
      {activeTab === "payouts" && (
        <section aria-label="Payout Requests" className="space-y-4">
          {payoutsQuery.isLoading && (
            <p className="text-sm text-gray-500">Loading payout requests...</p>
          )}
          {payoutsQuery.error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {getErrorMessage(payoutsQuery.error)}
            </div>
          )}
          {payoutsQuery.data && payoutsQuery.data.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              No payout requests found.
            </div>
          )}
          {payoutsQuery.data && payoutsQuery.data.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-2xs">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Organizer</th>
                    <th className="px-4 py-3">Bank Details</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Note & Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payoutsQuery.data.map((payout) => {
                    const isPending = payout.status === "pending";
                    const isApproved = payout.status === "approved";
                    const canAct = isPending || isApproved;

                    return (
                      <tr key={payout.id} className="align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">
                            {payout.organizer_name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {payout.organizer_email}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          <div className="font-medium">{payout.bank_name}</div>
                          <div className="text-xs text-gray-500">
                            {payout.bank_account_number} ·{" "}
                            {payout.bank_account_name}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">
                          {formatIDR(payout.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={payout.status} />
                        </td>
                        <td className="px-4 py-3">
                          {canAct ? (
                            <div className="flex flex-col gap-2">
                              <input
                                type="text"
                                aria-label={`Note for ${payout.organizer_name} payout`}
                                placeholder="Optional note..."
                                value={payoutNotes[payout.id] ?? ""}
                                onChange={(e) =>
                                  setPayoutNotes((prev) => ({
                                    ...prev,
                                    [payout.id]: e.target.value,
                                  }))
                                }
                                className="w-full min-w-44 rounded-lg border border-gray-300 px-2.5 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                              <div className="flex flex-wrap gap-2">
                                {isPending && (
                                  <button
                                    type="button"
                                    disabled={processPayoutMutation.isPending}
                                    onClick={() =>
                                      handlePayoutAction(payout.id, "approve")
                                    }
                                    className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                                  >
                                    Approve
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={processPayoutMutation.isPending}
                                  onClick={() =>
                                    handlePayoutAction(payout.id, "complete")
                                  }
                                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                                >
                                  Mark Paid
                                </button>
                                <button
                                  type="button"
                                  disabled={processPayoutMutation.isPending}
                                  onClick={() =>
                                    handlePayoutAction(payout.id, "reject")
                                  }
                                  className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">
                              Processed
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Commission Rates Tab */}
      {activeTab === "commissions" && (
        <section aria-label="Commission Rates" className="space-y-4">
          {commissionsQuery.isLoading && (
            <p className="text-sm text-gray-500">Loading commission rates...</p>
          )}
          {commissionsQuery.error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {getErrorMessage(commissionsQuery.error)}
            </div>
          )}
          {commissionsQuery.data && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {commissionsQuery.data.map((rate) => {
                const value =
                  draftRates[rate.event_type] ?? String(rate.rate_percent);
                const label =
                  EVENT_TYPE_LABELS[rate.event_type] ?? rate.event_type;

                return (
                  <div
                    key={rate.event_type}
                    className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-2xs"
                  >
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">
                        {label}
                      </h3>
                      <p className="text-xs text-gray-500">
                        Category:{" "}
                        <code className="rounded bg-gray-100 px-1 py-0.5">
                          {rate.event_type}
                        </code>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        aria-label={`Commission rate for ${rate.event_type}`}
                        value={value}
                        onChange={(e) =>
                          setDraftRates((prev) => ({
                            ...prev,
                            [rate.event_type]: e.target.value,
                          }))
                        }
                        className="w-24 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-right focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <span className="text-sm text-gray-500">%</span>
                      <button
                        type="button"
                        disabled={updateCommissionMutation.isPending}
                        onClick={() => handleSaveCommission(rate)}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Events & Users Tab */}
      {activeTab === "events-users" && (
        <section aria-label="Events and Users" className="space-y-8">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">All Events</h2>
            {eventsQuery.isLoading && (
              <p className="text-sm text-gray-500">Loading events...</p>
            )}
            {eventsQuery.error && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
              >
                {getErrorMessage(eventsQuery.error)}
              </div>
            )}
            {eventsQuery.data && (
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-2xs">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-4 py-3">Event</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Organizer</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Starts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {eventsQuery.data.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-6 text-center text-gray-500"
                        >
                          No events found.
                        </td>
                      </tr>
                    ) : (
                      eventsQuery.data.map((event) => (
                        <tr key={event.id}>
                          <td className="px-4 py-3 font-medium">
                            <Link
                              to={`/events/${event.slug}`}
                              className="text-indigo-600 hover:text-indigo-500 hover:underline"
                            >
                              {event.title}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {EVENT_TYPE_LABELS[event.event_type] ??
                              event.event_type}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-gray-900">
                              {event.organizer_name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {event.organizer_email}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={event.status} />
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {formatDateTime(event.start_at)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">All Users</h2>
            {usersQuery.isLoading && (
              <p className="text-sm text-gray-500">Loading users...</p>
            )}
            {usersQuery.error && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
              >
                {getErrorMessage(usersQuery.error)}
              </div>
            )}
            {usersQuery.data && (
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-2xs">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Account Type</th>
                      <th className="px-4 py-3">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {usersQuery.data.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-4 py-6 text-center text-gray-500"
                        >
                          No users found.
                        </td>
                      </tr>
                    ) : (
                      usersQuery.data.map((u) => (
                        <tr key={u.id}>
                          <td className="px-4 py-3 font-medium text-gray-900">
                            {u.name}
                          </td>
                          <td className="px-4 py-3 text-gray-600">{u.email}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={u.account_type} />
                          </td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                            {formatDateTime(u.created_at)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Audit Logs Tab */}
      {activeTab === "audit" && (
        <section aria-label="Audit Logs" className="space-y-4">
          {auditQuery.isLoading && (
            <p className="text-sm text-gray-500">Loading audit logs...</p>
          )}
          {auditQuery.error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {getErrorMessage(auditQuery.error)}
            </div>
          )}
          {auditQuery.data && auditQuery.data.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              No audit events recorded.
            </div>
          )}
          {auditQuery.data && auditQuery.data.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-2xs">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Event Type</th>
                    <th className="px-4 py-3">IP Address</th>
                    <th className="px-4 py-3">Metadata</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditQuery.data.map((evt) => (
                    <tr key={evt.id} className="align-top">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {formatDateTime(evt.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-800">
                          {evt.event_type}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {evt.ip_address || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {evt.metadata ? (
                          <pre className="max-w-md overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-700">
                            {JSON.stringify(evt.metadata)}
                          </pre>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default AdminDashboardPage;
