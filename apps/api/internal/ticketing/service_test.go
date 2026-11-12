package ticketing_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cerdas-club/beo/apps/api/internal/events"
	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/platform"
	"github.com/cerdas-club/beo/apps/api/internal/ticketing"
)

const (
	testJWTSecret    = "test-jwt-secret-key-for-ticketing-32b"
	testQRHMACSecret = "test-qr-hmac-secret-for-ticketing-32b"
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

func createTestUser(t *testing.T, pool *pgxpool.Pool, prefix, accountType string) identity.User {
	t.Helper()
	ctx := context.Background()
	userID := uuid.NewString()
	email := fmt.Sprintf("%s-%s@example.com", prefix, uuid.NewString()[:8])
	query := `
		INSERT INTO users (id, name, email, password_hash, account_type, expo_push_tokens, created_at)
		VALUES ($1, $2, $3, 'dummy-hash', $4, '{}', NOW())
		RETURNING id, name, email, account_type, expo_push_tokens, created_at
	`
	var u identity.User
	err := pool.QueryRow(ctx, query, userID, prefix+" Name", email, accountType).Scan(
		&u.ID, &u.Name, &u.Email, &u.AccountType, &u.ExpoPushTokens, &u.CreatedAt,
	)
	if err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}
	return u
}

func TestSignAndVerifyQR(t *testing.T) {
	ticketCode := "BEO-ABC12345"
	eventID := uuid.NewString()

	payload := ticketing.SignQR(testQRHMACSecret, ticketCode, eventID)
	parts := strings.Split(payload, "|")
	if len(parts) != 3 {
		t.Fatalf("expected 3 pipe-separated parts, got %d (%q)", len(parts), payload)
	}
	if parts[0] != ticketCode || parts[1] != eventID || parts[2] == "" {
		t.Fatalf("unexpected QR payload format: %q", payload)
	}

	gotCode, gotEventID, err := ticketing.VerifyQR(testQRHMACSecret, payload)
	if err != nil {
		t.Fatalf("VerifyQR failed for valid payload: %v", err)
	}
	if gotCode != ticketCode || gotEventID != eventID {
		t.Fatalf("VerifyQR mismatch: got (%q, %q), want (%q, %q)", gotCode, gotEventID, ticketCode, eventID)
	}

	// Tampered ticketCode
	tampered := "BEO-TAMPERED|" + eventID + "|" + parts[2]
	if _, _, err := ticketing.VerifyQR(testQRHMACSecret, tampered); err == nil {
		t.Fatalf("expected VerifyQR to reject tampered payload")
	}

	// Wrong secret
	if _, _, err := ticketing.VerifyQR("wrong-secret", payload); err == nil {
		t.Fatalf("expected VerifyQR to reject wrong secret")
	}

	// Malformed payload
	if _, _, err := ticketing.VerifyQR(testQRHMACSecret, "invalid-payload"); err == nil {
		t.Fatalf("expected VerifyQR to reject malformed payload")
	}
}

func TestReserveOrder_ConcurrentLastTicket(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	idSvc := identity.NewService(pool, testJWTSecret)
	evtSvc := events.NewService(pool, idSvc, nil)
	tktSvc := ticketing.NewService(pool, idSvc, testQRHMACSecret)

	organizer := createTestUser(t, pool, "org-conc", "standard")
	evt, err := evtSvc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "Concurrent Ticket Event",
		Slug:      "concurrent-ticket-event-" + uuid.NewString()[:8],
		EventType: "community",
		StartAt:   time.Now().Add(24 * time.Hour),
		EndAt:     time.Now().Add(28 * time.Hour),
		Venue:     "Jakarta",
	})
	if err != nil {
		t.Fatalf("CreateEvent failed: %v", err)
	}

	tt, err := tktSvc.CreateTicketType(ctx, evt.ID, organizer.ID, ticketing.CreateTicketTypeInput{
		Name:       "Last Seat",
		Price:      0,
		Currency:   "IDR",
		Quota:      1,
		SalesEndAt: time.Now().Add(23 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateTicketType failed: %v", err)
	}

	var wg sync.WaitGroup
	results := make(chan error, 2)
	start := make(chan struct{})

	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			_, err := tktSvc.ReserveOrder(ctx, ticketing.ReserveOrderInput{
				EventID:       evt.ID,
				TicketTypeID:  tt.ID,
				BuyerEmail:    fmt.Sprintf("buyer%d@example.com", idx),
				PaymentMethod: "free",
				Attendees: []ticketing.AttendeeInput{
					{Name: fmt.Sprintf("Buyer %d", idx), Email: fmt.Sprintf("buyer%d@example.com", idx)},
				},
			})
			results <- err
		}(i)
	}

	close(start)
	wg.Wait()
	close(results)

	var successes, outOfStock int
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, ticketing.ErrOutOfStock) {
			outOfStock++
		} else {
			t.Fatalf("unexpected error: %v", err)
		}
	}

	if successes != 1 || outOfStock != 1 {
		t.Fatalf("expected 1 success and 1 ErrOutOfStock, got successes=%d, outOfStock=%d", successes, outOfStock)
	}
}

