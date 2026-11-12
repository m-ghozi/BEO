package cfp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cerdas-club/beo/apps/api/internal/cfp"
	"github.com/cerdas-club/beo/apps/api/internal/events"
	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/platform"
)

func setupTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("skipping integration test: TEST_DATABASE_URL not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := platform.OpenDB(ctx, dsn)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}

	migrationsFS := os.DirFS("../../migrations")
	if err := platform.RunMigrations(ctx, pool, migrationsFS); err != nil {
		t.Fatalf("failed to run migrations: %v", err)
	}

	return pool
}

func createTestUser(t *testing.T, pool *pgxpool.Pool, prefix string) identity.User {
	t.Helper()
	ctx := context.Background()
	userID := uuid.NewString()
	email := fmt.Sprintf("%s-%s@example.com", prefix, uuid.NewString()[:8])
	var u identity.User
	err := pool.QueryRow(ctx, `
		INSERT INTO users (id, name, email, password_hash, account_type, expo_push_tokens, created_at)
		VALUES ($1, $2, $3, 'dummy-hash', 'standard', '{}', NOW())
		RETURNING id, name, email, account_type, expo_push_tokens, created_at
	`, userID, prefix+" Name", email).Scan(
		&u.ID, &u.Name, &u.Email, &u.AccountType, &u.ExpoPushTokens, &u.CreatedAt,
	)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}
	return u
}

