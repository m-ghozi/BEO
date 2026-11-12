package events_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cerdas-club/beo/apps/api/internal/events"
	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/platform"
)

const testJWTSecret = "test-jwt-secret-key-for-events-32bytes"

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

func createTestUser(t *testing.T, pool *pgxpool.Pool, prefix, accountType string, pushTokens []string) identity.User {
	t.Helper()
	ctx := context.Background()
	userID := uuid.NewString()
	email := fmt.Sprintf("%s-%s@example.com", prefix, uuid.NewString()[:8])
	query := `
		INSERT INTO users (id, name, email, password_hash, account_type, expo_push_tokens, created_at)
		VALUES ($1, $2, $3, 'dummy-hash', $4, $5, NOW())
		RETURNING id, name, email, account_type, expo_push_tokens, created_at
	`
	var u identity.User
	if pushTokens == nil {
		pushTokens = []string{}
	}
	err := pool.QueryRow(ctx, query, userID, prefix+" Name", email, accountType, pushTokens).Scan(
		&u.ID, &u.Name, &u.Email, &u.AccountType, &u.ExpoPushTokens, &u.CreatedAt,
	)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}
	return u
}

type mockPushNotifier struct {
	mu          sync.Mutex
	calls       []pushCall
	errToReturn error
}

type pushCall struct {
	Tokens []string
	Title  string
	Body   string
	Data   map[string]string
}

func (m *mockPushNotifier) Send(ctx context.Context, tokens []string, title, body string, data map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls = append(m.calls, pushCall{
		Tokens: tokens,
		Title:  title,
		Body:   body,
		Data:   data,
	})
	return m.errToReturn
}

