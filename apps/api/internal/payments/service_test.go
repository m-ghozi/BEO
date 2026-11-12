package payments_test

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cerdas-club/beo/apps/api/internal/events"
	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/ledger"
	"github.com/cerdas-club/beo/apps/api/internal/payments"
	"github.com/cerdas-club/beo/apps/api/internal/platform"
	"github.com/cerdas-club/beo/apps/api/internal/ticketing"
)

const (
	testJWTSecret          = "test-jwt-secret-for-payments-32b"
	testQRHMACSecret       = "test-qr-hmac-secret-for-payments-32b"
	testDuitkuMerchantCode = "D1234"
	testDuitkuAPIKey       = "test_duitku_api_key"
)

type stubDuitkuClient struct {
	paymentURL string
	reference  string
	err        error
}

func (s *stubDuitkuClient) CreateInvoice(_ context.Context, _ payments.DuitkuCreateInvoiceRequest) (payments.DuitkuCreateInvoiceResponse, error) {
	if s.err != nil {
		return payments.DuitkuCreateInvoiceResponse{}, s.err
	}
	return payments.DuitkuCreateInvoiceResponse{
		PaymentURL:    s.paymentURL,
		Reference:     s.reference,
		StatusCode:    "00",
		StatusMessage: "SUCCESS",
	}, nil
}

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

func createPublishedEvent(t *testing.T, pool *pgxpool.Pool, identitySvc *identity.Service, organizerID, eventType string) events.Event {
	t.Helper()
	ctx := context.Background()
	eventSvc := events.NewService(pool, identitySvc, nil)
	ev, err := eventSvc.CreateEvent(ctx, organizerID, events.CreateEventInput{
		Title:     "Test Event " + uuid.NewString()[:6],
		Slug:      "test-event-" + uuid.NewString()[:8],
		EventType: events.EventType(eventType),
		StartAt:   time.Now().Add(24 * time.Hour),
		EndAt:     time.Now().Add(48 * time.Hour),
		Venue:     "Jakarta",
	})
	if err != nil {
		t.Fatalf("failed to create event: %v", err)
	}
	if _, err := pool.Exec(ctx, "UPDATE events SET status = 'published' WHERE id = $1", ev.ID); err != nil {
		t.Fatalf("failed to publish event: %v", err)
	}
	return ev
}

func duitkuSignature(merchantCode, amount, merchantOrderID, apiKey string) string {
	sum := md5.Sum([]byte(merchantCode + amount + merchantOrderID + apiKey))
	return hex.EncodeToString(sum[:])
}