func TestCFPWorkflow_SubmitAssignReviewDecide(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	identitySvc := identity.NewService(pool, "test-jwt-secret-key-for-cfp-32bytes")
	eventsSvc := events.NewService(pool, identitySvc, nil)
	cfpSvc := cfp.NewService(pool, identitySvc)

	organizer := createTestUser(t, pool, "organizer")
	author := createTestUser(t, pool, "author")
	reviewer := createTestUser(t, pool, "reviewer")
	unassignedReviewer := createTestUser(t, pool, "other-reviewer")

	evt, err := eventsSvc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "BEO Conf 2026",
		Slug:      "beo-conf-" + uuid.NewString()[:8],
		EventType: events.EventTypeConference,
		StartAt:   time.Now().Add(48 * time.Hour),
		EndAt:     time.Now().Add(72 * time.Hour),
		Venue:     "Jakarta Convention Center",
	})
	if err != nil {
		t.Fatalf("CreateEvent failed: %v", err)
	}

	// 1. Author submits paper
	sub, err := cfpSvc.SubmitPaper(ctx, evt.ID, author.ID, cfp.SubmitPaperInput{
		Track:    "Distributed Systems",
		Title:    "Consensus at Scale",
		Abstract: "A practical study of Raft and Paxos.",
		FileURL:  "https://example.com/papers/consensus.pdf",
	})
	if err != nil {
		t.Fatalf("SubmitPaper failed: %v", err)
	}
	if sub.ID == "" {
		t.Fatal("expected non-empty submission ID")
	}
	if sub.Status != "submitted" {
		t.Fatalf("expected status 'submitted', got %q", sub.Status)
	}

	// 2. Non-organizer cannot assign reviewer
	err = cfpSvc.AssignReviewer(ctx, evt.ID, author.ID, sub.ID, reviewer.ID)
	if !errors.Is(err, cfp.ErrForbidden) {
		t.Fatalf("expected ErrForbidden for non-organizer AssignReviewer, got %v", err)
	}

	// 3. Organizer assigns reviewer
	err = cfpSvc.AssignReviewer(ctx, evt.ID, organizer.ID, sub.ID, reviewer.ID)
	if err != nil {
		t.Fatalf("AssignReviewer failed: %v", err)
	}

	// 4. Non-assigned reviewer cannot submit review
	err = cfpSvc.SubmitReview(ctx, sub.ID, unassignedReviewer.ID, 8, "Nice paper", "accept")
	if !errors.Is(err, cfp.ErrForbidden) {
		t.Fatalf("expected ErrForbidden for unassigned reviewer, got %v", err)
	}

	// 5. Assigned reviewer submits review
	err = cfpSvc.SubmitReview(ctx, sub.ID, reviewer.ID, 9, "Strong methodology and results.", "accept")
	if err != nil {
		t.Fatalf("SubmitReview failed: %v", err)
	}

	// 6. Non-organizer cannot decide submission
	err = cfpSvc.DecideSubmission(ctx, evt.ID, author.ID, sub.ID, "accepted")
	if !errors.Is(err, cfp.ErrForbidden) {
		t.Fatalf("expected ErrForbidden for non-organizer DecideSubmission, got %v", err)
	}

	// 7. Organizer marks submission accepted
	err = cfpSvc.DecideSubmission(ctx, evt.ID, organizer.ID, sub.ID, "accepted")
	if err != nil {
		t.Fatalf("DecideSubmission failed: %v", err)
	}

	// 8. Verify persisted state in database
	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM cfp_submissions WHERE id = $1`, sub.ID).Scan(&status); err != nil {
		t.Fatalf("query cfp_submissions failed: %v", err)
	}
	if status != "accepted" {
		t.Fatalf("expected status 'accepted', got %q", status)
	}

	var score int
	var comments, rec string
	if err := pool.QueryRow(ctx, `
		SELECT score, comments, recommendation
		FROM cfp_reviews
		WHERE submission_id = $1 AND reviewer_user_id = $2
	`, sub.ID, reviewer.ID).Scan(&score, &comments, &rec); err != nil {
		t.Fatalf("query cfp_reviews failed: %v", err)
	}
	if score != 9 || comments != "Strong methodology and results." || rec != "accept" {
		t.Fatalf("unexpected review row: score=%d comments=%q rec=%q", score, comments, rec)
	}
}

func TestCFPHandler_Workflow(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	const jwtSecret = "test-jwt-secret-key-for-cfp-32bytes"
	identitySvc := identity.NewService(pool, jwtSecret)
	eventsSvc := events.NewService(pool, identitySvc, nil)
	cfpSvc := cfp.NewService(pool, identitySvc)
	handler := cfp.NewHandler(cfpSvc, jwtSecret)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	organizer := createTestUser(t, pool, "http-org")
	author := createTestUser(t, pool, "http-author")
	reviewer := createTestUser(t, pool, "http-rev")

	orgToken, err := identity.GenerateJWT(organizer, jwtSecret)
	if err != nil {
		t.Fatalf("GenerateJWT organizer: %v", err)
	}
	authorToken, err := identity.GenerateJWT(author, jwtSecret)
	if err != nil {
		t.Fatalf("GenerateJWT author: %v", err)
	}
	revToken, err := identity.GenerateJWT(reviewer, jwtSecret)
	if err != nil {
		t.Fatalf("GenerateJWT reviewer: %v", err)
	}

	evt, err := eventsSvc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "BEO HTTP Conf",
		Slug:      "beo-http-conf-" + uuid.NewString()[:8],
		EventType: events.EventTypeConference,
		StartAt:   time.Now().Add(48 * time.Hour),
		EndAt:     time.Now().Add(72 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateEvent failed: %v", err)
	}

	doReq := func(method, path, token string, body any) *httptest.ResponseRecorder {
		var buf bytes.Buffer
		if body != nil {
			if err := json.NewEncoder(&buf).Encode(body); err != nil {
				t.Fatalf("encode body: %v", err)
			}
		}
		req := httptest.NewRequest(method, path, &buf)
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}

	// Submit paper
	rec := doReq(http.MethodPost, "/v1/events/"+evt.ID+"/cfp/submissions", authorToken, map[string]string{
		"track":    "Cloud",
		"title":    "Serverless Patterns",
		"abstract": "Deep dive",
		"file_url": "https://example.com/p.pdf",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var sub cfp.Submission
	if err := json.Unmarshal(rec.Body.Bytes(), &sub); err != nil {
		t.Fatalf("unmarshal submission: %v", err)
	}

	// Assign reviewer
	rec = doReq(http.MethodPost, "/v1/events/"+evt.ID+"/cfp/submissions/"+sub.ID+"/assign", orgToken, map[string]string{
		"reviewer_id": reviewer.ID,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on assign, got %d: %s", rec.Code, rec.Body.String())
	}

	// Submit review
	rec = doReq(http.MethodPost, "/v1/cfp/submissions/"+sub.ID+"/reviews", revToken, map[string]any{
		"score":          8,
		"comments":       "Good",
		"recommendation": "accept",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on review, got %d: %s", rec.Code, rec.Body.String())
	}

	// Decide submission
	rec = doReq(http.MethodPost, "/v1/events/"+evt.ID+"/cfp/submissions/"+sub.ID+"/decision", orgToken, map[string]string{
		"decision": "accepted",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on decision, got %d: %s", rec.Code, rec.Body.String())
	}

	// List submissions as organizer
	rec = doReq(http.MethodGet, "/v1/events/"+evt.ID+"/cfp/submissions", orgToken, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on list, got %d: %s", rec.Code, rec.Body.String())
	}
	var subs []cfp.Submission
	if err := json.Unmarshal(rec.Body.Bytes(), &subs); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	if len(subs) != 1 || subs[0].Status != "accepted" {
		t.Fatalf("unexpected submissions list: %+v", subs)
	}
}
