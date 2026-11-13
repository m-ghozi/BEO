package admin

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
	ErrInvalidInput          = errors.New("invalid input")
	ErrInvalidEventType      = errors.New("invalid event type")
	ErrInvalidCommissionRate = errors.New("rate_percent must be between 0 and 100")
	ErrPayoutNotFound        = errors.New("payout request not found")
	ErrInvalidPayoutState    = errors.New("invalid payout state transition")
	ErrInvalidAction         = errors.New("invalid payout action")
)

var validEventTypes = map[string]struct{}{
	"community":        {},
	"seminar_workshop": {},
	"conference":       {},
	"meetup_ted":       {},
}

type Overview struct {
	TotalUsers      int64 `json:"total_users"`
	TotalEvents     int64 `json:"total_events"`
	PaidOrders      int64 `json:"paid_orders"`
	GrossRevenue    int64 `json:"gross_revenue"`
	TotalCommission int64 `json:"total_commission"`
	PendingPayouts  int64 `json:"pending_payouts"`
}

type AdminEvent struct {
	ID             string          `json:"id"`
	OrganizerID    string          `json:"organizer_id"`
	OrganizerName  string          `json:"organizer_name"`
	OrganizerEmail string          `json:"organizer_email"`
	Title          string          `json:"title"`
	Slug           string          `json:"slug"`
	EventType      string          `json:"event_type"`
	ModulesEnabled json.RawMessage `json:"modules_enabled"`
	StartAt        time.Time       `json:"start_at"`
	EndAt          time.Time       `json:"end_at"`
	Venue          string          `json:"venue"`
	Status         string          `json:"status"`
	CreatedAt      time.Time       `json:"created_at"`
}

type AdminUser struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Email       string    `json:"email"`
	AccountType string    `json:"account_type"`
	CreatedAt   time.Time `json:"created_at"`
}

type CommissionRate struct {
	EventType   string    `json:"event_type"`
	RatePercent float64   `json:"rate_percent"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type AdminPayout struct {
	ID                string     `json:"id"`
	OrganizerID       string     `json:"organizer_id"`
	OrganizerName     string     `json:"organizer_name"`
	OrganizerEmail    string     `json:"organizer_email"`
	Amount            int64      `json:"amount"`
	BankName          string     `json:"bank_name"`
	BankAccountNumber string     `json:"bank_account_number"`
	BankAccountName   string     `json:"bank_account_name"`
	Status            string     `json:"status"`
	ProcessedAt       *time.Time `json:"processed_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

type AuditEvent struct {
	ID        string          `json:"id"`
	EventType string          `json:"event_type"`
	UserID    *string         `json:"user_id,omitempty"`
	EventID   *string         `json:"event_id,omitempty"`
	TicketID  *string         `json:"ticket_id,omitempty"`
	IPAddress string          `json:"ip_address"`
	Metadata  json.RawMessage `json:"metadata"`
	CreatedAt time.Time       `json:"created_at"`
}

type Service struct {
	db *pgxpool.Pool
}

// NewService creates a new platform admin Service backed by PostgreSQL.
func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

// GetOverview returns platform-wide counts and financial totals.
func (s *Service) GetOverview(ctx context.Context) (Overview, error) {
	var ov Overview
	err := s.db.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM users)::BIGINT,
			(SELECT COUNT(*) FROM events)::BIGINT,
			(SELECT COUNT(*) FROM orders WHERE payment_status = 'paid')::BIGINT,
			(SELECT ROUND(COALESCE(SUM(amount), 0))::BIGINT FROM ledger_entries WHERE entry_type = 'ticket_sale_gross'),
			(SELECT ROUND(COALESCE(SUM(ABS(amount)), 0))::BIGINT FROM ledger_entries WHERE entry_type = 'platform_commission'),
			(SELECT COUNT(*) FROM payout_requests WHERE status IN ('pending', 'approved'))::BIGINT
	`).Scan(
		&ov.TotalUsers,
		&ov.TotalEvents,
		&ov.PaidOrders,
		&ov.GrossRevenue,
		&ov.TotalCommission,
		&ov.PendingPayouts,
	)
	if err != nil {
		return Overview{}, fmt.Errorf("query admin overview: %w", err)
	}
	return ov, nil
}

// ListEvents returns up to 100 recent events across all statuses joined with organizer details.
func (s *Service) ListEvents(ctx context.Context) ([]AdminEvent, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			e.id, e.organizer_id, u.name, u.email,
			e.title, e.slug, e.event_type, e.modules_enabled,
			e.start_at, e.end_at, e.venue, e.status, e.created_at
		FROM events e
		JOIN users u ON u.id = e.organizer_id
		ORDER BY e.created_at DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, fmt.Errorf("query admin events: %w", err)
	}
	defer rows.Close()

	events := []AdminEvent{}
	for rows.Next() {
		var evt AdminEvent
		if err := rows.Scan(
			&evt.ID,
			&evt.OrganizerID,
			&evt.OrganizerName,
			&evt.OrganizerEmail,
			&evt.Title,
			&evt.Slug,
			&evt.EventType,
			&evt.ModulesEnabled,
			&evt.StartAt,
			&evt.EndAt,
			&evt.Venue,
			&evt.Status,
			&evt.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan admin event: %w", err)
		}
		events = append(events, evt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admin events: %w", err)
	}
	return events, nil
}

// ListUsers returns up to 100 recent users ordered by created_at DESC.
func (s *Service) ListUsers(ctx context.Context) ([]AdminUser, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, name, email, account_type, created_at
		FROM users
		ORDER BY created_at DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, fmt.Errorf("query admin users: %w", err)
	}
	defer rows.Close()

	users := []AdminUser{}
	for rows.Next() {
		var u AdminUser
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.AccountType, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan admin user: %w", err)
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admin users: %w", err)
	}
	return users, nil
}

// ListCommissions returns all category commission rates ordered by event_category ASC.
func (s *Service) ListCommissions(ctx context.Context) ([]CommissionRate, error) {
	rows, err := s.db.Query(ctx, `
		SELECT event_category, commission_percent::float8, updated_at
		FROM category_commission_rates
		ORDER BY event_category ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query commission rates: %w", err)
	}
	defer rows.Close()

	rates := []CommissionRate{}
	for rows.Next() {
		var r CommissionRate
		if err := rows.Scan(&r.EventType, &r.RatePercent, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan commission rate: %w", err)
		}
		rates = append(rates, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate commission rates: %w", err)
	}
	return rates, nil
}

