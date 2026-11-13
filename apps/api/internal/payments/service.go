package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/ledger"
	"github.com/cerdas-club/beo/apps/api/internal/platform"
	"github.com/cerdas-club/beo/apps/api/internal/ticketing"
)

var (
	ErrInvalidInput      = errors.New("invalid input")
	ErrForbidden         = errors.New("forbidden")
	ErrOrderNotFound     = errors.New("order not found")
	ErrInvalidSignature  = errors.New("invalid duitku signature")
	ErrAmountMismatch    = errors.New("payment amount mismatch")
	ErrInvalidOrderState = errors.New("order is not in a valid state for this operation")
)

type Service struct {
	db                 *pgxpool.Pool
	identitySvc        *identity.Service
	ledgerSvc          *ledger.Service
	duitku             DuitkuClient
	qrHMACSecret       string
	duitkuMerchantCode string
	duitkuAPIKey       string
	callbackURL        string
	returnURL          string
	mailer             platform.Mailer
}

// SetMailer configures an optional Mailer for transactional ticket email dispatch.
func (s *Service) SetMailer(mailer platform.Mailer) {
	s.mailer = mailer
}

// NewService creates a new payments Service.
func NewService(
	db *pgxpool.Pool,
	identitySvc *identity.Service,
	ledgerSvc *ledger.Service,
	duitku DuitkuClient,
	qrHMACSecret string,
	duitkuMerchantCode string,
	duitkuAPIKey string,
	callbackURL string,
	returnURL string,
) *Service {
	return &Service{
		db:                 db,
		identitySvc:        identitySvc,
		ledgerSvc:          ledgerSvc,
		duitku:             duitku,
		qrHMACSecret:       qrHMACSecret,
		duitkuMerchantCode: strings.TrimSpace(duitkuMerchantCode),
		duitkuAPIKey:       strings.TrimSpace(duitkuAPIKey),
		callbackURL:        strings.TrimSpace(callbackURL),
		returnURL:          strings.TrimSpace(returnURL),
	}
}

// InitiateDuitku creates a Duitku payment invoice for a pending order and returns the payment URL.
func (s *Service) InitiateDuitku(ctx context.Context, orderID string) (string, error) {
	orderID = strings.TrimSpace(orderID)
	if orderID == "" {
		return "", ErrInvalidInput
	}
	if s.duitku == nil {
		return "", fmt.Errorf("duitku client is not configured")
	}

	var eventID, buyerEmail, paymentMethod, paymentStatus string
	var totalAmount float64
	err := s.db.QueryRow(ctx, `
		SELECT event_id, buyer_email, total_amount::float8, payment_method, payment_status
		FROM orders
		WHERE id = $1
	`, orderID).Scan(&eventID, &buyerEmail, &totalAmount, &paymentMethod, &paymentStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrOrderNotFound
		}
		return "", fmt.Errorf("query order for duitku: %w", err)
	}

	if paymentStatus != "pending" || totalAmount <= 0 || paymentMethod == "free" {
		return "", ErrInvalidOrderState
	}

	amount := int64(math.Round(totalAmount))
	sig := ComputeDuitkuInquirySignature(s.duitkuMerchantCode, orderID, amount, s.duitkuAPIKey)
	resp, err := s.duitku.CreateInvoice(ctx, DuitkuCreateInvoiceRequest{
		MerchantCode:    s.duitkuMerchantCode,
		PaymentAmount:   amount,
		MerchantOrderID: orderID,
		ProductDetails:  "Event Ticket Order " + orderID,
		Email:           buyerEmail,
		CallbackURL:     s.callbackURL,
		ReturnURL:       s.returnURL,
		Signature:       sig,
	})
	if err != nil {
		return "", fmt.Errorf("create duitku invoice: %w", err)
	}

	if resp.Reference != "" {
		if _, err := s.db.Exec(ctx, "UPDATE orders SET duitku_reference = $1, updated_at = NOW() WHERE id = $2", resp.Reference, orderID); err != nil {
			return "", fmt.Errorf("save duitku reference: %w", err)
		}
	}

	return resp.PaymentURL, nil
}