func TestCreateEvent_SupportsAllFourTypes(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	idSvc := identity.NewService(pool, testJWTSecret)
	mockPush := &mockPushNotifier{}
	svc := events.NewService(pool, idSvc, mockPush)

	organizer := createTestUser(t, pool, "organizer-four-types", "standard", nil)

	typesToTest := []events.EventType{
		events.EventTypeCommunity,
		events.EventTypeSeminarWorkshop,
		events.EventTypeConference,
		events.EventTypeMeetupTed,
	}

	for _, evtType := range typesToTest {
		t.Run(string(evtType), func(t *testing.T) {
			now := time.Now().UTC().Truncate(time.Second)
			startAt := now.Add(24 * time.Hour)
			endAt := now.Add(30 * time.Hour)
			slug := fmt.Sprintf("event-%s-%s", strings.ReplaceAll(string(evtType), "_", "-"), uuid.NewString()[:8])

			in := events.CreateEventInput{
				Title:          fmt.Sprintf("Title for %s", evtType),
				Slug:           slug,
				EventType:      evtType,
				ModulesEnabled: map[string]any{"chat": true},
				StartAt:        startAt,
				EndAt:          endAt,
				Venue:          "Main Convention Center, Jakarta",
				Status:         events.EventStatusDraft,
			}

			evt, err := svc.CreateEvent(ctx, organizer.ID, in)
			if err != nil {
				t.Fatalf("expected CreateEvent to succeed for %s, got: %v", evtType, err)
			}
			if evt.ID == "" {
				t.Errorf("expected non-empty event ID")
			}
			if evt.EventType != evtType {
				t.Errorf("expected event_type %s, got %s", evtType, evt.EventType)
			}
			if evt.OrganizerID != organizer.ID {
				t.Errorf("expected organizer_id %s, got %s", organizer.ID, evt.OrganizerID)
			}
			if evt.Slug != slug {
				t.Errorf("expected slug %s, got %s", slug, evt.Slug)
			}

			// Add a session to this event
			sessionIn := events.CreateSessionInput{
				Title:       "Opening Keynote",
				SpeakerName: "Jane Doe",
				SpeakerBio:  "Lead Engineer & Community Advocate",
				StartAt:     startAt.Add(1 * time.Hour),
				EndAt:       startAt.Add(2 * time.Hour),
				RoomOrStage: "Hall A",
			}

			session, err := svc.AddSession(ctx, evt.ID, organizer.ID, sessionIn)
			if err != nil {
				t.Fatalf("expected AddSession to succeed for event %s, got: %v", evt.ID, err)
			}
			if session.ID == "" {
				t.Errorf("expected non-empty session ID")
			}
			if session.EventID != evt.ID {
				t.Errorf("expected session.EventID %s, got %s", evt.ID, session.EventID)
			}
			if session.Title != sessionIn.Title {
				t.Errorf("expected session.Title %s, got %s", sessionIn.Title, session.Title)
			}
			if session.SpeakerName != sessionIn.SpeakerName {
				t.Errorf("expected session.SpeakerName %s, got %s", sessionIn.SpeakerName, session.SpeakerName)
			}
		})
	}

	// Test invalid event_type rejection
	t.Run("rejects_invalid_event_type", func(t *testing.T) {
		now := time.Now().UTC().Truncate(time.Second)
		in := events.CreateEventInput{
			Title:     "Invalid Event",
			Slug:      fmt.Sprintf("invalid-%s", uuid.NewString()[:8]),
			EventType: events.EventType("unsupported_festival"),
			StartAt:   now.Add(24 * time.Hour),
			EndAt:     now.Add(28 * time.Hour),
		}

		_, err := svc.CreateEvent(ctx, organizer.ID, in)
		if err == nil {
			t.Fatalf("expected error for invalid event type, got nil")
		}
		if !errors.Is(err, events.ErrInvalidEventType) {
			t.Errorf("expected ErrInvalidEventType, got: %v", err)
		}
	})

	// Test invalid slug rejection
	t.Run("rejects_invalid_slugs", func(t *testing.T) {
		now := time.Now().UTC().Truncate(time.Second)
		invalidSlugs := []string{
			"slug with spaces",
			"slug/with/slashes",
			"slug?with=query",
			"slug!@#$",
			"-leading-hyphen",
			"trailing-hyphen-",
			"double--hyphen",
			"",
		}

		for _, badSlug := range invalidSlugs {
			in := events.CreateEventInput{
				Title:     "Event with Bad Slug",
				Slug:      badSlug,
				EventType: events.EventTypeCommunity,
				StartAt:   now.Add(24 * time.Hour),
				EndAt:     now.Add(28 * time.Hour),
			}
			_, err := svc.CreateEvent(ctx, organizer.ID, in)
			if err == nil {
				t.Errorf("expected error for invalid slug %q, got nil", badSlug)
			}
			if !errors.Is(err, events.ErrInvalidInput) {
				t.Errorf("expected ErrInvalidInput for slug %q, got %v", badSlug, err)
			}
		}
	})
}

