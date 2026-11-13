import { useState, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type CFPSubmissionDTO,
  type CFPSubmissionInput,
  type CFPReviewInput,
  CFPSubmissionInputSchema,
  CFPReviewInputSchema,
} from "@beo/contracts";
import { apiFetch, ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import {
  FileText,
  Send,
  UserCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  ShieldAlert,
  Star,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export function CFPPortalPage() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Submission Form State
  const [track, setTrack] = useState("");
  const [title, setTitle] = useState("");
  const [abstractText, setAbstractText] = useState("");
  const [fileUrl, setFileUrl] = useState("");

  // Review Form State per submission
  const [activeReviewSubId, setActiveReviewSubId] = useState<string | null>(null);
  const [score, setScore] = useState<number>(8);
  const [comments, setComments] = useState("");
  const [recommendation, setRecommendation] = useState("Accept");

  // Assign Reviewer State per submission
  const [reviewerIdMap, setReviewerIdMap] = useState<Record<string, string>>({});

  // Action error & success alerts
  const [actionError, setActionError] = useState<{
    submissionId?: string;
    message: string;
    isForbidden?: boolean;
  } | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // 1. Fetch Submissions
  const {
    data: submissions = [],
    isLoading,
    error: fetchError,
  } = useQuery<CFPSubmissionDTO[], Error | ApiError>({
    queryKey: ["cfp-submissions", eventId],
    queryFn: () =>
      apiFetch<CFPSubmissionDTO[]>(
        `/v1/events/${encodeURIComponent(eventId)}/cfp/submissions`
      ),
    enabled: Boolean(eventId),
  });

  // 2. Submit Paper Mutation
  const submitPaperMutation = useMutation({
    mutationFn: async (data: CFPSubmissionInput) => {
      return apiFetch<CFPSubmissionDTO>(
        `/v1/events/${encodeURIComponent(eventId)}/cfp/submissions`,
        {
          method: "POST",
          body: JSON.stringify(data),
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cfp-submissions", eventId] });
      setTrack("");
      setTitle("");
      setAbstractText("");
      setFileUrl("");
      setActionSuccess("Paper proposal submitted successfully!");
      setActionError(null);
    },
    onError: (err: unknown) => {
      const is403 = err instanceof ApiError && err.status === 403;
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to submit paper";
      setActionError({
        message: is403 ? `403 Forbidden: ${msg}` : msg,
        isForbidden: is403,
      });
      setActionSuccess(null);
    },
  });

  // 3. Assign Reviewer Mutation
  const assignReviewerMutation = useMutation({
    mutationFn: async ({
      submissionId,
      reviewerId,
    }: {
      submissionId: string;
      reviewerId: string;
    }) => {
      return apiFetch<{ status: string }>(
        `/v1/events/${encodeURIComponent(eventId)}/cfp/submissions/${encodeURIComponent(
          submissionId
        )}/assign`,
        {
          method: "POST",
          body: JSON.stringify({ reviewer_id: reviewerId }),
        }
      );
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["cfp-submissions", eventId] });
      setActionSuccess("Reviewer successfully assigned!");
      setActionError(null);
      setReviewerIdMap((prev) => ({ ...prev, [vars.submissionId]: "" }));
    },
    onError: (err: unknown, vars) => {
      const is403 = err instanceof ApiError && err.status === 403;
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to assign reviewer";
      setActionError({
        submissionId: vars.submissionId,
        message: is403
          ? `403 Forbidden: You do not have permission to assign reviewers for this event.`
          : msg,
        isForbidden: is403,
      });
      setActionSuccess(null);
    },
  });

  // 4. Submit Review Mutation
  const submitReviewMutation = useMutation({
    mutationFn: async ({
      submissionId,
      review,
    }: {
      submissionId: string;
      review: CFPReviewInput;
    }) => {
      return apiFetch<{ status: string }>(
        `/v1/cfp/submissions/${encodeURIComponent(submissionId)}/reviews`,
        {
          method: "POST",
          body: JSON.stringify(review),
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cfp-submissions", eventId] });
      setActionSuccess("Review score and feedback recorded successfully!");
      setActionError(null);
      setActiveReviewSubId(null);
      setComments("");
    },
    onError: (err: unknown, vars) => {
      const is403 = err instanceof ApiError && err.status === 403;
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to submit review";
      setActionError({
        submissionId: vars.submissionId,
        message: is403
          ? `403 Forbidden: You are not assigned as a reviewer for this submission.`
          : msg,
        isForbidden: is403,
      });
      setActionSuccess(null);
    },
  });

  // 5. Decide Submission Mutation
  const decideMutation = useMutation({
    mutationFn: async ({
      submissionId,
      decision,
    }: {
      submissionId: string;
      decision: "accepted" | "rejected" | "revision_required";
    }) => {
      return apiFetch<{ status: string }>(
        `/v1/events/${encodeURIComponent(eventId)}/cfp/submissions/${encodeURIComponent(
          submissionId
        )}/decision`,
        {
          method: "POST",
          body: JSON.stringify({ decision }),
        }
      );
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["cfp-submissions", eventId] });
      setActionSuccess(`Submission marked as ${vars.decision.replace("_", " ")}!`);
      setActionError(null);
    },
    onError: (err: unknown, vars) => {
      const is403 = err instanceof ApiError && err.status === 403;
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to record decision";
      setActionError({
        submissionId: vars.submissionId,
        message: is403
          ? `403 Forbidden: You do not have permission to decide submissions for this event.`
          : msg,
        isForbidden: is403,
      });
      setActionSuccess(null);
    },
  });

  const handlePaperSubmit = (e: FormEvent) => {
    e.preventDefault();
    setActionError(null);

    const validation = CFPSubmissionInputSchema.safeParse({
      track,
      title,
      abstract: abstractText,
      file_url: fileUrl,
    });

    if (!validation.success) {
      setActionError({
        message: validation.error.errors[0]?.message || "Validation failed",
      });
      return;
    }

    submitPaperMutation.mutate(validation.data);
  };

  const handleReviewSubmit = (e: FormEvent, submissionId: string) => {
    e.preventDefault();
    setActionError(null);

    const validation = CFPReviewInputSchema.safeParse({
      score: Number(score),
      comments,
      recommendation,
    });

    if (!validation.success) {
      setActionError({
        submissionId,
        message: validation.error.errors[0]?.message || "Invalid review inputs",
      });
      return;
    }

    submitReviewMutation.mutate({
      submissionId,
      review: validation.data,
    });
  };

  const handleAssignReviewer = (submissionId: string) => {
    const revId = reviewerIdMap[submissionId]?.trim();
    if (!revId) {
      setActionError({
        submissionId,
        message: "Please enter a valid Reviewer User ID",
      });
      return;
    }
    assignReviewerMutation.mutate({ submissionId, reviewerId: revId });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "accepted":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
            <CheckCircle2 className="h-3 w-3" /> Accepted
          </span>
        );
      case "rejected":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-600/20">
            <XCircle className="h-3 w-3" /> Rejected
          </span>
        );
      case "revision_required":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-600/20">
            <AlertTriangle className="h-3 w-3" /> Revision Required
          </span>
        );
      case "under_review":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-600/20">
            <UserCheck className="h-3 w-3" /> Under Review
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2.5 py-0.5 text-xs font-semibold text-gray-700 ring-1 ring-gray-600/20">
            Submitted
          </span>
        );
    }
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="border-b border-gray-200 pb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              Conference CFP Portal
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Event ID: <span className="font-mono text-gray-700">{eventId}</span> | Logged in as:{" "}
              <span className="font-semibold text-gray-700">{user?.name || user?.email}</span>.
            </p>
          </div>
        </div>

        <Link
          to={`/events/${eventId}`}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
        >
          &larr; Back to Event
        </Link>
      </div>

      {/* Global Alerts */}
      {fetchError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-3"
        >
          <ShieldAlert className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">
              {fetchError instanceof ApiError && fetchError.status === 403
                ? "403 Forbidden"
                : "Error loading submissions"}
              :
            </span>{" "}
            {fetchError.message}
          </div>
        </div>
      )}

      {actionError && !actionError.submissionId && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-3"
        >
          <ShieldAlert className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">
              {actionError.isForbidden ? "403 Forbidden" : "Action Failed"}:
            </span>{" "}
            {actionError.message}
          </div>
        </div>
      )}

      {actionSuccess && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Section 1: Author Submission Form */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs">
        <div className="flex items-center gap-2 mb-4">
          <Send className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-bold text-gray-900">
            Submit Paper or Talk Proposal
          </h2>
        </div>

        <form onSubmit={handlePaperSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="cfp-track"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Track
              </label>
              <input
                type="text"
                id="cfp-track"
                value={track}
                onChange={(e) => setTrack(e.target.value)}
                placeholder="e.g. Distributed Systems, AI/ML, Security"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label
                htmlFor="cfp-title"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Paper Title
              </label>
              <input
                type="text"
                id="cfp-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Scalable Raft Consensus in High-Latency Networks"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                required
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="cfp-abstract"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Abstract
            </label>
            <textarea
              id="cfp-abstract"
              rows={3}
              value={abstractText}
              onChange={(e) => setAbstractText(e.target.value)}
              placeholder="Summary of research, key contributions, and methodology..."
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <label
              htmlFor="cfp-file-url"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Paper Document / PDF URL
            </label>
            <input
              type="url"
              id="cfp-file-url"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://example.com/papers/paper.pdf"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              required
            />
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={submitPaperMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50"
            >
              {submitPaperMutation.isPending ? "Submitting..." : "Submit Paper Proposal"}
            </button>
          </div>
        </form>
      </div>

      {/* Section 2: Submissions & Reviews List */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-gray-900">
          Submissions & Review Workflow ({submissions.length})
        </h2>

        {isLoading ? (
          <div className="p-8 text-center text-gray-500">
            Loading CFP submissions...
          </div>
        ) : submissions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500">
            No paper submissions found for this conference yet. Submit a proposal using the form above.
          </div>
        ) : (
          <div className="space-y-4">
            {submissions.map((sub) => {
              const isReviewFormOpen = activeReviewSubId === sub.id;
              const hasSubError = actionError?.submissionId === sub.id;

              return (
                <div
                  key={sub.id}
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-xs space-y-4"
                >
                  {/* Submission Header */}
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700">
                          {sub.track}
                        </span>
                        {getStatusBadge(sub.status)}
                      </div>
                      <h3 className="text-lg font-bold text-gray-900">
                        {sub.title}
                      </h3>
                      <p className="text-xs text-gray-500">
                        Author ID: <span className="font-mono">{sub.author_user_id}</span> | Submitted:{" "}
                        {new Date(sub.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    <a
                      href={sub.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-500 self-start"
                    >
                      View File <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>

                  <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
                    {sub.abstract}
                  </p>

                  {/* Submission-specific Error Alert */}
                  {hasSubError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2"
                    >
                      <ShieldAlert className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                      <span>{actionError.message}</span>
                    </div>
                  )}

                  {/* Action Bar */}
                  <div className="pt-2 border-t border-gray-100 flex flex-wrap items-center justify-between gap-4">
                    {/* Review Scoring Toggle */}
                    <button
                      type="button"
                      onClick={() =>
                        setActiveReviewSubId(isReviewFormOpen ? null : sub.id)
                      }
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-indigo-600"
                    >
                      <Star className="h-4 w-4 text-amber-500" />
                      {isReviewFormOpen ? "Hide Review Form" : "Review Paper (Scoring)"}
                      {isReviewFormOpen ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>

                    {/* Organizer Actions: Decision Controls */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-500 hidden sm:inline">
                        Organizer Decision:
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          decideMutation.mutate({
                            submissionId: sub.id,
                            decision: "accepted",
                          })
                        }
                        disabled={decideMutation.isPending || sub.status === "accepted"}
                        className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          decideMutation.mutate({
                            submissionId: sub.id,
                            decision: "revision_required",
                          })
                        }
                        disabled={
                          decideMutation.isPending || sub.status === "revision_required"
                        }
                        className="rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Revision
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          decideMutation.mutate({
                            submissionId: sub.id,
                            decision: "rejected",
                          })
                        }
                        disabled={decideMutation.isPending || sub.status === "rejected"}
                        className="rounded-md bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20 hover:bg-rose-100 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  {/* Organizer: Assign Reviewer Form */}
                  <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-2">
                    <span className="font-semibold text-gray-700 block">
                      Assign Conference Reviewer
                    </span>
                    <div className="flex items-center gap-2">
                      <label htmlFor={`assign-rev-${sub.id}`} className="sr-only">
                        Reviewer User ID
                      </label>
                      <input
                        type="text"
                        id={`assign-rev-${sub.id}`}
                        aria-label="Reviewer User ID"
                        value={reviewerIdMap[sub.id] || ""}
                        onChange={(e) =>
                          setReviewerIdMap((prev) => ({
                            ...prev,
                            [sub.id]: e.target.value,
                          }))
                        }
                        placeholder="Reviewer User UUID"
                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => handleAssignReviewer(sub.id)}
                        disabled={assignReviewerMutation.isPending}
                        className="rounded-md bg-gray-800 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                      >
                        Assign Reviewer
                      </button>
                    </div>
                  </div>

                  {/* Review Scoring Form (Expanded) */}
                  {isReviewFormOpen && (
                    <div className="border border-amber-200 bg-amber-50/40 rounded-lg p-4 space-y-3 mt-3">
                      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                        <Star className="h-4 w-4 text-amber-600" />
                        Submit Review Score & Comments
                      </h4>

                      <form
                        onSubmit={(e) => handleReviewSubmit(e, sub.id)}
                        className="space-y-3"
                      >
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor={`score-${sub.id}`}
                              className="block text-xs font-medium text-gray-700 mb-1"
                            >
                              Score (1 to 10)
                            </label>
                            <input
                              type="number"
                              id={`score-${sub.id}`}
                              min={1}
                              max={10}
                              value={score}
                              onChange={(e) => setScore(Number(e.target.value))}
                              className="block w-full rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                              required
                            />
                          </div>

                          <div>
                            <label
                              htmlFor={`rec-${sub.id}`}
                              className="block text-xs font-medium text-gray-700 mb-1"
                            >
                              Recommendation
                            </label>
                            <select
                              id={`rec-${sub.id}`}
                              value={recommendation}
                              onChange={(e) => setRecommendation(e.target.value)}
                              className="block w-full rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                            >
                              <option value="Strong Accept">Strong Accept</option>
                              <option value="Accept">Accept</option>
                              <option value="Weak Accept">Weak Accept</option>
                              <option value="Borderline">Borderline</option>
                              <option value="Reject">Reject</option>
                              <option value="Strong Reject">Strong Reject</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label
                            htmlFor={`comments-${sub.id}`}
                            className="block text-xs font-medium text-gray-700 mb-1"
                          >
                            Review Comments
                          </label>
                          <textarea
                            id={`comments-${sub.id}`}
                            rows={2}
                            value={comments}
                            onChange={(e) => setComments(e.target.value)}
                            placeholder="Constructive feedback, technical merits, clarity..."
                            className="block w-full rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                            required
                          />
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setActiveReviewSubId(null)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={submitReviewMutation.isPending}
                            className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                          >
                            {submitReviewMutation.isPending
                              ? "Submitting..."
                              : "Submit Review"}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default CFPPortalPage;