// HandleDuitkuWebhook verifies the Duitku callback signature and idempotently confirms
// the order, activates tickets with signed QR payloads, and records ledger entries.
func (s *Service) HandleDuitkuWebhook(ctx context.Context, payload DuitkuCallback) error {
	payload.MerchantCode = strings.TrimSpace(payload.MerchantCode)
	payload.MerchantOrderID = strings.TrimSpace(payload.MerchantOrderID)
	payload.Amount = strings.TrimSpace(payload.Amount)

	if payload.MerchantOrderID == "" || payload.MerchantCode == "" {
		return ErrInvalidInput
	}
	if s.duitkuAPIKey == "" {
		return fmt.Errorf("%w: duitku API key is not configured", ErrInvalidSignature)
	}
	if s.duitkuMerchantCode != "" && payload.MerchantCode != s.duitkuMerchantCode {
		return ErrInvalidSignature
	}
	if !VerifyDuitkuCallbackSignature(payload.MerchantCode, payload.Amount, payload.MerchantOrderID, s.duitkuAPIKey, payload.Signature) {
		return ErrInvalidSignature
	}

	// Only ResultCode "00" indicates a successful payment in Duitku.
	if payload.ResultCode != "00" {
		return nil
	}

	parsedAmount, err := strconv.ParseFloat(payload.Amount, 64)
	if err != nil {
		return fmt.Errorf("%w: invalid callback amount %q", ErrAmountMismatch, payload.Amount)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin duitku webhook tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var eventID, paymentStatus string
	var totalAmount float64
	err = tx.QueryRow(ctx, "SELECT event_id, payment_status, total_amount::float8 FROM orders WHERE id = $1 FOR UPDATE", payload.MerchantOrderID).Scan(&eventID, &paymentStatus, &totalAmount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrderNotFound
		}
		return fmt.Errorf("lock order: %w", err)
	}

	if math.Abs(parsedAmount-totalAmount) > 0.01 {
		return fmt.Errorf("%w: got %v, expected %v", ErrAmountMismatch, parsedAmount, totalAmount)
	}

	if paymentStatus == "paid" {
		return nil
	}
	if paymentStatus == "expired" {
		reconciled, err := s.reconcileLateDuitkuOrderTx(ctx, tx, eventID, payload.MerchantOrderID, strings.TrimSpace(payload.Reference), parsedAmount)
		if err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit duitku late-payment tx: %w", err)
		}
		if !reconciled {
			return ErrInvalidOrderState
		}
		if s.mailer != nil {
			ticketing.SendOrderTicketEmails(ctx, s.db, s.mailer, s.qrHMACSecret, payload.MerchantOrderID)
		}
		return nil
	}
	if paymentStatus != "pending" {
		return ErrInvalidOrderState
	}

	if _, err := tx.Exec(ctx, `
		UPDATE orders
		SET payment_status = 'paid',
		    duitku_reference = COALESCE(NULLIF($1, ''), duitku_reference),
		    updated_at = NOW()
		WHERE id = $2
	`, strings.TrimSpace(payload.Reference), payload.MerchantOrderID); err != nil {
		return fmt.Errorf("mark order paid: %w", err)
	}

	if err := s.confirmOrderTx(ctx, tx, payload.MerchantOrderID); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit duitku webhook tx: %w", err)
	}

	if s.mailer != nil {
		ticketing.SendOrderTicketEmails(ctx, s.db, s.mailer, s.qrHMACSecret, payload.MerchantOrderID)
	}

	return nil
}

// SubmitManualProof attaches a payment proof URL to an order and moves it to pending_verification.
func (s *Service) SubmitManualProof(ctx context.Context, orderID, proofURL string) error {
	orderID = strings.TrimSpace(orderID)
	proofURL = strings.TrimSpace(proofURL)
	if orderID == "" || proofURL == "" {
		return ErrInvalidInput
	}

	tag, err := s.db.Exec(ctx, `
		UPDATE orders
		SET proof_file_url = $1, payment_status = 'pending_verification', updated_at = NOW()
		WHERE id = $2 AND payment_status IN ('pending', 'pending_verification')
	`, proofURL, orderID)
	if err != nil {
		return fmt.Errorf("submit manual proof: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := s.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM orders WHERE id = $1)", orderID).Scan(&exists); err != nil {
			return fmt.Errorf("check order exists: %w", err)
		}
		if !exists {
			return ErrOrderNotFound
		}
		return ErrInvalidOrderState
	}

	return nil
}