func TestPublishPost_TriggersPushToClaimedAttendees(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	idSvc := identity.NewService(pool, testJWTSecret)
	mockPush := &mockPushNotifier{}
	svc := events.NewService(pool, idSvc, mockPush)

	organizer := createTestUser(t, pool, "org-push", "standard", nil)

	// Create targeted event
	now := time.Now().UTC().Truncate(time.Second)
	evt, err := svc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "Push Notification Event",
		Slug:      fmt.Sprintf("push-evt-%s", uuid.NewString()[:8]),
		EventType: events.EventTypeCommunity,
		StartAt:   now.Add(24 * time.Hour),
		EndAt:     now.Add(28 * time.Hour),
	})
	if err != nil {
		t.Fatalf("failed to create event: %v", err)
	}

	// Create another event (to verify attendees of other events do NOT receive push)
	otherEvt, err := svc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "Other Event",
		Slug:      fmt.Sprintf("other-evt-%s", uuid.NewString()[:8]),
		EventType: events.EventTypeCommunity,
		StartAt:   now.Add(48 * time.Hour),
		EndAt:     now.Add(52 * time.Hour),
	})
	if err != nil {
		t.Fatalf("failed to create other event: %v", err)
	}

	// Users with push tokens
	user1 := createTestUser(t, pool, "attendee-1", "standard", []string{"ExponentPushToken[user1_a]", "ExponentPushToken[user1_b]"})
	user2 := createTestUser(t, pool, "attendee-2", "standard", []string{"ExponentPushToken[user2_a]"})
	userCancelled := createTestUser(t, pool, "cancelled-attendee", "standard", []string{"ExponentPushToken[cancelled_token]"})
	userOtherEvent := createTestUser(t, pool, "other-attendee", "standard", []string{"ExponentPushToken[other_token]"})

	// Seed ticket types for both events
	ttID1 := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO ticket_types (id, event_id, name, price, currency, quota, sales_start_at, sales_end_at, created_at)
		VALUES ($1, $2, 'General', 0, 'IDR', 100, NOW(), NOW() + INTERVAL '1 day', NOW())
	`, ttID1, evt.ID)
	if err != nil {
		t.Fatalf("failed to insert ticket type 1: %v", err)
	}

	ttID2 := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO ticket_types (id, event_id, name, price, currency, quota, sales_start_at, sales_end_at, created_at)
		VALUES ($1, $2, 'General', 0, 'IDR', 100, NOW(), NOW() + INTERVAL '1 day', NOW())
	`, ttID2, otherEvt.ID)
	if err != nil {
		t.Fatalf("failed to insert ticket type 2: %v", err)
	}

	// Insert tickets:
	// Ticket for user1 (valid, evt.ID)
	_, err = pool.Exec(ctx, `
		INSERT INTO tickets (id, ticket_type_id, event_id, ticket_code, qr_signature, claimed_by_user_id, status, created_at)
		VALUES ($1, $2, $3, $4, 'sig1', $5, 'valid', NOW())
	`, uuid.NewString(), ttID1, evt.ID, fmt.Sprintf("CODE-USER1-%s", uuid.NewString()), user1.ID)
	if err != nil {
		t.Fatalf("failed to insert ticket for user1: %v", err)
	}

	// Ticket for user2 (valid, evt.ID)
	_, err = pool.Exec(ctx, `
		INSERT INTO tickets (id, ticket_type_id, event_id, ticket_code, qr_signature, claimed_by_user_id, status, created_at)
		VALUES ($1, $2, $3, $4, 'sig2', $5, 'valid', NOW())
	`, uuid.NewString(), ttID1, evt.ID, fmt.Sprintf("CODE-USER2-%s", uuid.NewString()), user2.ID)
	if err != nil {
		t.Fatalf("failed to insert ticket for user2: %v", err)
	}

	// Ticket for userCancelled (cancelled, evt.ID)
	_, err = pool.Exec(ctx, `
		INSERT INTO tickets (id, ticket_type_id, event_id, ticket_code, qr_signature, claimed_by_user_id, status, created_at)
		VALUES ($1, $2, $3, $4, 'sig3', $5, 'cancelled', NOW())
	`, uuid.NewString(), ttID1, evt.ID, fmt.Sprintf("CODE-CANCELLED-%s", uuid.NewString()), userCancelled.ID)
	if err != nil {
		t.Fatalf("failed to insert cancelled ticket: %v", err)
	}

	// Ticket for userOtherEvent (valid, otherEvt.ID)
	_, err = pool.Exec(ctx, `
		INSERT INTO tickets (id, ticket_type_id, event_id, ticket_code, qr_signature, claimed_by_user_id, status, created_at)
		VALUES ($1, $2, $3, $4, 'sig4', $5, 'valid', NOW())
	`, uuid.NewString(), ttID2, otherEvt.ID, fmt.Sprintf("CODE-OTHER-%s", uuid.NewString()), userOtherEvent.ID)
	if err != nil {
		t.Fatalf("failed to insert ticket for other event: %v", err)
	}

	// 1. Publish post with notify_push = true
	postIn := events.CreatePostInput{
		Title:      "Schedule Change Alert",
		Body:       "Keynote starts 30 minutes earlier at 08:30 AM.",
		NotifyPush: true,
	}

	post, err := svc.PublishPost(ctx, evt.ID, organizer.ID, postIn)
	if err != nil {
		t.Fatalf("failed to publish post: %v", err)
	}
	if post.ID == "" {
		t.Errorf("expected non-empty post ID")
	}
	if post.Title != postIn.Title {
		t.Errorf("expected post title %s, got %s", postIn.Title, post.Title)
	}
	if !post.NotifyPush {
		t.Errorf("expected post.NotifyPush to be true")
	}

	// Verify push notification dispatch
	mockPush.mu.Lock()
	numCalls := len(mockPush.calls)
	var lastCall pushCall
	if numCalls > 0 {
		lastCall = mockPush.calls[0]
	}
	mockPush.mu.Unlock()

	if numCalls != 1 {
		t.Fatalf("expected PushNotifier.Send to be called once, got %d calls", numCalls)
	}

	if lastCall.Title != postIn.Title {
		t.Errorf("expected push title %s, got %s", postIn.Title, lastCall.Title)
	}
	if lastCall.Body != postIn.Body {
		t.Errorf("expected push body %s, got %s", postIn.Body, lastCall.Body)
	}
	if lastCall.Data["event_id"] != evt.ID {
		t.Errorf("expected data[event_id] %s, got %s", evt.ID, lastCall.Data["event_id"])
	}
	if lastCall.Data["post_id"] != post.ID {
		t.Errorf("expected data[post_id] %s, got %s", post.ID, lastCall.Data["post_id"])
	}

	// Verify tokens: must contain distinct tokens of user1 and user2, and MUST NOT contain cancelled or other event tokens
	expectedTokens := []string{
		"ExponentPushToken[user1_a]",
		"ExponentPushToken[user1_b]",
		"ExponentPushToken[user2_a]",
	}
	sort.Strings(expectedTokens)

	gotTokens := make([]string, len(lastCall.Tokens))
	copy(gotTokens, lastCall.Tokens)
	sort.Strings(gotTokens)

	if len(gotTokens) != len(expectedTokens) {
		t.Fatalf("expected %d tokens, got %d: %v", len(expectedTokens), len(gotTokens), gotTokens)
	}
	for i := range expectedTokens {
		if gotTokens[i] != expectedTokens[i] {
			t.Errorf("token[%d] expected %s, got %s", i, expectedTokens[i], gotTokens[i])
		}
	}

	// 2. Publish post with notify_push = false
	postNoPushIn := events.CreatePostInput{
		Title:      "Silent Announcement",
		Body:       "Check out the exhibition floor booth list.",
		NotifyPush: false,
	}

	_, err = svc.PublishPost(ctx, evt.ID, organizer.ID, postNoPushIn)
	if err != nil {
		t.Fatalf("failed to publish silent post: %v", err)
	}

	mockPush.mu.Lock()
	numCallsAfter := len(mockPush.calls)
	mockPush.mu.Unlock()

	if numCallsAfter != 1 {
		t.Errorf("expected PushNotifier.Send count to remain 1, got %d", numCallsAfter)
	}
}

