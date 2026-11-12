package ticketing_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/cerdas-club/beo/apps/api/internal/events"
	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/ticketing"
)

func TestGenerateQRAndPDF(t *testing.T) {
	// 1. Generate QR PNG
	payload := ticketing.SignQR(testQRHMACSecret, "BEO-TEST1234", "event-uuid-1234")
	qrPNG, err := ticketing.GenerateQRPNG(payload)
	if err != nil {
		t.Fatalf("unexpected error generating QR PNG: %v", err)
	}
	if len(qrPNG) == 0 {
		t.Fatal("expected non-empty QR PNG bytes")
	}
	// PNG magic bytes: \x89PNG\r\n\x1a\n
	pngMagic := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}
	if !bytes.HasPrefix(qrPNG, pngMagic) {
		t.Fatalf("expected PNG magic bytes header, got %x", qrPNG[:8])
	}

	// 2. Generate Ticket PDF
	pdfData := ticketing.TicketPDFData{
		TicketCode:     "BEO-TEST1234",
		EventTitle:     "BEO Developer Conference 2026",
		EventType:      "conference",
		Venue:          "Jakarta Convention Center",
		StartAt:        time.Date(2026, 12, 1, 9, 0, 0, 0, time.UTC),
		EndAt:          time.Date(2026, 12, 1, 17, 0, 0, 0, time.UTC),
		AttendeeName:   "Alice Developer",
		AttendeeEmail:  "alice@example.com",
		TicketTypeName: "VIP Pass",
		Price:          500000,
		Currency:       "IDR",
	}

	pdfBytes, err := ticketing.GenerateTicketPDF(pdfData, qrPNG)
	if err != nil {
		t.Fatalf("unexpected error generating ticket PDF: %v", err)
	}
	if len(pdfBytes) == 0 {
		t.Fatal("expected non-empty PDF bytes")
	}
	if !bytes.HasPrefix(pdfBytes, []byte("%PDF-")) {
		t.Fatalf("expected %%PDF- header, got %q", string(pdfBytes[:10]))
	}
}