// VerifyManualOrder allows an organizer or co_organizer to approve or reject a manual transfer order.
func (s *Service) VerifyManualOrder(ctx context.Context, orderID, actorID string, approve bool, reason string) error {
	orderID = strings.TrimSpace(orderID)
	actorID = strings.TrimSpace(actorID)
	if orderID == "" || actorID == "" {
		return ErrInvalidInput
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin verify manual tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var eventID, paymentStatus string
	err = tx.QueryRow(ctx, "SELECT event_id, payment_status FROM orders WHERE id = $1 FOR UPDATE", orderID).Scan(&eventID, &paymentStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrderNotFound
		}
		return fmt.Errorf("lock order for verification: %w", err)
	}

	hasRole, err := s.identitySvc.HasEventRole(ctx, eventID, actorID, "co_organizer")
	if err != nil {
		return fmt.Errorf("check event role: %w", err)
	}
	if !hasRole {
		return ErrForbidden
	}

	if paymentStatus == "paid" {
		if approve {
			return nil
		}
		return ErrInvalidOrderState
	}
	if paymentStatus != "pending" && paymentStatus != "pending_verification" {
		return ErrInvalidOrderState
	}

	if approve {
		if _, err := tx.Exec(ctx, "UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1", orderID); err != nil {
			return fmt.Errorf("mark order paid: %w", err)
		}
		if err := s.confirmOrderTx(ctx, tx, orderID); err != nil {
			return err
		}
	} else {
		if _, err := tx.Exec(ctx, "UPDATE orders SET payment_status = 'rejected', updated_at = NOW() WHERE id = $1", orderID); err != nil {
			return fmt.Errorf("mark order rejected: %w", err)
		}
		if err := s.rejectOrderTx(ctx, tx, orderID); err != nil {
			return err
		}
	}

	auditPayload, err := json.Marshal(map[string]any{
		"order_id": orderID,
		"approve":  approve,
		"reason":   strings.TrimSpace(reason),
	})
	if err != nil {
		return fmt.Errorf("marshal verification audit payload: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_events (id, event_id, actor_id, event_category, payload, created_at)
		VALUES ($1, $2, $3, 'manual_payment_verification', $4, NOW())
	`, uuid.NewString(), eventID, actorID, auditPayload); err != nil {
		return fmt.Errorf("insert verification audit event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit verify manual tx: %w", err)
	}

	if approve && s.mailer != nil {
		ticketing.SendOrderTicketEmails(ctx, s.db, s.mailer, s.qrHMACSecret, orderID)
	}

	return nil
}

type orderTicketRow struct {
	id           string
	ticketTypeID string
	ticketCode   string
	eventID      string
}

func (s *Service) lockOrderTickets(ctx context.Context, tx pgx.Tx, orderID string) ([]orderTicketRow, map[string]int, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, ticket_type_id, ticket_code, event_id
		FROM tickets
		WHERE order_id = $1
		FOR UPDATE
	`, orderID)
	if err != nil {
		return nil, nil, fmt.Errorf("lock order tickets: %w", err)
	}
	defer rows.Close()

	var tickets []orderTicketRow
	countsByType := make(map[string]int)
	for rows.Next() {
		var tk orderTicketRow
		if err := rows.Scan(&tk.id, &tk.ticketTypeID, &tk.ticketCode, &tk.eventID); err != nil {
			return nil, nil, fmt.Errorf("scan order ticket: %w", err)
		}
		tickets = append(tickets, tk)
		countsByType[tk.ticketTypeID]++
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate order tickets: %w", err)
	}

	return tickets, countsByType, nil
}

func (s *Service) confirmOrderTx(ctx context.Context, tx pgx.Tx, orderID string) error {
	tickets, countsByType, err := s.lockOrderTickets(ctx, tx, orderID)
	if err != nil {
		return err
	}

	for ttID, qty := range countsByType {
		if _, err := tx.Exec(ctx, `
			UPDATE ticket_types
			SET reserved_count = GREATEST(0, reserved_count - $1),
			    sold_count = sold_count + $1
			WHERE id = $2
		`, qty, ttID); err != nil {
			return fmt.Errorf("move reserved to sold: %w", err)
		}
	}

	for _, tk := range tickets {
		qrSig := ticketing.SignQR(s.qrHMACSecret, tk.ticketCode, tk.eventID)
		if _, err := tx.Exec(ctx, `
			UPDATE tickets
			SET status = 'valid', qr_signature = $1
			WHERE id = $2
		`, qrSig, tk.id); err != nil {
			return fmt.Errorf("activate ticket: %w", err)
		}
	}

	if err := s.ledgerSvc.RecordPaidOrder(ctx, tx, orderID); err != nil {
		return fmt.Errorf("record paid order in ledger: %w", err)
	}

	return nil
}

func (s *Service) rejectOrderTx(ctx context.Context, tx pgx.Tx, orderID string) error {
	_, countsByType, err := s.lockOrderTickets(ctx, tx, orderID)
	if err != nil {
		return err
	}

	for ttID, qty := range countsByType {
		if _, err := tx.Exec(ctx, `
			UPDATE ticket_types
			SET reserved_count = GREATEST(0, reserved_count - $1)
			WHERE id = $2
		`, qty, ttID); err != nil {
			return fmt.Errorf("release reserved quota: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE tickets
		SET status = 'cancelled'
		WHERE order_id = $1
	`, orderID); err != nil {
		return fmt.Errorf("cancel order tickets: %w", err)
	}

	return nil
}

func (s *Service) reconcileLateDuitkuOrderTx(ctx context.Context, tx pgx.Tx, eventID, orderID, reference string, amount float64) (bool, error) {
	tickets, countsByType, err := s.lockOrderTickets(ctx, tx, orderID)
	if err != nil {
		return false, err
	}

	overbooked := false
	for ttID, qty := range countsByType {
		var quota, soldCount, reservedCount, allocatedAgencyQuota int
		if err := tx.QueryRow(ctx, `
			SELECT quota, sold_count, reserved_count, allocated_agency_quota
			FROM ticket_types
			WHERE id = $1
			FOR UPDATE
		`, ttID).Scan(&quota, &soldCount, &reservedCount, &allocatedAgencyQuota); err != nil {
			return false, fmt.Errorf("lock ticket type for late payment: %w", err)
		}
		available := quota - soldCount - reservedCount - allocatedAgencyQuota
		if available < qty {
			overbooked = true
			break
		}
	}

	auditCategory := "late_payment_reconciled"
	if overbooked {
		auditCategory = "late_payment_overbooked"
	} else {
		if _, err := tx.Exec(ctx, `
			UPDATE orders
			SET payment_status = 'paid',
			    duitku_reference = COALESCE(NULLIF($1, ''), duitku_reference),
			    updated_at = NOW()
			WHERE id = $2
		`, reference, orderID); err != nil {
			return false, fmt.Errorf("reactivate expired order: %w", err)
		}

		for ttID, qty := range countsByType {
			if _, err := tx.Exec(ctx, `
				UPDATE ticket_types
				SET sold_count = sold_count + $1
				WHERE id = $2
			`, qty, ttID); err != nil {
				return false, fmt.Errorf("increment sold_count for late payment: %w", err)
			}
		}

		for _, tk := range tickets {
			qrSig := ticketing.SignQR(s.qrHMACSecret, tk.ticketCode, tk.eventID)
			if _, err := tx.Exec(ctx, `
				UPDATE tickets
				SET status = 'valid', qr_signature = $1
				WHERE id = $2
			`, qrSig, tk.id); err != nil {
				return false, fmt.Errorf("reactivate ticket for late payment: %w", err)
			}
		}

		if err := s.ledgerSvc.RecordPaidOrder(ctx, tx, orderID); err != nil {
			return false, fmt.Errorf("record late paid order in ledger: %w", err)
		}
	}

	auditPayload, err := json.Marshal(map[string]any{
		"order_id":         orderID,
		"duitku_reference": reference,
		"amount":           amount,
	})
	if err != nil {
		return false, fmt.Errorf("marshal late payment audit payload: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_events (id, event_id, actor_id, event_category, payload, created_at)
		VALUES ($1, $2, NULL, $3, $4, NOW())
	`, uuid.NewString(), eventID, auditCategory, auditPayload); err != nil {
		return false, fmt.Errorf("insert late payment audit event: %w", err)
	}

	return !overbooked, nil
}