func TestHandleDuitkuWebhook_IdempotentConfirmationAndLedger(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	identitySvc := identity.NewService(pool, testJWTSecret)
	organizer := createTestUser(t, pool, "org-duitku", "standard")
	buyer := createTestUser(t, pool, "buyer-duitku", "standard")
	ev := createPublishedEvent(t, pool, identitySvc, organizer.ID, "conference")

	salesStart := time.Now().Add(-1 * time.Hour)
	ticketingSvc := ticketing.NewService(pool, identitySvc, testQRHMACSecret)
	tt, err := ticketingSvc.CreateTicketType(ctx, ev.ID, organizer.ID, ticketing.CreateTicketTypeInput{
		Name:         "Conference Pass",
		Price:        100000,
		Currency:     "IDR",
		Quota:        10,
		SalesStartAt: &salesStart,
		SalesEndAt:   time.Now().Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateTicketType failed: %v", err)
	}

	ord, err := ticketingSvc.ReserveOrder(ctx, ticketing.ReserveOrderInput{
		EventID:       ev.ID,
		TicketTypeID:  tt.ID,
		BuyerUserID:   &buyer.ID,
		BuyerEmail:    buyer.Email,
		PaymentMethod: "duitku",
		Attendees: []ticketing.AttendeeInput{
			{Name: "Alice", Email: "alice@example.com"},
		},
	})
	if err != nil {
		t.Fatalf("ReserveOrder failed: %v", err)
	}

	ledgerSvc := ledger.NewService(pool)
	paymentSvc := payments.NewService(
		pool,
		identitySvc,
		ledgerSvc,
		&stubDuitkuClient{paymentURL: "https://sandbox.duitku.com/pay/123", reference: "REF-123"},
		testQRHMACSecret,
		testDuitkuMerchantCode,
		testDuitkuAPIKey,
		"https://api.cerdas.club/v1/webhooks/duitku",
		"https://cerdas.club/orders/return",
	)

	cb := payments.DuitkuCallback{
		MerchantCode:    testDuitkuMerchantCode,
		Amount:          "100000",
		MerchantOrderID: ord.ID,
		ResultCode:      "00",
		Reference:       "DUITKU-REF-1",
		Signature:       duitkuSignature(testDuitkuMerchantCode, "100000", ord.ID, testDuitkuAPIKey),
	}

	if err := paymentSvc.HandleDuitkuWebhook(ctx, cb); err != nil {
		t.Fatalf("first HandleDuitkuWebhook failed: %v", err)
	}
	// Second delivery must be idempotent and return nil without duplicating rows.
	if err := paymentSvc.HandleDuitkuWebhook(ctx, cb); err != nil {
		t.Fatalf("second HandleDuitkuWebhook failed: %v", err)
	}

	var paymentStatus string
	if err := pool.QueryRow(ctx, "SELECT payment_status FROM orders WHERE id = $1", ord.ID).Scan(&paymentStatus); err != nil {
		t.Fatalf("query order status: %v", err)
	}
	if paymentStatus != "paid" {
		t.Fatalf("expected payment_status 'paid', got %q", paymentStatus)
	}

	var validTicketCount int
	var qrSig string
	if err := pool.QueryRow(ctx, "SELECT COUNT(*), MAX(qr_signature) FROM tickets WHERE order_id = $1 AND status = 'valid'", ord.ID).Scan(&validTicketCount, &qrSig); err != nil {
		t.Fatalf("query tickets: %v", err)
	}
	if validTicketCount != 1 {
		t.Fatalf("expected 1 valid ticket, got %d", validTicketCount)
	}
	if qrSig == "" {
		t.Fatalf("expected non-empty qr_signature on confirmed ticket")
	}

	var soldCount, reservedCount int
	if err := pool.QueryRow(ctx, "SELECT sold_count, reserved_count FROM ticket_types WHERE id = $1", tt.ID).Scan(&soldCount, &reservedCount); err != nil {
		t.Fatalf("query ticket_types counts: %v", err)
	}
	if soldCount != 1 || reservedCount != 0 {
		t.Fatalf("expected sold_count=1, reserved_count=0; got sold=%d, reserved=%d", soldCount, reservedCount)
	}

	var grossCount, commCount int
	var grossSum, commSum float64
	err = pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE entry_type = 'ticket_sale_gross'),
			COALESCE(SUM(amount) FILTER (WHERE entry_type = 'ticket_sale_gross'), 0),
			COUNT(*) FILTER (WHERE entry_type = 'platform_commission'),
			COALESCE(SUM(amount) FILTER (WHERE entry_type = 'platform_commission'), 0)
		FROM ledger_entries
		WHERE order_id = $1
	`, ord.ID).Scan(&grossCount, &grossSum, &commCount, &commSum)
	if err != nil {
		t.Fatalf("query ledger_entries: %v", err)
	}
	if grossCount != 1 || commCount != 1 {
		t.Fatalf("expected 1 gross and 1 commission ledger entry, got gross=%d, comm=%d", grossCount, commCount)
	}
	if grossSum != 100000 {
		t.Fatalf("expected grossSum=100000, got %v", grossSum)
	}
	if commSum != -5000 {
		t.Fatalf("expected commSum=-5000 (5%% for conference), got %v", commSum)
	}

	bal, err := ledgerSvc.GetBalance(ctx, organizer.ID)
	if err != nil {
		t.Fatalf("GetBalance failed: %v", err)
	}
	if bal != 95000 {
		t.Fatalf("expected organizer balance 95000, got %d", bal)
	}
}

func TestVerifyManualOrder_RejectReleasesQuota(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	identitySvc := identity.NewService(pool, testJWTSecret)
	organizer := createTestUser(t, pool, "org-manual", "standard")
	buyer := createTestUser(t, pool, "buyer-manual", "standard")
	ev := createPublishedEvent(t, pool, identitySvc, organizer.ID, "seminar_workshop")

	salesStart := time.Now().Add(-1 * time.Hour)
	ticketingSvc := ticketing.NewService(pool, identitySvc, testQRHMACSecret)
	tt, err := ticketingSvc.CreateTicketType(ctx, ev.ID, organizer.ID, ticketing.CreateTicketTypeInput{
		Name:         "Workshop Pass",
		Price:        50000,
		Currency:     "IDR",
		Quota:        5,
		SalesStartAt: &salesStart,
		SalesEndAt:   time.Now().Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateTicketType failed: %v", err)
	}

	ord, err := ticketingSvc.ReserveOrder(ctx, ticketing.ReserveOrderInput{
		EventID:       ev.ID,
		TicketTypeID:  tt.ID,
		BuyerUserID:   &buyer.ID,
		BuyerEmail:    buyer.Email,
		PaymentMethod: "manual_transfer",
		Attendees: []ticketing.AttendeeInput{
			{Name: "Bob", Email: "bob@example.com"},
		},
	})
	if err != nil {
		t.Fatalf("ReserveOrder failed: %v", err)
	}

	ledgerSvc := ledger.NewService(pool)
	paymentSvc := payments.NewService(
		pool,
		identitySvc,
		ledgerSvc,
		&stubDuitkuClient{},
		testQRHMACSecret,
		testDuitkuMerchantCode,
		testDuitkuAPIKey,
		"",
		"",
	)

	if err := paymentSvc.SubmitManualProof(ctx, ord.ID, "https://storage.example.com/proof-123.jpg"); err != nil {
		t.Fatalf("SubmitManualProof failed: %v", err)
	}

	if err := paymentSvc.VerifyManualOrder(ctx, ord.ID, organizer.ID, false, "blurry receipt"); err != nil {
		t.Fatalf("VerifyManualOrder reject failed: %v", err)
	}

	var paymentStatus string
	if err := pool.QueryRow(ctx, "SELECT payment_status FROM orders WHERE id = $1", ord.ID).Scan(&paymentStatus); err != nil {
		t.Fatalf("query order status: %v", err)
	}
	if paymentStatus != "rejected" {
		t.Fatalf("expected payment_status 'rejected', got %q", paymentStatus)
	}

	var reservedCount, soldCount int
	if err := pool.QueryRow(ctx, "SELECT reserved_count, sold_count FROM ticket_types WHERE id = $1", tt.ID).Scan(&reservedCount, &soldCount); err != nil {
		t.Fatalf("query ticket_types: %v", err)
	}
	if reservedCount != 0 || soldCount != 0 {
		t.Fatalf("expected reserved_count=0 and sold_count=0, got reserved=%d, sold=%d", reservedCount, soldCount)
	}

	var validTickets int
	if err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM tickets WHERE order_id = $1 AND status = 'valid'", ord.ID).Scan(&validTickets); err != nil {
		t.Fatalf("query valid tickets: %v", err)
	}
	if validTickets != 0 {
		t.Fatalf("expected 0 valid tickets, got %d", validTickets)
	}

	var ledgerCount int
	if err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM ledger_entries WHERE order_id = $1", ord.ID).Scan(&ledgerCount); err != nil {
		t.Fatalf("query ledger_entries: %v", err)
	}
	if ledgerCount != 0 {
		t.Fatalf("expected 0 ledger_entries, got %d", ledgerCount)
	}

	var auditOrderID, auditReason string
	var auditApprove bool
	err = pool.QueryRow(ctx, `
		SELECT payload->>'order_id', (payload->>'approve')::boolean, payload->>'reason'
		FROM audit_events
		WHERE event_id = $1 AND actor_id = $2 AND event_category = 'manual_payment_verification'
	`, ev.ID, organizer.ID).Scan(&auditOrderID, &auditApprove, &auditReason)
	if err != nil {
		t.Fatalf("query manual_payment_verification audit_events: %v", err)
	}
	if auditOrderID != ord.ID || auditApprove != false || auditReason != "blurry receipt" {
		t.Fatalf("unexpected audit payload: order_id=%q approve=%v reason=%q", auditOrderID, auditApprove, auditReason)
	}
}

func TestRequestPayout_PreventsOverdraw(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	identitySvc := identity.NewService(pool, testJWTSecret)
	organizer := createTestUser(t, pool, "org-payout", "standard")
	buyer := createTestUser(t, pool, "buyer-payout", "standard")
	ev := createPublishedEvent(t, pool, identitySvc, organizer.ID, "conference")

	salesStart := time.Now().Add(-1 * time.Hour)
	ticketingSvc := ticketing.NewService(pool, identitySvc, testQRHMACSecret)
	tt, err := ticketingSvc.CreateTicketType(ctx, ev.ID, organizer.ID, ticketing.CreateTicketTypeInput{
		Name:         "VIP Pass",
		Price:        200000,
		Currency:     "IDR",
		Quota:        10,
		SalesStartAt: &salesStart,
		SalesEndAt:   time.Now().Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateTicketType failed: %v", err)
	}

	ord, err := ticketingSvc.ReserveOrder(ctx, ticketing.ReserveOrderInput{
		EventID:       ev.ID,
		TicketTypeID:  tt.ID,
		BuyerUserID:   &buyer.ID,
		BuyerEmail:    buyer.Email,
		PaymentMethod: "manual_transfer",
		Attendees: []ticketing.AttendeeInput{
			{Name: "Carol", Email: "carol@example.com"},
		},
	})
	if err != nil {
		t.Fatalf("ReserveOrder failed: %v", err)
	}

	ledgerSvc := ledger.NewService(pool)
	paymentSvc := payments.NewService(
		pool,
		identitySvc,
		ledgerSvc,
		&stubDuitkuClient{},
		testQRHMACSecret,
		testDuitkuMerchantCode,
		testDuitkuAPIKey,
		"",
		"",
	)

	if err := paymentSvc.SubmitManualProof(ctx, ord.ID, "https://storage.example.com/proof-vip.jpg"); err != nil {
		t.Fatalf("SubmitManualProof failed: %v", err)
	}
	if err := paymentSvc.VerifyManualOrder(ctx, ord.ID, organizer.ID, true, "verified"); err != nil {
		t.Fatalf("VerifyManualOrder approve failed: %v", err)
	}

	// 200,000 gross - 5% (10,000) = 190,000 available.
	bal, err := ledgerSvc.GetBalance(ctx, organizer.ID)
	if err != nil {
		t.Fatalf("GetBalance failed: %v", err)
	}
	if bal != 190000 {
		t.Fatalf("expected initial balance 190000, got %d", bal)
	}

	// Overdraw attempt should fail with ErrInsufficientBalance.
	_, err = ledgerSvc.RequestPayout(ctx, organizer.ID, ledger.PayoutInput{
		Amount:            190001,
		BankName:          "BCA",
		BankAccountNumber: "1234567890",
		BankAccountName:   "Organizer Name",
	})
	if !errors.Is(err, ledger.ErrInsufficientBalance) {
		t.Fatalf("expected ErrInsufficientBalance on overdraw, got %v", err)
	}

	// Request valid payout within balance.
	pr, err := ledgerSvc.RequestPayout(ctx, organizer.ID, ledger.PayoutInput{
		Amount:            100000,
		BankName:          "BCA",
		BankAccountNumber: "1234567890",
		BankAccountName:   "Organizer Name",
	})
	if err != nil {
		t.Fatalf("RequestPayout failed: %v", err)
	}
	if pr.Amount != 100000 || pr.Status != "pending" {
		t.Fatalf("unexpected payout request: %+v", pr)
	}

	balAfter, err := ledgerSvc.GetBalance(ctx, organizer.ID)
	if err != nil {
		t.Fatalf("GetBalance after payout failed: %v", err)
	}
	if balAfter != 90000 {
		t.Fatalf("expected remaining balance 90000, got %d", balAfter)
	}

	// Second payout exceeding remaining 90,000 should fail.
	_, err = ledgerSvc.RequestPayout(ctx, organizer.ID, ledger.PayoutInput{
		Amount:            90001,
		BankName:          "BCA",
		BankAccountNumber: "1234567890",
		BankAccountName:   "Organizer Name",
	})
	if !errors.Is(err, ledger.ErrInsufficientBalance) {
		t.Fatalf("expected ErrInsufficientBalance on second overdraw, got %v", err)
	}

	var auditPayoutID string
	var auditAmount int64
	err = pool.QueryRow(ctx, `
		SELECT payload->>'payout_id', (payload->>'amount')::bigint
		FROM audit_events
		WHERE actor_id = $1 AND event_category = 'payout_requested'
	`, organizer.ID).Scan(&auditPayoutID, &auditAmount)
	if err != nil {
		t.Fatalf("query payout_requested audit_events: %v", err)
	}
	if auditPayoutID != pr.ID || auditAmount != 100000 {
		t.Fatalf("unexpected payout audit payload: payout_id=%q amount=%d", auditPayoutID, auditAmount)
	}
}

func TestHandleDuitkuWebhook_RejectsEmptyAPIKeyAndAmountMismatch(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	identitySvc := identity.NewService(pool, testJWTSecret)
	organizer := createTestUser(t, pool, "org-guard", "standard")
	buyer := createTestUser(t, pool, "buyer-guard", "standard")
	ev := createPublishedEvent(t, pool, identitySvc, organizer.ID, "conference")

	salesStart := time.Now().Add(-1 * time.Hour)
	ticketingSvc := ticketing.NewService(pool, identitySvc, testQRHMACSecret)
	tt, err := ticketingSvc.CreateTicketType(ctx, ev.ID, organizer.ID, ticketing.CreateTicketTypeInput{
		Name:         "Guard Pass",
		Price:        100000,
		Currency:     "IDR",
		Quota:        5,
		SalesStartAt: &salesStart,
		SalesEndAt:   time.Now().Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateTicketType failed: %v", err)
	}

	ord, err := ticketingSvc.ReserveOrder(ctx, ticketing.ReserveOrderInput{
		EventID:       ev.ID,
		TicketTypeID:  tt.ID,
		BuyerUserID:   &buyer.ID,
		BuyerEmail:    buyer.Email,
		PaymentMethod: "duitku",
		Attendees: []ticketing.AttendeeInput{
			{Name: "Dan", Email: "dan@example.com"},
		},
	})
	if err != nil {
		t.Fatalf("ReserveOrder failed: %v", err)
	}

	ledgerSvc := ledger.NewService(pool)

	// 1. Empty API key must be rejected even if signature matches empty key.
	emptyKeySvc := payments.NewService(
		pool,
		identitySvc,
		ledgerSvc,
		&stubDuitkuClient{},
		testQRHMACSecret,
		testDuitkuMerchantCode,
		"",
		"",
		"",
	)
	err = emptyKeySvc.HandleDuitkuWebhook(ctx, payments.DuitkuCallback{
		MerchantCode:    testDuitkuMerchantCode,
		Amount:          "100000",
		MerchantOrderID: ord.ID,
		ResultCode:      "00",
		Signature:       duitkuSignature(testDuitkuMerchantCode, "100000", ord.ID, ""),
	})
	if !errors.Is(err, payments.ErrInvalidSignature) {
		t.Fatalf("expected ErrInvalidSignature for empty API key, got %v", err)
	}

	// 2. Valid signature with mismatched amount must be rejected without confirming order.
	paymentSvc := payments.NewService(
		pool,
		identitySvc,
		ledgerSvc,
		&stubDuitkuClient{},
		testQRHMACSecret,
		testDuitkuMerchantCode,
		testDuitkuAPIKey,
		"",
		"",
	)
	err = paymentSvc.HandleDuitkuWebhook(ctx, payments.DuitkuCallback{
		MerchantCode:    testDuitkuMerchantCode,
		Amount:          "50000",
		MerchantOrderID: ord.ID,
		ResultCode:      "00",
		Signature:       duitkuSignature(testDuitkuMerchantCode, "50000", ord.ID, testDuitkuAPIKey),
	})
	if !errors.Is(err, payments.ErrAmountMismatch) {
		t.Fatalf("expected ErrAmountMismatch for mismatched amount, got %v", err)
	}

	var paymentStatus string
	if err := pool.QueryRow(ctx, "SELECT payment_status FROM orders WHERE id = $1", ord.ID).Scan(&paymentStatus); err != nil {
		t.Fatalf("query order status: %v", err)
	}
	if paymentStatus != "pending" {
		t.Fatalf("expected order to remain 'pending', got %q", paymentStatus)
	}
}