func TestReleaseExpiredOrders(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()

	// Drain any leftover expired orders from prior test runs
	_, _ = ticketing.ReleaseExpiredOrders(ctx, pool)

	// 1. Create organizer and event
	organizer := createTestUser(t, pool, "expiry-org", "standard")
	eventsSvc := events.NewService(pool, identity.NewService(pool, testJWTSecret), nil)
	now := time.Now().UTC().Truncate(time.Second)
	ev, err := eventsSvc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "Expiry Test Conference " + uuid.NewString()[:8],
		Slug:      "expiry-test-conf-" + uuid.NewString()[:8],
		EventType: "conference",
		StartAt:   now.Add(24 * time.Hour),
		EndAt:     now.Add(48 * time.Hour),
		Venue:     "Main Hall",
	})
	if err != nil {
		t.Fatalf("failed to create test event: %v", err)
	}

	// 2. Create ticket type with quota=10, reserved_count=3 (2 for pending, 1 for pending_verification)
	ticketTypeID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO ticket_types (id, event_id, name, price, currency, quota, reserved_count, sold_count, sales_start_at, sales_end_at, created_at)
		VALUES ($1, $2, 'Standard Pass', 100000, 'IDR', 10, 3, 0, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', NOW())
	`, ticketTypeID, ev.ID)
	if err != nil {
		t.Fatalf("failed to insert ticket type: %v", err)
	}

	// 3. Insert order with expires_at < NOW() and payment_status='pending'
	orderID := uuid.NewString()
	expiredAt := time.Now().Add(-10 * time.Minute)
	_, err = pool.Exec(ctx, `
		INSERT INTO orders (id, event_id, buyer_email, total_amount, payment_method, payment_status, expires_at, created_at, updated_at)
		VALUES ($1, $2, 'expired-buyer@example.com', 200000, 'duitku', 'pending', $3, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes')
	`, orderID, ev.ID, expiredAt)
	if err != nil {
		t.Fatalf("failed to insert expired order: %v", err)
	}

	// 4. Insert 2 pending tickets for the pending order
	tkCode1 := "BEO-EXP1" + uuid.NewString()[:4]
	tkCode2 := "BEO-EXP2" + uuid.NewString()[:4]
	_, err = pool.Exec(ctx, `
		INSERT INTO tickets (id, order_id, ticket_type_id, event_id, attendee_name, attendee_email, ticket_code, qr_signature, status, created_at)
		VALUES 
			($1, $2, $3, $4, 'Attendee 1', 'att1@example.com', $5, '', 'pending', NOW()),
			($6, $2, $3, $4, 'Attendee 2', 'att2@example.com', $7, '', 'pending', NOW())
	`, uuid.NewString(), orderID, ticketTypeID, ev.ID, tkCode1, uuid.NewString(), tkCode2)
	if err != nil {
		t.Fatalf("failed to insert tickets: %v", err)
	}

	// 5. Insert an order with expires_at < NOW() and payment_status='pending_verification' (proof submitted)
	pendingVerificationOrderID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO orders (id, event_id, buyer_email, total_amount, payment_method, payment_status, proof_file_url, expires_at, created_at, updated_at)
		VALUES ($1, $2, 'proof-buyer@example.com', 100000, 'manual_transfer', 'pending_verification', 'https://example.com/receipt.jpg', $3, NOW() - INTERVAL '25 minutes', NOW() - INTERVAL '25 minutes')
	`, pendingVerificationOrderID, ev.ID, expiredAt)
	if err != nil {
		t.Fatalf("failed to insert pending_verification order: %v", err)
	}

	// Insert ticket for pending_verification order
	tkCodeProof := "BEO-PRF" + uuid.NewString()[:4]
	_, err = pool.Exec(ctx, `
		INSERT INTO tickets (id, order_id, ticket_type_id, event_id, attendee_name, attendee_email, ticket_code, qr_signature, status, created_at)
		VALUES ($1, $2, $3, $4, 'Proof Attendee', 'proof@example.com', $5, '', 'pending', NOW())
	`, uuid.NewString(), pendingVerificationOrderID, ticketTypeID, ev.ID, tkCodeProof)
	if err != nil {
		t.Fatalf("failed to insert pending_verification ticket: %v", err)
	}

	// 6. Run ReleaseExpiredOrders
	released, err := ticketing.ReleaseExpiredOrders(ctx, pool)
	if err != nil {
		t.Fatalf("ReleaseExpiredOrders failed: %v", err)
	}
	if released != 1 {
		t.Fatalf("expected exactly 1 order released, got %d", released)
	}

	// 7. Assert pending order becomes 'expired'
	var orderStatus string
	err = pool.QueryRow(ctx, "SELECT payment_status FROM orders WHERE id = $1", orderID).Scan(&orderStatus)
	if err != nil {
		t.Fatalf("failed to query order: %v", err)
	}
	if orderStatus != "expired" {
		t.Fatalf("expected order payment_status='expired', got %q", orderStatus)
	}

	// 8. Assert pending_verification order remains 'pending_verification' (NOT expired)
	var pvOrderStatus string
	err = pool.QueryRow(ctx, "SELECT payment_status FROM orders WHERE id = $1", pendingVerificationOrderID).Scan(&pvOrderStatus)
	if err != nil {
		t.Fatalf("failed to query pending_verification order: %v", err)
	}
	if pvOrderStatus != "pending_verification" {
		t.Fatalf("expected pending_verification order to remain 'pending_verification', got %q", pvOrderStatus)
	}

	// 9. Assert reserved_count == 1 (only pending order's 2 tickets released; 1 remains for pending_verification)
	var reservedCount int
	err = pool.QueryRow(ctx, "SELECT reserved_count FROM ticket_types WHERE id = $1", ticketTypeID).Scan(&reservedCount)
	if err != nil {
		t.Fatalf("failed to query ticket type: %v", err)
	}
	if reservedCount != 1 {
		t.Fatalf("expected reserved_count=1, got %d", reservedCount)
	}

	// 10. Assert tickets for expired order are 'cancelled'
	rows, err := pool.Query(ctx, "SELECT status FROM tickets WHERE order_id = $1", orderID)
	if err != nil {
		t.Fatalf("failed to query tickets: %v", err)
	}
	defer rows.Close()
	ticketCount := 0
	for rows.Next() {
		var status string
		if err := rows.Scan(&status); err != nil {
			t.Fatalf("failed to scan ticket status: %v", err)
		}
		ticketCount++
		if status != "cancelled" {
			t.Errorf("expected ticket status='cancelled', got %q", status)
		}
	}
	if ticketCount != 2 {
		t.Fatalf("expected 2 tickets, got %d", ticketCount)
	}

	// 11. Assert ticket for pending_verification order remains 'pending'
	var pvTicketStatus string
	err = pool.QueryRow(ctx, "SELECT status FROM tickets WHERE order_id = $1", pendingVerificationOrderID).Scan(&pvTicketStatus)
	if err != nil {
		t.Fatalf("failed to query pending_verification ticket: %v", err)
	}
	if pvTicketStatus != "pending" {
		t.Fatalf("expected pending_verification ticket status='pending', got %q", pvTicketStatus)
	}
}