func TestEventHTTPHandlers(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	idSvc := identity.NewService(pool, testJWTSecret)
	mockPush := &mockPushNotifier{}
	svc := events.NewService(pool, idSvc, mockPush)
	handler := events.NewHandler(svc, testJWTSecret)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	organizer := createTestUser(t, pool, "http-org", "standard", nil)
	orgToken, err := identity.GenerateJWT(organizer, testJWTSecret)
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	stranger := createTestUser(t, pool, "http-stranger", "standard", nil)
	strangerToken, err := identity.GenerateJWT(stranger, testJWTSecret)
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	now := time.Now().UTC().Truncate(time.Second)
	slug := fmt.Sprintf("conf-%s", uuid.NewString()[:8])

	// 1. POST /v1/events (authenticated organizer)
	createReqBody, _ := json.Marshal(map[string]any{
		"title":           "Go Developers Summit",
		"slug":            slug,
		"event_type":      "conference",
		"modules_enabled": map[string]any{"cfp": true},
		"start_at":        now.Add(48 * time.Hour).Format(time.RFC3339),
		"end_at":          now.Add(60 * time.Hour).Format(time.RFC3339),
		"venue":           "Jakarta International Expo",
		"status":          "published",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/events", bytes.NewReader(createReqBody))
	req.Header.Set("Authorization", "Bearer "+orgToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var createdEvt events.Event
	if err := json.Unmarshal(w.Body.Bytes(), &createdEvt); err != nil {
		t.Fatalf("failed to decode created event: %v", err)
	}
	if createdEvt.ID == "" || createdEvt.Slug != slug {
		t.Errorf("unexpected created event response: %+v", createdEvt)
	}

	// 2. GET /v1/events (public)
	req = httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d: %s", w.Code, w.Body.String())
	}
	var evtList []events.Event
	if err := json.Unmarshal(w.Body.Bytes(), &evtList); err != nil {
		t.Fatalf("failed to decode event list: %v", err)
	}
	if len(evtList) == 0 {
		t.Errorf("expected at least 1 event in public list")
	}

	// 3. GET /v1/events/{slug} (public)
	req = httptest.NewRequest(http.MethodGet, "/v1/events/"+slug, nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d: %s", w.Code, w.Body.String())
	}
	var fetchedEvt events.Event
	if err := json.Unmarshal(w.Body.Bytes(), &fetchedEvt); err != nil {
		t.Fatalf("failed to decode event by slug: %v", err)
	}
	if fetchedEvt.ID != createdEvt.ID {
		t.Errorf("expected event ID %s, got %s", createdEvt.ID, fetchedEvt.ID)
	}

	// 4. GET /v1/events/{slug} with non-existent slug -> 404
	req = httptest.NewRequest(http.MethodGet, "/v1/events/non-existent-slug-xyz", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected status 404 Not Found, got %d", w.Code)
	}

	// 5. POST /v1/events/{eventID}/sessions (authenticated organizer)
	sessionReqBody, _ := json.Marshal(map[string]any{
		"title":         "Building Scalable Go Monoliths",
		"speaker_name":  "Alice Expert",
		"speaker_bio":   "Staff Engineer at Cloud Corp",
		"start_at":      now.Add(50 * time.Hour).Format(time.RFC3339),
		"end_at":        now.Add(51 * time.Hour).Format(time.RFC3339),
		"room_or_stage": "Stage 1",
	})
	req = httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v1/events/%s/sessions", createdEvt.ID), bytes.NewReader(sessionReqBody))
	req.Header.Set("Authorization", "Bearer "+orgToken)
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201 Created for add session, got %d: %s", w.Code, w.Body.String())
	}

	// 6. POST /v1/events/{eventID}/sessions (unauthorized / forbidden stranger)
	req = httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v1/events/%s/sessions", createdEvt.ID), bytes.NewReader(sessionReqBody))
	req.Header.Set("Authorization", "Bearer "+strangerToken)
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected status 403 Forbidden for non-organizer session add, got %d", w.Code)
	}

	// 7. POST /v1/events/{eventID}/posts (authenticated organizer)
	postReqBody, _ := json.Marshal(map[string]any{
		"title":       "Welcome to the Summit",
		"body":        "Badges can be picked up starting at 8:00 AM.",
		"notify_push": false,
	})
	req = httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v1/events/%s/posts", createdEvt.ID), bytes.NewReader(postReqBody))
	req.Header.Set("Authorization", "Bearer "+orgToken)
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201 Created for publish post, got %d: %s", w.Code, w.Body.String())
	}

	// 8. POST /v1/events with invalid slug format -> 400 Bad Request
	badSlugBody, _ := json.Marshal(map[string]any{
		"title":      "Bad Slug Event",
		"slug":       "invalid slug with spaces",
		"event_type": "community",
		"start_at":   now.Add(24 * time.Hour).Format(time.RFC3339),
		"end_at":     now.Add(28 * time.Hour).Format(time.RFC3339),
	})
	req = httptest.NewRequest(http.MethodPost, "/v1/events", bytes.NewReader(badSlugBody))
	req.Header.Set("Authorization", "Bearer "+orgToken)
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400 Bad Request for invalid slug format, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListEvents_StatusFilteringAndPagination(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	idSvc := identity.NewService(pool, testJWTSecret)
	mockPush := &mockPushNotifier{}
	svc := events.NewService(pool, idSvc, mockPush)
	handler := events.NewHandler(svc, testJWTSecret)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	organizer := createTestUser(t, pool, "pagination-org", "standard", nil)
	now := time.Now().UTC().Truncate(time.Second)

	// Create a draft event
	draftEvt, err := svc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "Draft Event Title",
		Slug:      fmt.Sprintf("draft-evt-%s", uuid.NewString()[:8]),
		EventType: events.EventTypeCommunity,
		StartAt:   now.Add(10 * time.Hour),
		EndAt:     now.Add(12 * time.Hour),
		Status:    events.EventStatusDraft,
	})
	if err != nil {
		t.Fatalf("failed to create draft event: %v", err)
	}

	// Create 3 published events
	var pubEvents []events.Event
	for i := 1; i <= 3; i++ {
		pubEvt, err := svc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
			Title:     fmt.Sprintf("Published Event %d", i),
			Slug:      fmt.Sprintf("pub-evt-%d-%s", i, uuid.NewString()[:8]),
			EventType: events.EventTypeCommunity,
			StartAt:   now.Add(time.Duration(20+i*2) * time.Hour),
			EndAt:     now.Add(time.Duration(24+i*2) * time.Hour),
			Status:    events.EventStatusPublished,
		})
		if err != nil {
			t.Fatalf("failed to create published event %d: %v", i, err)
		}
		pubEvents = append(pubEvents, pubEvt)
	}

	// 1. Verify ListEvents filters out draft events
	allPublished, err := svc.ListEvents(ctx)
	if err != nil {
		t.Fatalf("failed to list published events: %v", err)
	}
	for _, evt := range allPublished {
		if evt.ID == draftEvt.ID {
			t.Errorf("expected draft event %s to NOT be in published listing", draftEvt.ID)
		}
		if evt.Status != events.EventStatusPublished {
			t.Errorf("expected all listed events to be published, got status %s for event %s", evt.Status, evt.ID)
		}
	}

	// 2. Verify pagination (Limit & Offset) in service
	limitedList, err := svc.ListEvents(ctx, events.ListEventsOptions{Limit: 2, Offset: 0})
	if err != nil {
		t.Fatalf("failed to list events with limit: %v", err)
	}
	if len(limitedList) > 2 {
		t.Errorf("expected at most 2 events, got %d", len(limitedList))
	}

	// 3. Verify pagination via HTTP query parameters: GET /v1/events?limit=2&offset=0
	req := httptest.NewRequest(http.MethodGet, "/v1/events?limit=2&offset=0", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d: %s", w.Code, w.Body.String())
	}
	var httpList []events.Event
	if err := json.Unmarshal(w.Body.Bytes(), &httpList); err != nil {
		t.Fatalf("failed to decode http event list: %v", err)
	}
	if len(httpList) > 2 {
		t.Errorf("expected at most 2 events from http query, got %d", len(httpList))
	}
	for _, evt := range httpList {
		if evt.Status != events.EventStatusPublished {
			t.Errorf("expected published status, got %s", evt.Status)
		}
	}
}
