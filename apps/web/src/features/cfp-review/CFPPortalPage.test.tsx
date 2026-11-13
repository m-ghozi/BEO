import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, ProtectedRoute } from "../auth/AuthContext";
import { CFPPortalPage } from "./CFPPortalPage";

const testUser = {
  id: "usr-rev-01",
  name: "Dr. Reviewer",
  email: "reviewer@example.com",
  account_type: "standard" as const,
  created_at: "2026-11-01T00:00:00Z",
};

const mockSubmissions = [
  {
    id: "sub-100",
    event_id: "evt-conf-01",
    author_user_id: "usr-author-01",
    track: "Distributed Systems",
    title: "Fault Tolerant Raft on Edge Nodes",
    abstract: "We evaluate Raft consensus under intermittent connectivity.",
    file_url: "https://example.com/raft-paper.pdf",
    status: "submitted",
    created_at: "2026-11-13T01:00:00Z",
    updated_at: "2026-11-13T01:00:00Z",
  },
];

function renderCFPPortal(eventId = "evt-conf-01") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/events/${eventId}/cfp`]}>
          <Routes>
            <Route
              path="/events/:eventId/cfp"
              element={
                <ProtectedRoute>
                  <CFPPortalPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("CFPPortalPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("beo_token", "fake-token");
    localStorage.setItem("beo_user", JSON.stringify(testUser));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders submissions and allows author to submit a paper proposal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Initial GET submissions
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockSubmissions), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    // POST submit paper
    const createdSub = {
      id: "sub-101",
      event_id: "evt-conf-01",
      author_user_id: "usr-rev-01",
      track: "Security",
      title: "Zero-Knowledge Rollups for Auditing",
      abstract: "Detailed ZK audit log design.",
      file_url: "https://example.com/zk-paper.pdf",
      status: "submitted",
      created_at: "2026-11-13T02:00:00Z",
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(createdSub), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    // Invalidation refetch
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([...mockSubmissions, createdSub]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    renderCFPPortal("evt-conf-01");

    expect(
      await screen.findByRole("heading", { name: /Conference CFP Portal/i })
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Fault Tolerant Raft on Edge Nodes")
    ).toBeInTheDocument();

    // Fill Paper Submission Form
    fireEvent.change(screen.getByLabelText(/Track/i), {
      target: { value: "Security" },
    });
    fireEvent.change(screen.getByLabelText(/Paper Title/i), {
      target: { value: "Zero-Knowledge Rollups for Auditing" },
    });
    fireEvent.change(screen.getByLabelText(/Abstract/i), {
      target: { value: "Detailed ZK audit log design." },
    });
    fireEvent.change(screen.getByLabelText(/Paper Document \/ PDF URL/i), {
      target: { value: "https://example.com/zk-paper.pdf" },
    });

    const submitBtn = screen.getByRole("button", {
      name: /Submit Paper Proposal/i,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Paper proposal submitted successfully!/i)
      ).toBeInTheDocument();
    });

    // Check fetch call
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/v1/events/evt-conf-01/cfp/submissions"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          track: "Security",
          title: "Zero-Knowledge Rollups for Auditing",
          abstract: "Detailed ZK audit log design.",
          file_url: "https://example.com/zk-paper.pdf",
        }),
      })
    );
  });

  it("submits reviewer score and comments via POST /v1/cfp/submissions/{id}/reviews", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // GET submissions
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockSubmissions), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    // POST review
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "reviewed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    // Invalidation refetch
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockSubmissions), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    renderCFPPortal("evt-conf-01");

    expect(
      await screen.findByText("Fault Tolerant Raft on Edge Nodes")
    ).toBeInTheDocument();

    // Open review form
    const reviewToggle = screen.getByRole("button", {
      name: /Review Paper \(Scoring\)/i,
    });
    fireEvent.click(reviewToggle);

    const scoreInput = screen.getByLabelText(/Score \(1 to 10\)/i);
    const commentsInput = screen.getByLabelText(/Review Comments/i);

    fireEvent.change(scoreInput, { target: { value: "9" } });
    fireEvent.change(commentsInput, {
      target: { value: "Excellent empirical evaluation and clear methodology." },
    });

    const submitReviewBtn = screen.getByRole("button", {
      name: /Submit Review/i,
    });
    fireEvent.click(submitReviewBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Review score and feedback recorded successfully!/i)
      ).toBeInTheDocument();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/v1/cfp/submissions/sub-100/reviews"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          score: 9,
          comments: "Excellent empirical evaluation and clear methodology.",
          recommendation: "Accept",
        }),
      })
    );
  });

  it("assigns reviewer and records organizer decision, surfacing 403 Forbidden cleanly with role=alert", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // GET submissions
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(mockSubmissions), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    // POST assign returns 403 Forbidden
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    renderCFPPortal("evt-conf-01");

    expect(
      await screen.findByText("Fault Tolerant Raft on Edge Nodes")
    ).toBeInTheDocument();

    const reviewerInput = screen.getByLabelText(/Reviewer User ID/i);
    fireEvent.change(reviewerInput, { target: { value: "usr-rev-999" } });

    const assignBtn = screen.getByRole("button", { name: /Assign Reviewer/i });
    fireEvent.click(assignBtn);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/403 Forbidden/i);
    expect(alert).toHaveTextContent(/permission to assign reviewers/i);

    // Next: Test organizer decision 403
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    );

    const acceptBtn = screen.getByRole("button", { name: /^Accept$/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /403 Forbidden: You do not have permission to decide submissions/i
      );
    });
  });
});