func TestDownloadTicketEndpoints(t *testing.T) {
	pool := setupTestDB(t)
	ctx := context.Background()

	organizer := createTestUser(t, pool, "download-org", "standard")
	eventsSvc := events.NewService(pool, identity.NewService(pool, testJWTSecret), nil)
	now := time.Now().UTC().Truncate(time.Second)
	ev, err := eventsSvc.CreateEvent(ctx, organizer.ID, events.CreateEventInput{
		Title:     "Download Test Event " + uuid.NewString()[:8],
		Slug:      "download-test-event-" + uuid.NewString()[:8],
		EventType: "community",
		StartAt:   now.Add(24 * time.Hour),
		EndAt:     now.Add(28 * time.Hour),
		Venue:     "Community Center",
	})
	if err != nil {
		t.Fatalf("failed to create test event: %v", err)
	}

	ticketTypeID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO ticket_types (id, event_id, name, price, currency, quota, reserved_count, sold_count, sales_start_at, sales_end_at, created_at)
		VALUES ($1, $2, 'General Admission', 0, 'IDR', 50, 0, 1, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 hour', NOW())
	`, ticketTypeID, ev.ID)
	if err != nil {
		t.Fatalf("failed to insert ticket type: %v", err)
	}

	ticketCode := "BEO-DL" + strings.ToUpper(uuid.NewString()[:6])
	qrSig := ticketing.SignQR(testQRHMACSecret, ticketCode, ev.ID)
	_, err = pool.Exec(ctx, `
		INSERT INTO tickets (id, ticket_type_id, event_id, attendee_name, attendee_email, ticket_code, qr_signature, status, created_at)
		VALUES ($1, $2, $3, 'Bob Download', 'bob@example.com', $4, $5, 'valid', NOW())
	`, uuid.NewString(), ticketTypeID, ev.ID, ticketCode, qrSig)
	if err != nil {
		t.Fatalf("failed to insert ticket: %v", err)
	}

	ticketSvc := ticketing.NewService(pool, identity.NewService(pool, testJWTSecret), testQRHMACSecret)
	handler := ticketing.NewHandler(ticketSvc, testJWTSecret)
	mux := handler.Routes()

	// 1. GET /v1/tickets/{ticketCode}/qr.png
	qrReq := httptest.NewRequest(http.MethodGet, "/v1/tickets/"+ticketCode+"/qr.png", nil)
	qrRec := httptest.NewRecorder()
	mux.ServeHTTP(qrRec, qrReq)

	if qrRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from qr.png endpoint, got %d: %s", qrRec.Code, qrRec.Body.String())
	}
	if ct := qrRec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("expected Content-Type: image/png, got %q", ct)
	}
	pngMagic := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}
	if !bytes.HasPrefix(qrRec.Body.Bytes(), pngMagic) {
		t.Error("expected valid PNG response body")
	}

	// 2. GET /v1/tickets/{ticketCode}/pdf
	pdfReq := httptest.NewRequest(http.MethodGet, "/v1/tickets/"+ticketCode+"/pdf", nil)
	pdfRec := httptest.NewRecorder()
	mux.ServeHTTP(pdfRec, pdfReq)

	if pdfRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from pdf endpoint, got %d: %s", pdfRec.Code, pdfRec.Body.String())
	}
	if ct := pdfRec.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("expected Content-Type: application/pdf, got %q", ct)
	}
	if !bytes.HasPrefix(pdfRec.Body.Bytes(), []byte("%PDF-")) {
		t.Error("expected valid PDF response body")
	}
}