// ValidateCommissionInput validates an eventType and ratePercent for commission updates.
func ValidateCommissionInput(eventType string, ratePercent float64) error {
	if _, ok := validEventTypes[strings.TrimSpace(eventType)]; !ok {
		return ErrInvalidEventType
	}
	if math.IsNaN(ratePercent) || math.IsInf(ratePercent, 0) || ratePercent < 0 || ratePercent > 100 {
		return ErrInvalidCommissionRate
	}
	return nil
}

// UpdateCommission upserts the commission rate for the given event category.
func (s *Service) UpdateCommission(ctx context.Context, eventType string, ratePercent float64) (CommissionRate, error) {
	eventType = strings.TrimSpace(eventType)
	if err := ValidateCommissionInput(eventType, ratePercent); err != nil {
		return CommissionRate{}, err
	}

	var updated CommissionRate
	err := s.db.QueryRow(ctx, `
		INSERT INTO category_commission_rates (event_category, commission_percent, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (event_category) DO UPDATE
		SET commission_percent = EXCLUDED.commission_percent,
		    updated_at = NOW()
		RETURNING event_category, commission_percent::float8, updated_at
	`, eventType, ratePercent).Scan(&updated.EventType, &updated.RatePercent, &updated.UpdatedAt)
	if err != nil {
		return CommissionRate{}, fmt.Errorf("upsert commission rate: %w", err)
	}
	return updated, nil
}

// ListPayouts returns all payout requests joined with organizer details ordered by created_at DESC.
func (s *Service) ListPayouts(ctx context.Context) ([]AdminPayout, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			p.id, p.organizer_id, u.name, u.email,
			p.amount::float8, p.bank_name, p.bank_account_number, p.bank_account_name,
			p.status, p.processed_at, p.created_at
		FROM payout_requests p
		JOIN users u ON u.id = p.organizer_id
		ORDER BY p.created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query admin payouts: %w", err)
	}
	defer rows.Close()

	payouts := []AdminPayout{}
	for rows.Next() {
		var p AdminPayout
		var amountFloat float64
		if err := rows.Scan(
			&p.ID,
			&p.OrganizerID,
			&p.OrganizerName,
			&p.OrganizerEmail,
			&amountFloat,
			&p.BankName,
			&p.BankAccountNumber,
			&p.BankAccountName,
			&p.Status,
			&p.ProcessedAt,
			&p.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan admin payout: %w", err)
		}
		p.Amount = int64(math.Round(amountFloat))
		payouts = append(payouts, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admin payouts: %w", err)
	}
	return payouts, nil
}

