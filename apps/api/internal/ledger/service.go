package ledger

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidInput        = errors.New("invalid input")
	ErrOrderNotFound       = errors.New("order not found")
	ErrOrganizerNotFound   = errors.New("organizer not found")
	ErrInsufficientBalance = errors.New("insufficient ledger balance")
)

type PayoutInput struct {
	Amount            int64  `json:"amount"`
	BankName          string `json:"bank_name"`
	BankAccountNumber string `json:"bank_account_number"`
	BankAccountName   string `json:"bank_account_name"`
}

type PayoutRequest struct {
	ID                string     `json:"id"`
	OrganizerID       string     `json:"organizer_id"`
	Amount            int64      `json:"amount"`
	BankName          string     `json:"bank_name"`
	BankAccountNumber string     `json:"bank_account_number"`
	BankAccountName   string     `json:"bank_account_name"`
	Status            string     `json:"status"`
	ProcessedAt       *time.Time `json:"processed_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

type Service struct {
	db *pgxpool.Pool
}

// NewService creates a new ledger Service backed by the given PostgreSQL pool.
func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// RecordPaidOrder calculates platform commission from category_commission_rates
// and inserts ticket_sale_gross and platform_commission entries inside the caller's tx.
func (s *Service) RecordPaidOrder(ctx context.Context, tx pgx.Tx, orderID string) error {
	orderID = strings.TrimSpace(orderID)
	if orderID == "" {
		return ErrInvalidInput
	}

	var eventID, organizerID string
	var totalAmount, commissionPercent float64
	query := `
		SELECT o.event_id, o.total_amount::float8, e.organizer_id, COALESCE(ccr.commission_percent, 0)::float8
		FROM orders o
		JOIN events e ON e.id = o.event_id
		LEFT JOIN category_commission_rates ccr ON ccr.event_category = e.event_type
		WHERE o.id = $1
	`
	err := tx.QueryRow(ctx, query, orderID).Scan(&eventID, &totalAmount, &organizerID, &commissionPercent)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrderNotFound
		}
		return fmt.Errorf("query order for ledger: %w", err)
	}

	if totalAmount <= 0 {
		return nil
	}

	commission := math.Round(totalAmount * commissionPercent / 100.0)

	insertEntry := `
		INSERT INTO ledger_entries (id, organizer_id, event_id, order_id, entry_type, amount, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
	`
	if _, err := tx.Exec(ctx, insertEntry, uuid.NewString(), organizerID, eventID, orderID, "ticket_sale_gross", totalAmount); err != nil {
		return fmt.Errorf("insert ticket_sale_gross: %w", err)
	}
	if _, err := tx.Exec(ctx, insertEntry, uuid.NewString(), organizerID, eventID, orderID, "platform_commission", -commission); err != nil {
		return fmt.Errorf("insert platform_commission: %w", err)
	}

	return nil
}

// GetBalance returns the current available ledger balance (in IDR) for an organizer.
func (s *Service) GetBalance(ctx context.Context, organizerID string) (int64, error) {
	organizerID = strings.TrimSpace(organizerID)
	if organizerID == "" {
		return 0, ErrInvalidInput
	}

	var balance int64
	err := s.db.QueryRow(ctx, `
		SELECT ROUND(COALESCE(SUM(amount), 0))::BIGINT
		FROM ledger_entries
		WHERE organizer_id = $1
	`, organizerID).Scan(&balance)
	if err != nil {
		return 0, fmt.Errorf("query organizer balance: %w", err)
	}

	return balance, nil
}

// RequestPayout atomically verifies available ledger balance, records a payout_requests row,
// and debits the organizer's ledger with a payout_debit entry.
func (s *Service) RequestPayout(ctx context.Context, organizerID string, in PayoutInput) (PayoutRequest, error) {
	organizerID = strings.TrimSpace(organizerID)
	in.BankName = strings.TrimSpace(in.BankName)
	in.BankAccountNumber = strings.TrimSpace(in.BankAccountNumber)
	in.BankAccountName = strings.TrimSpace(in.BankAccountName)

	if organizerID == "" || in.Amount <= 0 || in.BankName == "" || in.BankAccountNumber == "" || in.BankAccountName == "" {
		return PayoutRequest{}, ErrInvalidInput
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return PayoutRequest{}, fmt.Errorf("begin payout tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock organizer row to serialize concurrent payout requests for the same organizer.
	var lockedID string
	err = tx.QueryRow(ctx, "SELECT id FROM users WHERE id = $1 FOR UPDATE", organizerID).Scan(&lockedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PayoutRequest{}, ErrOrganizerNotFound
		}
		return PayoutRequest{}, fmt.Errorf("lock organizer: %w", err)
	}

	var balance int64
	err = tx.QueryRow(ctx, `
		SELECT ROUND(COALESCE(SUM(amount), 0))::BIGINT
		FROM ledger_entries
		WHERE organizer_id = $1
	`, organizerID).Scan(&balance)
	if err != nil {
		return PayoutRequest{}, fmt.Errorf("query balance in tx: %w", err)
	}

	if balance < in.Amount {
		return PayoutRequest{}, ErrInsufficientBalance
	}

	var pr PayoutRequest
	var amountFloat float64
	err = tx.QueryRow(ctx, `
		INSERT INTO payout_requests (
			id, organizer_id, amount, bank_name, bank_account_number, bank_account_name, status, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
		RETURNING id, organizer_id, amount::float8, bank_name, bank_account_number, bank_account_name, status, processed_at, created_at
	`, uuid.NewString(), organizerID, in.Amount, in.BankName, in.BankAccountNumber, in.BankAccountName).Scan(
		&pr.ID, &pr.OrganizerID, &amountFloat, &pr.BankName, &pr.BankAccountNumber, &pr.BankAccountName, &pr.Status, &pr.ProcessedAt, &pr.CreatedAt,
	)
	if err != nil {
		return PayoutRequest{}, fmt.Errorf("insert payout request: %w", err)
	}
	pr.Amount = int64(math.Round(amountFloat))

	_, err = tx.Exec(ctx, `
		INSERT INTO ledger_entries (id, organizer_id, event_id, order_id, entry_type, amount, created_at)
		VALUES ($1, $2, NULL, NULL, 'payout_debit', $3, NOW())
	`, uuid.NewString(), organizerID, -in.Amount)
	if err != nil {
		return PayoutRequest{}, fmt.Errorf("insert payout_debit: %w", err)
	}

	auditPayload, err := json.Marshal(map[string]any{
		"payout_id": pr.ID,
		"amount":    pr.Amount,
	})
	if err != nil {
		return PayoutRequest{}, fmt.Errorf("marshal payout audit payload: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_events (id, event_id, actor_id, event_category, payload, created_at)
		VALUES ($1, NULL, $2, 'payout_requested', $3, NOW())
	`, uuid.NewString(), organizerID, auditPayload); err != nil {
		return PayoutRequest{}, fmt.Errorf("insert payout audit event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return PayoutRequest{}, fmt.Errorf("commit payout tx: %w", err)
	}

	return pr, nil
}

// ListPayouts returns all payout requests for an organizer ordered by created_at DESC.
func (s *Service) ListPayouts(ctx context.Context, organizerID string) ([]PayoutRequest, error) {
	organizerID = strings.TrimSpace(organizerID)
	if organizerID == "" {
		return nil, ErrInvalidInput
	}

	rows, err := s.db.Query(ctx, `
		SELECT id, organizer_id, amount::float8, bank_name, bank_account_number, bank_account_name, status, processed_at, created_at
		FROM payout_requests
		WHERE organizer_id = $1
		ORDER BY created_at DESC
	`, organizerID)
	if err != nil {
		return nil, fmt.Errorf("query organizer payouts: %w", err)
	}
	defer rows.Close()

	payouts := []PayoutRequest{}
	for rows.Next() {
		var pr PayoutRequest
		var amountFloat float64
		if err := rows.Scan(
			&pr.ID,
			&pr.OrganizerID,
			&amountFloat,
			&pr.BankName,
			&pr.BankAccountNumber,
			&pr.BankAccountName,
			&pr.Status,
			&pr.ProcessedAt,
			&pr.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan payout request: %w", err)
		}
		pr.Amount = int64(math.Round(amountFloat))
		payouts = append(payouts, pr)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate payout requests: %w", err)
	}

	return payouts, nil
}
