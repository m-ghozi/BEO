package checkin_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cerdas-club/beo/apps/api/internal/checkin"
	"github.com/cerdas-club/beo/apps/api/internal/events"
	"github.com/cerdas-club/beo/apps/api/internal/fraud"
	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/platform"
	"github.com/cerdas-club/beo/apps/api/internal/ticketing"
)

const (
	testJWTSecret    = "test-jwt-secret-key-for-checkin-32b"
	testQRHMACSecret = "test-qr-hmac-secret-for-checkin-32b"
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
	query := `
		INSERT INTO users (id, name, email, password_hash, account_type, expo_push_tokens, created_at)
		VALUES ($1, $2, $3, 'dummy-hash', 'standard', '{}', NOW())
		RETURNING id, name, email, account_type, expo_push_tokens, created_at
	`
	var u identity.User
	err := pool.QueryRow(ctx, query, userID, prefix+" Name", email).Scan(
		&u.ID, &u.Name, &u.Email, &u.AccountType, &u.ExpoPushTokens, &u.CreatedAt,
	)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}
	return u
}

func setupEventWithTicket(t *testing.T, pool *pgxpool.Pool) (identity.User, identity.User, events.Event, ticketing.Ticket) {
	t.Helper()
	ctx := context.Background()
	idSvc := identity.NewService(pool, testJWTSecret)
	evtSvc := events.NewService(pool, idSvc, nil)
	tktSvc := ticketing.NewService(pool, idSvc, testQRHMACSecret)

	organizer := createTestUser(t, pool, "org-chk")
	staff := createTestUser(t, pool, "staff-chk")

	evt, err := evtSvc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "Check-in Test Event",
		Slug:      "checkin-test-event-" + uuid.NewString()[:8],
		EventType: "community",
		StartAt:   time.Now().Add(24 * time.Hour),
		EndAt:     time.Now().Add(28 * time.Hour),
		Venue:     "Jakarta Convention Center",
	})
	if err != nil {
		t.Fatalf("CreateEvent failed: %v", err)
	}

	if err := idSvc.AssignEventMember(ctx, evt.ID, organizer.ID, staff.Email, "checkin_staff"); err != nil {
		t.Fatalf("AssignEventMember failed: %v", err)
	}

	tt, err := tktSvc.CreateTicketType(ctx, evt.ID, organizer.ID, ticketing.CreateTicketTypeInput{
		Name:       "General Admission",
		Price:      0,
		Currency:   "IDR",
		Quota:      10,
		SalesEndAt: time.Now().Add(23 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateTicketType failed: %v", err)
	}

	orderRes, err := tktSvc.ReserveOrder(ctx, ticketing.ReserveOrderInput{
		EventID:       evt.ID,
		TicketTypeID:  tt.ID,
		BuyerEmail:    "attendee@example.com",
		PaymentMethod: "free",
		Attendees: []ticketing.AttendeeInput{
			{Name: "Budi Santoso", Email: "attendee@example.com"},
		},
	})
	if err != nil {
		t.Fatalf("ReserveOrder failed: %v", err)
	}
	if len(orderRes.Tickets) != 1 {
		t.Fatalf("expected 1 ticket, got %d", len(orderRes.Tickets))
	}

	return organizer, staff, evt, orderRes.Tickets[0]
}

func TestScanQR_AtomicAndDuplicateDetection(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	_, staff, evt, ticket := setupEventWithTicket(t, pool)

	idSvc := identity.NewService(pool, testJWTSecret)
	auditLogger := fraud.NewAuditLogger(pool, fraud.NoopVectorStore{})
	svc := checkin.NewService(pool, idSvc, auditLogger, testQRHMACSecret)

	qrPayload := ticketing.SignQR(testQRHMACSecret, ticket.TicketCode, evt.ID)

	// First scan with HID scanner -> success
	res, err := svc.ScanQR(ctx, evt.ID, staff.ID, qrPayload, "hid", "127.0.0.1", "hid-scanner/1.0")
	if err != nil {
		t.Fatalf("first ScanQR failed: %v", err)
	}
	if res.Result != "success" {
		t.Fatalf("expected result 'success', got %q", res.Result)
	}
	if res.TicketID != ticket.ID {
		t.Fatalf("expected ticketID %q, got %q", ticket.ID, res.TicketID)
	}
	if res.AttendeeName != "Budi Santoso" {
		t.Fatalf("expected attendee name 'Budi Santoso', got %q", res.AttendeeName)
	}
	if res.CheckedInAt.IsZero() {
		t.Fatalf("expected non-zero CheckedInAt")
	}

	// Second scan with webcam -> ErrDuplicateScan
	_, err = svc.ScanQR(ctx, evt.ID, staff.ID, qrPayload, "webcam", "127.0.0.1", "Mozilla/5.0")
	if !errors.Is(err, checkin.ErrDuplicateScan) {
		t.Fatalf("expected ErrDuplicateScan on second scan, got %v", err)
	}

	// Verify checkin_logs has 2 rows: success (hid) and duplicate (webcam)
	rows, err := pool.Query(ctx, `
		SELECT scan_mode, result
		FROM checkin_logs
		WHERE event_id = $1 AND ticket_id = $2
		ORDER BY created_at ASC
	`, evt.ID, ticket.ID)
	if err != nil {
		t.Fatalf("query checkin_logs: %v", err)
	}
	defer rows.Close()

	type logRow struct {
		mode   string
		result string
	}
	var logs []logRow
	for rows.Next() {
		var r logRow
		if err := rows.Scan(&r.mode, &r.result); err != nil {
			t.Fatalf("scan checkin_logs: %v", err)
		}
		logs = append(logs, r)
	}
	if len(logs) != 2 {
		t.Fatalf("expected 2 checkin_logs rows, got %d", len(logs))
	}
	if logs[0].mode != "hid" || logs[0].result != "success" {
		t.Fatalf("unexpected first log: %+v", logs[0])
	}
	if logs[1].mode != "webcam" || logs[1].result != "duplicate" {
		t.Fatalf("unexpected second log: %+v", logs[1])
	}

	// Verify audit_events records the duplicate attempt
	var auditCount int
	err = pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM audit_events
		WHERE event_id = $1 AND actor_id = $2 AND event_category = 'checkin_duplicate'
	`, evt.ID, staff.ID).Scan(&auditCount)
	if err != nil {
		t.Fatalf("query audit_events: %v", err)
	}
	if auditCount != 1 {
		t.Fatalf("expected 1 checkin_duplicate audit_event, got %d", auditCount)
	}
}

func TestScanQR_RejectsWrongEventOrTamperedSignature(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	organizer, staff, evt1, ticket1 := setupEventWithTicket(t, pool)

	idSvc := identity.NewService(pool, testJWTSecret)
	evtSvc := events.NewService(pool, idSvc, nil)
	auditLogger := fraud.NewAuditLogger(pool, fraud.NoopVectorStore{})
	svc := checkin.NewService(pool, idSvc, auditLogger, testQRHMACSecret)

	// Create a second event
	evt2, err := evtSvc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "Other Event",
		Slug:      "other-event-" + uuid.NewString()[:8],
		EventType: "community",
		StartAt:   time.Now().Add(24 * time.Hour),
		EndAt:     time.Now().Add(28 * time.Hour),
		Venue:     "Bandung",
	})
	if err != nil {
		t.Fatalf("CreateEvent 2 failed: %v", err)
	}
	if err := idSvc.AssignEventMember(ctx, evt2.ID, organizer.ID, staff.Email, "checkin_staff"); err != nil {
		t.Fatalf("AssignEventMember 2 failed: %v", err)
	}

	// 1. Tampered signature
	tamperedPayload := ticket1.TicketCode + "|" + evt1.ID + "|deadbeef"
	_, err = svc.ScanQR(ctx, evt1.ID, staff.ID, tamperedPayload, "hid", "10.0.0.1", "test-agent")
	if !errors.Is(err, checkin.ErrInvalidTicket) {
		t.Fatalf("expected ErrInvalidTicket for tampered QR, got %v", err)
	}

	// 2. Valid signature for evt1, but scanned at evt2
	wrongEventPayload := ticketing.SignQR(testQRHMACSecret, ticket1.TicketCode, evt1.ID)
	_, err = svc.ScanQR(ctx, evt2.ID, staff.ID, wrongEventPayload, "webcam", "10.0.0.2", "test-agent")
	if !errors.Is(err, checkin.ErrInvalidTicket) {
		t.Fatalf("expected ErrInvalidTicket for wrong event QR, got %v", err)
	}

	// Verify checkin_logs and audit_events for evt1 and evt2
	var evt1InvalidLogs int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM checkin_logs WHERE event_id = $1 AND result = 'invalid'`, evt1.ID).Scan(&evt1InvalidLogs); err != nil {
		t.Fatalf("query evt1 checkin_logs: %v", err)
	}
	if evt1InvalidLogs != 1 {
		t.Fatalf("expected 1 invalid checkin_log for evt1, got %d", evt1InvalidLogs)
	}

	var evt2InvalidLogs int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM checkin_logs WHERE event_id = $1 AND result = 'invalid'`, evt2.ID).Scan(&evt2InvalidLogs); err != nil {
		t.Fatalf("query evt2 checkin_logs: %v", err)
	}
	if evt2InvalidLogs != 1 {
		t.Fatalf("expected 1 invalid checkin_log for evt2, got %d", evt2InvalidLogs)
	}

	var evt1AuditCount, evt2AuditCount int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM audit_events WHERE event_id = $1 AND event_category = 'checkin_invalid'`, evt1.ID).Scan(&evt1AuditCount)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM audit_events WHERE event_id = $1 AND event_category = 'checkin_invalid'`, evt2.ID).Scan(&evt2AuditCount)
	if evt1AuditCount != 1 || evt2AuditCount != 1 {
		t.Fatalf("expected 1 checkin_invalid audit_event each, got evt1=%d evt2=%d", evt1AuditCount, evt2AuditCount)
	}
}

func TestScanQR_ForbiddenForNonStaff(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	_, _, evt, ticket := setupEventWithTicket(t, pool)
	outsider := createTestUser(t, pool, "outsider")

	idSvc := identity.NewService(pool, testJWTSecret)
	auditLogger := fraud.NewAuditLogger(pool, nil)
	svc := checkin.NewService(pool, idSvc, auditLogger, testQRHMACSecret)

	qrPayload := ticketing.SignQR(testQRHMACSecret, ticket.TicketCode, evt.ID)
	_, err := svc.ScanQR(ctx, evt.ID, outsider.ID, qrPayload, "hid", "127.0.0.1", "agent")
	if !errors.Is(err, checkin.ErrForbidden) {
		t.Fatalf("expected ErrForbidden for non-staff user, got %v", err)
	}
}

func TestScanQR_ConcurrentAtomicScan(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	_, staff, evt, ticket := setupEventWithTicket(t, pool)

	idSvc := identity.NewService(pool, testJWTSecret)
	auditLogger := fraud.NewAuditLogger(pool, nil)
	svc := checkin.NewService(pool, idSvc, auditLogger, testQRHMACSecret)

	qrPayload := ticketing.SignQR(testQRHMACSecret, ticket.TicketCode, evt.ID)

	const workers = 5
	var wg sync.WaitGroup
	errs := make(chan error, workers)
	start := make(chan struct{})

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := svc.ScanQR(ctx, evt.ID, staff.ID, qrPayload, "hid", "127.0.0.1", "concurrent-test")
			errs <- err
		}()
	}

	close(start)
	wg.Wait()
	close(errs)

	var successes, duplicates int
	for err := range errs {
		if err == nil {
			successes++
		} else if errors.Is(err, checkin.ErrDuplicateScan) {
			duplicates++
		} else {
			t.Fatalf("unexpected error in concurrent scan: %v", err)
		}
	}

	if successes != 1 || duplicates != workers-1 {
		t.Fatalf("expected 1 success and %d duplicates, got successes=%d duplicates=%d", workers-1, successes, duplicates)
	}
}

func TestCheckinHandler_HTTP(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	_, staff, evt, ticket := setupEventWithTicket(t, pool)
	outsider := createTestUser(t, pool, "http-outsider")

	idSvc := identity.NewService(pool, testJWTSecret)
	auditLogger := fraud.NewAuditLogger(pool, fraud.NoopVectorStore{})
	svc := checkin.NewService(pool, idSvc, auditLogger, testQRHMACSecret)
	handler := checkin.NewHandler(svc, testJWTSecret)
	router := handler.Routes()

	staffToken, err := identity.GenerateJWT(staff, testJWTSecret)
	if err != nil {
		t.Fatalf("GenerateJWT staff: %v", err)
	}
	outsiderToken, err := identity.GenerateJWT(outsider, testJWTSecret)
	if err != nil {
		t.Fatalf("GenerateJWT outsider: %v", err)
	}

	qrPayload := ticketing.SignQR(testQRHMACSecret, ticket.TicketCode, evt.ID)
	bodyBytes, _ := json.Marshal(map[string]string{
		"qr_payload": qrPayload,
		"scan_mode":  "hid",
	})

	// 1. Forbidden for outsider
	req := httptest.NewRequest(http.MethodPost, "/v1/events/"+evt.ID+"/checkin", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+outsiderToken)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for outsider, got %d (%s)", rec.Code, rec.Body.String())
	}

	// 2. Success for staff
	req = httptest.NewRequest(http.MethodPost, "/v1/events/"+evt.ID+"/checkin", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+staffToken)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid scan, got %d (%s)", rec.Code, rec.Body.String())
	}

	// 3. Duplicate -> 409 Conflict
	req = httptest.NewRequest(http.MethodPost, "/v1/events/"+evt.ID+"/checkin", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+staffToken)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 for duplicate scan, got %d (%s)", rec.Code, rec.Body.String())
	}
}