// ProcessPayout transitions a payout request ("approve", "complete", or "reject")
// and reverses the organizer's payout_debit ledger entry on rejection.
func (s *Service) ProcessPayout(ctx context.Context, adminUserID, payoutID, action, note string) (AdminPayout, error) {
	payoutID = strings.TrimSpace(payoutID)
	action = strings.TrimSpace(action)
	note = strings.TrimSpace(note)

	if payoutID == "" {
		return AdminPayout{}, ErrInvalidInput
	}
	if action != "approve" && action != "complete" && action != "reject" {
		return AdminPayout{}, ErrInvalidAction
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return AdminPayout{}, fmt.Errorf("begin process payout tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var p AdminPayout
	var amountFloat float64
	err = tx.QueryRow(ctx, `
		SELECT
			p.id, p.organizer_id, u.name, u.email,
			p.amount::float8, p.bank_name, p.bank_account_number, p.bank_account_name,
			p.status, p.processed_at, p.created_at
		FROM payout_requests p
		JOIN users u ON u.id = p.organizer_id
		WHERE p.id = $1
		FOR UPDATE OF p
	`, payoutID).Scan(
		&p.ID,
		&p.OrganizerID,
		&p.OrganizerName,
		&p.OrganizerEmail,
		&amountFloat,
		&p.BankName,
		&p.BankAccountNumber,
		&p.BankAccountName,
		&p.Status,
		&p.ProcessedAt,
		&p.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AdminPayout{}, ErrPayoutNotFound
		}
		return AdminPayout{}, fmt.Errorf("lock payout request: %w", err)
	}
	p.Amount = int64(math.Round(amountFloat))

	var newStatus string
	var setProcessedAt bool
	switch action {
	case "approve":
		if p.Status != "pending" {
			return AdminPayout{}, ErrInvalidPayoutState
		}
		newStatus = "approved"
	case "complete":
		if p.Status != "pending" && p.Status != "approved" {
			return AdminPayout{}, ErrInvalidPayoutState
		}
		// payout_requests.status CHECK constraint allows ('pending', 'approved', 'paid', 'rejected').
		newStatus = "paid"
		setProcessedAt = true
	case "reject":
		if p.Status != "pending" && p.Status != "approved" {
			return AdminPayout{}, ErrInvalidPayoutState
		}
		newStatus = "rejected"
		setProcessedAt = true
	}

	if setProcessedAt {
		err = tx.QueryRow(ctx, `
			UPDATE payout_requests
			SET status = $2, processed_at = NOW()
			WHERE id = $1
			RETURNING status, processed_at
		`, payoutID, newStatus).Scan(&p.Status, &p.ProcessedAt)
	} else {
		err = tx.QueryRow(ctx, `
			UPDATE payout_requests
			SET status = $2
			WHERE id = $1
			RETURNING status, processed_at
		`, payoutID, newStatus).Scan(&p.Status, &p.ProcessedAt)
	}
	if err != nil {
		return AdminPayout{}, fmt.Errorf("update payout status: %w", err)
	}

	// RequestPayout debits the organizer ledger upfront with -amount; refund it on rejection.
	if action == "reject" && p.Amount > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO ledger_entries (id, organizer_id, event_id, order_id, entry_type, amount, created_at)
			VALUES ($1, $2, NULL, NULL, 'payout_debit', $3, NOW())
		`, uuid.NewString(), p.OrganizerID, p.Amount); err != nil {
			return AdminPayout{}, fmt.Errorf("reverse payout_debit on reject: %w", err)
		}
	}

	auditPayload, err := json.Marshal(map[string]any{
		"payout_id": p.ID,
		"action":    action,
		"status":    p.Status,
		"amount":    p.Amount,
		"note":      note,
	})
	if err != nil {
		return AdminPayout{}, fmt.Errorf("marshal payout process audit payload: %w", err)
	}
	var actorID *string
	if strings.TrimSpace(adminUserID) != "" {
		trimmed := strings.TrimSpace(adminUserID)
		actorID = &trimmed
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_events (id, event_id, actor_id, event_category, payload, created_at)
		VALUES ($1, NULL, $2, $3, $4, NOW())
	`, uuid.NewString(), actorID, "payout_"+p.Status, auditPayload); err != nil {
		return AdminPayout{}, fmt.Errorf("insert payout process audit event: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return AdminPayout{}, fmt.Errorf("commit process payout tx: %w", err)
	}
	return p, nil
}

// ListAuditEvents returns up to 100 recent audit_events ordered by created_at DESC.
func (s *Service) ListAuditEvents(ctx context.Context) ([]AuditEvent, error) {
	rows, err := s.db.Query(ctx, `
		SELECT
			id,
			event_category,
			actor_id,
			event_id,
			NULLIF(payload->>'ticket_id', ''),
			ip_address,
			payload,
			created_at
		FROM audit_events
		ORDER BY created_at DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, fmt.Errorf("query audit events: %w", err)
	}
	defer rows.Close()

	events := []AuditEvent{}
	for rows.Next() {
		var ae AuditEvent
		if err := rows.Scan(
			&ae.ID,
			&ae.EventType,
			&ae.UserID,
			&ae.EventID,
			&ae.TicketID,
			&ae.IPAddress,
			&ae.Metadata,
			&ae.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan audit event: %w", err)
		}
		events = append(events, ae)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate audit events: %w", err)
	}
	return events, nil
}