func TestAgencyAllocationAndIssuance_EnforcesQuotaLimit(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	idSvc := identity.NewService(pool, testJWTSecret)
	evtSvc := events.NewService(pool, idSvc, nil)
	tktSvc := ticketing.NewService(pool, idSvc, testQRHMACSecret)

	organizer := createTestUser(t, pool, "org-ag", "standard")
	agency := createTestUser(t, pool, "agency-usr", "agency")

	evt, err := evtSvc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "Agency Quota Event",
		Slug:      "agency-quota-event-" + uuid.NewString()[:8],
		EventType: "conference",
		StartAt:   time.Now().Add(48 * time.Hour),
		EndAt:     time.Now().Add(52 * time.Hour),
		Venue:     "Bandung",
	})
	if err != nil {
		t.Fatalf("CreateEvent failed: %v", err)
	}

	tt, err := tktSvc.CreateTicketType(ctx, evt.ID, organizer.ID, ticketing.CreateTicketTypeInput{
		Name:       "General Pass",
		Price:      100000,
		Currency:   "IDR",
		Quota:      5,
		SalesEndAt: time.Now().Add(47 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateTicketType failed: %v", err)
	}

	ea, err := tktSvc.AllocateAgencyQuota(ctx, evt.ID, organizer.ID, ticketing.AllocateAgencyInput{
		AgencyUserID: agency.ID,
		TicketTypeID: tt.ID,
		QuotaLimit:   2,
	})
	if err != nil {
		t.Fatalf("AllocateAgencyQuota failed: %v", err)
	}
	if ea.QuotaLimit != 2 || ea.IssuedCount != 0 {
		t.Fatalf("unexpected EventAgency: %+v", ea)
	}

	// Verify allocated_agency_quota is carved out of ticket_types.quota
	var allocatedQuota int
	if err := pool.QueryRow(ctx, "SELECT allocated_agency_quota FROM ticket_types WHERE id = $1", tt.ID).Scan(&allocatedQuota); err != nil {
		t.Fatalf("query allocated_agency_quota failed: %v", err)
	}
	if allocatedQuota != 2 {
		t.Fatalf("expected allocated_agency_quota=2, got %d", allocatedQuota)
	}

	// Issue 2 tickets with claim_token
	tickets, err := tktSvc.IssueAgencyTickets(ctx, agency.ID, evt.ID, ticketing.IssueAgencyTicketsInput{
		TicketTypeID: tt.ID,
		Attendees: []ticketing.AttendeeInput{
			{Name: "Guest One", Email: "g1@example.com"},
			{Name: "Guest Two", Email: "g2@example.com"},
		},
	})
	if err != nil {
		t.Fatalf("IssueAgencyTickets failed: %v", err)
	}
	if len(tickets) != 2 {
		t.Fatalf("expected 2 tickets, got %d", len(tickets))
	}
	for _, tk := range tickets {
		if tk.ClaimToken == nil || *tk.ClaimToken == "" {
			t.Fatalf("expected non-empty claim_token on agency ticket %s", tk.ID)
		}
	}

	// 3rd ticket must fail with ErrAgencyQuotaExceeded
	_, err = tktSvc.IssueAgencyTickets(ctx, agency.ID, evt.ID, ticketing.IssueAgencyTicketsInput{
		TicketTypeID: tt.ID,
		Attendees: []ticketing.AttendeeInput{
			{Name: "Guest Three", Email: "g3@example.com"},
		},
	})
	if !errors.Is(err, ticketing.ErrAgencyQuotaExceeded) {
		t.Fatalf("expected ErrAgencyQuotaExceeded, got %v", err)
	}
}

func TestClaimTicket_BindsToStandardUser(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	idSvc := identity.NewService(pool, testJWTSecret)
	evtSvc := events.NewService(pool, idSvc, nil)
	tktSvc := ticketing.NewService(pool, idSvc, testQRHMACSecret)

	organizer := createTestUser(t, pool, "org-claim", "standard")
	user1 := createTestUser(t, pool, "claimer1", "standard")
	user2 := createTestUser(t, pool, "claimer2", "standard")

	evt, err := evtSvc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "Claim Ticket Event",
		Slug:      "claim-ticket-event-" + uuid.NewString()[:8],
		EventType: "meetup_ted",
		StartAt:   time.Now().Add(24 * time.Hour),
		EndAt:     time.Now().Add(26 * time.Hour),
		Venue:     "Surabaya",
	})
	if err != nil {
		t.Fatalf("CreateEvent failed: %v", err)
	}

	tt, err := tktSvc.CreateTicketType(ctx, evt.ID, organizer.ID, ticketing.CreateTicketTypeInput{
		Name:       "Free Guest Pass",
		Price:      0,
		Currency:   "IDR",
		Quota:      5,
		SalesEndAt: time.Now().Add(23 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateTicketType failed: %v", err)
	}

	// Guest checkout (buyer_user_id is nil)
	order, err := tktSvc.ReserveOrder(ctx, ticketing.ReserveOrderInput{
		EventID:       evt.ID,
		TicketTypeID:  tt.ID,
		BuyerUserID:   nil,
		BuyerEmail:    "guest@example.com",
		PaymentMethod: "free",
		Attendees: []ticketing.AttendeeInput{
			{Name: "Guest Attendee", Email: "guest@example.com"},
		},
	})
	if err != nil {
		t.Fatalf("ReserveOrder guest failed: %v", err)
	}
	if len(order.Tickets) != 1 || order.Tickets[0].ClaimToken == nil || *order.Tickets[0].ClaimToken == "" {
		t.Fatalf("expected 1 ticket with claim_token, got %+v", order.Tickets)
	}

	claimToken := *order.Tickets[0].ClaimToken

	claimed, err := tktSvc.ClaimTicket(ctx, user1.ID, claimToken)
	if err != nil {
		t.Fatalf("ClaimTicket failed: %v", err)
	}
	if claimed.ClaimedByUserID == nil || *claimed.ClaimedByUserID != user1.ID {
		t.Fatalf("expected claimed_by_user_id=%s, got %v", user1.ID, claimed.ClaimedByUserID)
	}

	// Double-claim by another user must be rejected
	_, err = tktSvc.ClaimTicket(ctx, user2.ID, claimToken)
	if !errors.Is(err, ticketing.ErrAlreadyClaimed) {
		t.Fatalf("expected ErrAlreadyClaimed on double-claim, got %v", err)
	}
}

func TestReserveOrder_RequiresAcceptedCFP(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	idSvc := identity.NewService(pool, testJWTSecret)
	evtSvc := events.NewService(pool, idSvc, nil)
	tktSvc := ticketing.NewService(pool, idSvc, testQRHMACSecret)

	organizer := createTestUser(t, pool, "org-cfp", "standard")
	speaker := createTestUser(t, pool, "speaker", "standard")

	evt, err := evtSvc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "CFP Presenter Event",
		Slug:      "cfp-presenter-event-" + uuid.NewString()[:8],
		EventType: "conference",
		StartAt:   time.Now().Add(24 * time.Hour),
		EndAt:     time.Now().Add(28 * time.Hour),
		Venue:     "Bali",
	})
	if err != nil {
		t.Fatalf("CreateEvent failed: %v", err)
	}

	tt, err := tktSvc.CreateTicketType(ctx, evt.ID, organizer.ID, ticketing.CreateTicketTypeInput{
		Name:                "Presenter Pass",
		Price:               0,
		Currency:            "IDR",
		Quota:               10,
		RequiresAcceptedCFP: true,
		SalesEndAt:          time.Now().Add(23 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateTicketType failed: %v", err)
	}

	// Without accepted CFP, reservation must fail with ErrCFPRequired
	_, err = tktSvc.ReserveOrder(ctx, ticketing.ReserveOrderInput{
		EventID:       evt.ID,
		TicketTypeID:  tt.ID,
		BuyerUserID:   &speaker.ID,
		BuyerEmail:    speaker.Email,
		PaymentMethod: "free",
		Attendees:     []ticketing.AttendeeInput{{Name: speaker.Name, Email: speaker.Email}},
	})
	if !errors.Is(err, ticketing.ErrCFPRequired) {
		t.Fatalf("expected ErrCFPRequired without accepted CFP, got %v", err)
	}

	// Insert accepted CFP submission
	_, err = pool.Exec(ctx, `
		INSERT INTO cfp_submissions (id, event_id, author_user_id, title, status, created_at, updated_at)
		VALUES ($1, $2, $3, 'Go Concurrency', 'accepted', NOW(), NOW())
	`, uuid.NewString(), evt.ID, speaker.ID)
	if err != nil {
		t.Fatalf("insert cfp_submissions failed: %v", err)
	}

	// Now reservation succeeds
	ord, err := tktSvc.ReserveOrder(ctx, ticketing.ReserveOrderInput{
		EventID:       evt.ID,
		TicketTypeID:  tt.ID,
		BuyerUserID:   &speaker.ID,
		BuyerEmail:    speaker.Email,
		PaymentMethod: "free",
		Attendees:     []ticketing.AttendeeInput{{Name: speaker.Name, Email: speaker.Email}},
	})
	if err != nil {
		t.Fatalf("ReserveOrder with accepted CFP failed: %v", err)
	}
	if len(ord.Tickets) != 1 || ord.PaymentStatus != "paid" {
		t.Fatalf("unexpected order result: %+v", ord)
	}
}
