package ticketing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/platform"
)

var (
	ErrInvalidInput        = errors.New("invalid input")
	ErrForbidden           = errors.New("forbidden")
	ErrEventNotFound       = errors.New("event not found")
	ErrTicketTypeNotFound  = errors.New("ticket type not found")
	ErrUserNotFound        = errors.New("user not found")
	ErrOutOfStock          = errors.New("ticket out of stock")
	ErrSalesClosed         = errors.New("ticket sales window is closed")
	ErrCFPRequired         = errors.New("accepted CFP submission required for this ticket type")
	ErrAgencyQuotaExceeded = errors.New("agency quota exceeded")
	ErrInvalidClaimToken   = errors.New("invalid claim token")
	ErrAlreadyClaimed      = errors.New("ticket already claimed")
	ErrTicketNotFound      = errors.New("ticket not found")
	ErrTicketNotValid      = errors.New("ticket is not valid")
)

const reservationTTL = 30 * time.Minute

type TicketType struct {
	ID                   string    `json:"id"`
	EventID              string    `json:"event_id"`
	Name                 string    `json:"name"`
	Price                float64   `json:"price"`
	Currency             string    `json:"currency"`
	Quota                int       `json:"quota"`
	AllocatedAgencyQuota int       `json:"allocated_agency_quota"`
	SoldCount            int       `json:"sold_count"`
	ReservedCount        int       `json:"reserved_count"`
	RequiresAcceptedCFP  bool      `json:"requires_accepted_cfp"`
	SalesStartAt         time.Time `json:"sales_start_at"`
	SalesEndAt           time.Time `json:"sales_end_at"`
	CreatedAt            time.Time `json:"created_at"`
}

type CreateTicketTypeInput struct {
	Name                string     `json:"name"`
	Price               float64    `json:"price"`
	Currency            string     `json:"currency"`
	Quota               int        `json:"quota"`
	RequiresAcceptedCFP bool       `json:"requires_accepted_cfp"`
	SalesStartAt        *time.Time `json:"sales_start_at"`
	SalesEndAt          time.Time  `json:"sales_end_at"`
}

type AttendeeInput struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type ReserveOrderInput struct {
	EventID       string          `json:"event_id"`
	TicketTypeID  string          `json:"ticket_type_id"`
	BuyerUserID   *string         `json:"buyer_user_id"`
	BuyerEmail    string          `json:"buyer_email"`
	PaymentMethod string          `json:"payment_method"`
	Attendees     []AttendeeInput `json:"attendees"`
}

type Order struct {
	ID              string     `json:"id"`
	EventID         string     `json:"event_id"`
	BuyerUserID     *string    `json:"buyer_user_id,omitempty"`
	AgencyID        *string    `json:"agency_id,omitempty"`
	BuyerEmail      string     `json:"buyer_email"`
	TotalAmount     float64    `json:"total_amount"`
	PaymentMethod   string     `json:"payment_method"`
	PaymentStatus   string     `json:"payment_status"`
	DuitkuReference *string    `json:"duitku_reference,omitempty"`
	ProofFileURL    *string    `json:"proof_file_url,omitempty"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	Tickets         []Ticket   `json:"tickets,omitempty"`
}

type Ticket struct {
	ID              string     `json:"id"`
	OrderID         *string    `json:"order_id,omitempty"`
	TicketTypeID    string     `json:"ticket_type_id"`
	EventID         string     `json:"event_id"`
	AgencyID        *string    `json:"agency_id,omitempty"`
	AttendeeName    string     `json:"attendee_name"`
	AttendeeEmail   string     `json:"attendee_email"`
	TicketCode      string     `json:"ticket_code"`
	QRSignature     string     `json:"qr_signature"`
	ClaimToken      *string    `json:"claim_token,omitempty"`
	ClaimedByUserID *string    `json:"claimed_by_user_id,omitempty"`
	Status          string     `json:"status"`
	CheckedInAt     *time.Time `json:"checked_in_at,omitempty"`
	CheckedInBy     *string    `json:"checked_in_by,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

type AllocateAgencyInput struct {
	AgencyUserID string `json:"agency_user_id"`
	TicketTypeID string `json:"ticket_type_id"`
	QuotaLimit   int    `json:"quota_limit"`
}

type EventAgency struct {
	ID           string    `json:"id"`
	EventID      string    `json:"event_id"`
	AgencyUserID string    `json:"agency_user_id"`
	TicketTypeID string    `json:"ticket_type_id"`
	QuotaLimit   int       `json:"quota_limit"`
	IssuedCount  int       `json:"issued_count"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
}

type IssueAgencyTicketsInput struct {
	TicketTypeID string          `json:"ticket_type_id"`
	Attendees    []AttendeeInput `json:"attendees"`
}

type Service struct {
	db           *pgxpool.Pool
	identitySvc  *identity.Service
	qrHMACSecret string
	mailer       platform.Mailer
}

// NewService creates a new ticketing Service.
func NewService(db *pgxpool.Pool, identitySvc *identity.Service, qrHMACSecret string) *Service {
	if strings.TrimSpace(qrHMACSecret) == "" {
		panic("ticketing: qrHMACSecret cannot be empty")
	}
	return &Service{
		db:           db,
		identitySvc:  identitySvc,
		qrHMACSecret: qrHMACSecret,
	}
}

// SetMailer configures an optional Mailer for transactional ticket email dispatch.
func (s *Service) SetMailer(mailer platform.Mailer) {
	s.mailer = mailer
}

func randomHex(nBytes int) (string, error) {
	b := make([]byte, nBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func (s *Service) requireOrganizerOrCoOrganizer(ctx context.Context, eventID, actorID string) error {
	var exists bool
	if err := s.db.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM events WHERE id = $1)", eventID).Scan(&exists); err != nil {
		return fmt.Errorf("check event exists: %w", err)
	}
	if !exists {
		return ErrEventNotFound
	}

	ok, err := s.identitySvc.HasEventRole(ctx, eventID, actorID, "co_organizer")
	if err != nil {
		return fmt.Errorf("check event role: %w", err)
	}
	if !ok {
		return ErrForbidden
	}
	return nil
}

// CreateTicketType creates a new ticket tier for an event.
func (s *Service) CreateTicketType(ctx context.Context, eventID, actorID string, in CreateTicketTypeInput) (TicketType, error) {
	eventID = strings.TrimSpace(eventID)
	actorID = strings.TrimSpace(actorID)
	in.Name = strings.TrimSpace(in.Name)
	in.Currency = strings.ToUpper(strings.TrimSpace(in.Currency))

	if eventID == "" || actorID == "" || in.Name == "" || in.Price < 0 || in.Quota < 0 || in.SalesEndAt.IsZero() {
		return TicketType{}, ErrInvalidInput
	}
	if in.Currency == "" {
		in.Currency = "IDR"
	}

	salesStart := time.Now()
	if in.SalesStartAt != nil && !in.SalesStartAt.IsZero() {
		salesStart = *in.SalesStartAt
	}
	if salesStart.After(in.SalesEndAt) {
		return TicketType{}, fmt.Errorf("%w: sales_start_at must be before sales_end_at", ErrInvalidInput)
	}

	if err := s.requireOrganizerOrCoOrganizer(ctx, eventID, actorID); err != nil {
		return TicketType{}, err
	}

	id := uuid.NewString()
	query := `
		INSERT INTO ticket_types (
			id, event_id, name, price, currency, quota, allocated_agency_quota,
			sold_count, reserved_count, requires_accepted_cfp, sales_start_at, sales_end_at, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, $7, $8, $9, NOW())
		RETURNING id, event_id, name, price, currency, quota, allocated_agency_quota,
			sold_count, reserved_count, requires_accepted_cfp, sales_start_at, sales_end_at, created_at
	`
	var tt TicketType
	err := s.db.QueryRow(ctx, query,
		id, eventID, in.Name, in.Price, in.Currency, in.Quota,
		in.RequiresAcceptedCFP, salesStart, in.SalesEndAt,
	).Scan(
		&tt.ID, &tt.EventID, &tt.Name, &tt.Price, &tt.Currency, &tt.Quota,
		&tt.AllocatedAgencyQuota, &tt.SoldCount, &tt.ReservedCount,
		&tt.RequiresAcceptedCFP, &tt.SalesStartAt, &tt.SalesEndAt, &tt.CreatedAt,
	)
	if err != nil {
		return TicketType{}, fmt.Errorf("insert ticket type: %w", err)
	}
	return tt, nil
}

// ListTicketTypes returns all ticket types configured for an event ordered by price ascending.
func (s *Service) ListTicketTypes(ctx context.Context, eventID string) ([]TicketType, error) {
	eventID = strings.TrimSpace(eventID)
	if eventID == "" {
		return nil, ErrInvalidInput
	}

	rows, err := s.db.Query(ctx, `
		SELECT id, event_id, name, price, currency, quota, allocated_agency_quota,
			sold_count, reserved_count, requires_accepted_cfp, sales_start_at, sales_end_at, created_at
		FROM ticket_types
		WHERE event_id = $1
		ORDER BY price ASC, created_at ASC
	`, eventID)
	if err != nil {
		return nil, fmt.Errorf("list ticket types: %w", err)
	}
	defer rows.Close()

	types := []TicketType{}
	for rows.Next() {
		var tt TicketType
		if err := rows.Scan(
			&tt.ID, &tt.EventID, &tt.Name, &tt.Price, &tt.Currency, &tt.Quota,
			&tt.AllocatedAgencyQuota, &tt.SoldCount, &tt.ReservedCount,
			&tt.RequiresAcceptedCFP, &tt.SalesStartAt, &tt.SalesEndAt, &tt.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan ticket type: %w", err)
		}
		types = append(types, tt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate ticket types: %w", err)
	}
	return types, nil
}

func (s *Service) insertTicket(
	ctx context.Context,
	tx pgx.Tx,
	orderID *string,
	ticketTypeID, eventID string,
	agencyID *string,
	attendee AttendeeInput,
	claimToken, claimedByUserID *string,
	status string,
) (Ticket, error) {
	suffix, err := randomHex(6)
	if err != nil {
		return Ticket{}, fmt.Errorf("generate ticket code: %w", err)
	}
	ticketCode := "BEO-" + strings.ToUpper(suffix)
	qrSig := ""
	if status == "valid" {
		qrSig = SignQR(s.qrHMACSecret, ticketCode, eventID)
	}

	id := uuid.NewString()
	query := `
		INSERT INTO tickets (
			id, order_id, ticket_type_id, event_id, agency_id,
			attendee_name, attendee_email, ticket_code, qr_signature,
			claim_token, claimed_by_user_id, status, created_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
		RETURNING id, order_id, ticket_type_id, event_id, agency_id,
			attendee_name, attendee_email, ticket_code, qr_signature,
			claim_token, claimed_by_user_id, status, checked_in_at, checked_in_by, created_at
	`
	var tk Ticket
	err = tx.QueryRow(ctx, query,
		id, orderID, ticketTypeID, eventID, agencyID,
		strings.TrimSpace(attendee.Name), strings.ToLower(strings.TrimSpace(attendee.Email)),
		ticketCode, qrSig, claimToken, claimedByUserID, status,
	).Scan(
		&tk.ID, &tk.OrderID, &tk.TicketTypeID, &tk.EventID, &tk.AgencyID,
		&tk.AttendeeName, &tk.AttendeeEmail, &tk.TicketCode, &tk.QRSignature,
		&tk.ClaimToken, &tk.ClaimedByUserID, &tk.Status, &tk.CheckedInAt, &tk.CheckedInBy, &tk.CreatedAt,
	)
	if err != nil {
		return Ticket{}, fmt.Errorf("insert ticket: %w", err)
	}
	return tk, nil
}

// ReserveOrder atomically reserves quota and creates an order with one ticket per attendee.
// Supports nullable BuyerUserID for guest checkout and enforces requires_accepted_cfp when set.
func (s *Service) ReserveOrder(ctx context.Context, in ReserveOrderInput) (Order, error) {
	in.EventID = strings.TrimSpace(in.EventID)
	in.TicketTypeID = strings.TrimSpace(in.TicketTypeID)
	in.BuyerEmail = strings.ToLower(strings.TrimSpace(in.BuyerEmail))
	in.PaymentMethod = strings.TrimSpace(in.PaymentMethod)

	if in.EventID == "" || in.TicketTypeID == "" || in.BuyerEmail == "" || len(in.Attendees) == 0 {
		return Order{}, ErrInvalidInput
	}
	for _, a := range in.Attendees {
		if strings.TrimSpace(a.Name) == "" || strings.TrimSpace(a.Email) == "" {
			return Order{}, fmt.Errorf("%w: attendee name and email are required", ErrInvalidInput)
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Order{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var tt TicketType
	lockQuery := `
		SELECT id, event_id, price, quota, allocated_agency_quota, sold_count, reserved_count, requires_accepted_cfp, sales_start_at, sales_end_at
		FROM ticket_types
		WHERE id = $1 AND event_id = $2
		FOR UPDATE
	`
	err = tx.QueryRow(ctx, lockQuery, in.TicketTypeID, in.EventID).Scan(
		&tt.ID, &tt.EventID, &tt.Price, &tt.Quota, &tt.AllocatedAgencyQuota,
		&tt.SoldCount, &tt.ReservedCount, &tt.RequiresAcceptedCFP, &tt.SalesStartAt, &tt.SalesEndAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Order{}, ErrTicketTypeNotFound
		}
		return Order{}, fmt.Errorf("lock ticket type: %w", err)
	}

	now := time.Now()
	if now.Before(tt.SalesStartAt) || now.After(tt.SalesEndAt) {
		return Order{}, ErrSalesClosed
	}

	if tt.RequiresAcceptedCFP {
		if in.BuyerUserID == nil || strings.TrimSpace(*in.BuyerUserID) == "" {
			return Order{}, ErrCFPRequired
		}
		var hasAcceptedCFP bool
		err = tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM cfp_submissions
				WHERE event_id = $1 AND author_user_id = $2 AND status = 'accepted'
			)
		`, in.EventID, *in.BuyerUserID).Scan(&hasAcceptedCFP)
		if err != nil {
			return Order{}, fmt.Errorf("check accepted cfp: %w", err)
		}
		if !hasAcceptedCFP {
			return Order{}, ErrCFPRequired
		}
	}

	qty := len(in.Attendees)
	available := tt.Quota - tt.SoldCount - tt.ReservedCount - tt.AllocatedAgencyQuota
	if available < qty {
		return Order{}, ErrOutOfStock
	}

	paymentMethod := in.PaymentMethod
	var paymentStatus string
	var ticketStatus string
	var addSold, addReserved int
	var expiresAt *time.Time

	if tt.Price == 0 {
		if paymentMethod == "" {
			paymentMethod = "free"
		}
		if paymentMethod != "free" {
			return Order{}, fmt.Errorf("%w: free ticket must use payment_method=free", ErrInvalidInput)
		}
		paymentStatus = "paid"
		ticketStatus = "valid"
		addSold = qty
	} else {
		if paymentMethod == "" {
			paymentMethod = "duitku"
		}
		if paymentMethod != "duitku" && paymentMethod != "manual_transfer" {
			return Order{}, fmt.Errorf("%w: invalid payment_method for paid ticket", ErrInvalidInput)
		}
		paymentStatus = "pending"
		ticketStatus = "pending"
		addReserved = qty
		exp := now.Add(reservationTTL)
		expiresAt = &exp
	}

	if _, err := tx.Exec(ctx,
		"UPDATE ticket_types SET sold_count = sold_count + $1, reserved_count = reserved_count + $2 WHERE id = $3",
		addSold, addReserved, tt.ID,
	); err != nil {
		return Order{}, fmt.Errorf("update ticket type counts: %w", err)
	}

	orderID := uuid.NewString()
	totalAmount := tt.Price * float64(qty)
	orderQuery := `
		INSERT INTO orders (
			id, event_id, buyer_user_id, buyer_email, total_amount,
			payment_method, payment_status, expires_at, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
		RETURNING id, event_id, buyer_user_id, agency_id, buyer_email, total_amount,
			payment_method, payment_status, duitku_reference, proof_file_url, expires_at, created_at, updated_at
	`
	var ord Order
	err = tx.QueryRow(ctx, orderQuery,
		orderID, in.EventID, in.BuyerUserID, in.BuyerEmail, totalAmount,
		paymentMethod, paymentStatus, expiresAt,
	).Scan(
		&ord.ID, &ord.EventID, &ord.BuyerUserID, &ord.AgencyID, &ord.BuyerEmail,
		&ord.TotalAmount, &ord.PaymentMethod, &ord.PaymentStatus,
		&ord.DuitkuReference, &ord.ProofFileURL, &ord.ExpiresAt, &ord.CreatedAt, &ord.UpdatedAt,
	)
	if err != nil {
		return Order{}, fmt.Errorf("insert order: %w", err)
	}

	ord.Tickets = make([]Ticket, 0, qty)
	for _, att := range in.Attendees {
		tok := uuid.NewString()
		claimToken := &tok

		var claimedBy *string
		if in.BuyerUserID != nil && strings.TrimSpace(*in.BuyerUserID) != "" &&
			strings.EqualFold(strings.TrimSpace(att.Email), strings.TrimSpace(in.BuyerEmail)) {
			claimedBy = in.BuyerUserID
		}

		tk, err := s.insertTicket(ctx, tx, &ord.ID, tt.ID, in.EventID, nil, att, claimToken, claimedBy, ticketStatus)
		if err != nil {
			return Order{}, err
		}
		ord.Tickets = append(ord.Tickets, tk)
	}

	if err := tx.Commit(ctx); err != nil {
		return Order{}, fmt.Errorf("commit order tx: %w", err)
	}

	if paymentStatus == "paid" && s.mailer != nil {
		SendOrderTicketEmails(ctx, s.db, s.mailer, s.qrHMACSecret, ord.ID)
	}

	return ord, nil
}

// AllocateAgencyQuota carves out quota from ticket_types into event_agencies for an agency user.
func (s *Service) AllocateAgencyQuota(ctx context.Context, eventID, actorID string, in AllocateAgencyInput) (EventAgency, error) {
	eventID = strings.TrimSpace(eventID)
	actorID = strings.TrimSpace(actorID)
	in.AgencyUserID = strings.TrimSpace(in.AgencyUserID)
	in.TicketTypeID = strings.TrimSpace(in.TicketTypeID)

	if eventID == "" || actorID == "" || in.AgencyUserID == "" || in.TicketTypeID == "" || in.QuotaLimit <= 0 {
		return EventAgency{}, ErrInvalidInput
	}

	if err := s.requireOrganizerOrCoOrganizer(ctx, eventID, actorID); err != nil {
		return EventAgency{}, err
	}

	var accountType string
	err := s.db.QueryRow(ctx, "SELECT account_type FROM users WHERE id = $1", in.AgencyUserID).Scan(&accountType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EventAgency{}, ErrUserNotFound
		}
		return EventAgency{}, fmt.Errorf("query agency user: %w", err)
	}
	if accountType != "agency" {
		return EventAgency{}, fmt.Errorf("%w: target user is not an agency account", ErrInvalidInput)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return EventAgency{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var quota, allocatedAgencyQuota, soldCount, reservedCount int
	err = tx.QueryRow(ctx, `
		SELECT quota, allocated_agency_quota, sold_count, reserved_count
		FROM ticket_types
		WHERE id = $1 AND event_id = $2
		FOR UPDATE
	`, in.TicketTypeID, eventID).Scan(&quota, &allocatedAgencyQuota, &soldCount, &reservedCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EventAgency{}, ErrTicketTypeNotFound
		}
		return EventAgency{}, fmt.Errorf("lock ticket type: %w", err)
	}

	available := quota - soldCount - reservedCount - allocatedAgencyQuota
	if available < in.QuotaLimit {
		return EventAgency{}, ErrOutOfStock
	}

	if _, err := tx.Exec(ctx,
		"UPDATE ticket_types SET allocated_agency_quota = allocated_agency_quota + $1 WHERE id = $2",
		in.QuotaLimit, in.TicketTypeID,
	); err != nil {
		return EventAgency{}, fmt.Errorf("update allocated_agency_quota: %w", err)
	}

	eaID := uuid.NewString()
	var ea EventAgency
	err = tx.QueryRow(ctx, `
		INSERT INTO event_agencies (id, event_id, agency_user_id, ticket_type_id, quota_limit, issued_count, status, created_at)
		VALUES ($1, $2, $3, $4, $5, 0, 'active', NOW())
		RETURNING id, event_id, agency_user_id, ticket_type_id, quota_limit, issued_count, status, created_at
	`, eaID, eventID, in.AgencyUserID, in.TicketTypeID, in.QuotaLimit).Scan(
		&ea.ID, &ea.EventID, &ea.AgencyUserID, &ea.TicketTypeID,
		&ea.QuotaLimit, &ea.IssuedCount, &ea.Status, &ea.CreatedAt,
	)
	if err != nil {
		return EventAgency{}, fmt.Errorf("insert event_agencies: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return EventAgency{}, fmt.Errorf("commit agency allocation tx: %w", err)
	}

	return ea, nil
}

// IssueAgencyTickets issues tickets from an agency's allocated quota with unique claim tokens.
func (s *Service) IssueAgencyTickets(ctx context.Context, agencyUserID, eventID string, in IssueAgencyTicketsInput) ([]Ticket, error) {
	agencyUserID = strings.TrimSpace(agencyUserID)
	eventID = strings.TrimSpace(eventID)
	in.TicketTypeID = strings.TrimSpace(in.TicketTypeID)

	if agencyUserID == "" || eventID == "" || in.TicketTypeID == "" || len(in.Attendees) == 0 {
		return nil, ErrInvalidInput
	}
	for _, a := range in.Attendees {
		if strings.TrimSpace(a.Name) == "" || strings.TrimSpace(a.Email) == "" {
			return nil, fmt.Errorf("%w: attendee name and email are required", ErrInvalidInput)
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var ea EventAgency
	err = tx.QueryRow(ctx, `
		SELECT id, event_id, agency_user_id, ticket_type_id, quota_limit, issued_count, status
		FROM event_agencies
		WHERE event_id = $1 AND agency_user_id = $2 AND ticket_type_id = $3
		FOR UPDATE
	`, eventID, agencyUserID, in.TicketTypeID).Scan(
		&ea.ID, &ea.EventID, &ea.AgencyUserID, &ea.TicketTypeID,
		&ea.QuotaLimit, &ea.IssuedCount, &ea.Status,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrForbidden
		}
		return nil, fmt.Errorf("lock event_agencies: %w", err)
	}
	if ea.Status != "active" {
		return nil, ErrForbidden
	}

	qty := len(in.Attendees)
	if ea.IssuedCount+qty > ea.QuotaLimit {
		return nil, ErrAgencyQuotaExceeded
	}

	orderID := uuid.NewString()
	buyerEmail := strings.ToLower(strings.TrimSpace(in.Attendees[0].Email))
	if _, err := tx.Exec(ctx, `
		INSERT INTO orders (
			id, event_id, agency_id, buyer_email, total_amount,
			payment_method, payment_status, created_at, updated_at
		)
		VALUES ($1, $2, $3, $4, 0, 'agency_issued', 'paid', NOW(), NOW())
	`, orderID, eventID, agencyUserID, buyerEmail); err != nil {
		return nil, fmt.Errorf("insert agency order: %w", err)
	}

	tickets := make([]Ticket, 0, qty)
	for _, att := range in.Attendees {
		tok := uuid.NewString()
		tk, err := s.insertTicket(ctx, tx, &orderID, in.TicketTypeID, eventID, &agencyUserID, att, &tok, nil, "valid")
		if err != nil {
			return nil, err
		}
		tickets = append(tickets, tk)
	}

	if _, err := tx.Exec(ctx,
		"UPDATE event_agencies SET issued_count = issued_count + $1 WHERE id = $2",
		qty, ea.ID,
	); err != nil {
		return nil, fmt.Errorf("update event_agencies issued_count: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit agency issuance tx: %w", err)
	}

	return tickets, nil
}

// ClaimTicket binds an unclaimed guest/agency ticket to a user via claim_token.
func (s *Service) ClaimTicket(ctx context.Context, userID, claimToken string) (Ticket, error) {
	userID = strings.TrimSpace(userID)
	claimToken = strings.TrimSpace(claimToken)
	if userID == "" || claimToken == "" {
		return Ticket{}, ErrInvalidInput
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Ticket{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var tk Ticket
	err = tx.QueryRow(ctx, `
		SELECT id, order_id, ticket_type_id, event_id, agency_id,
			attendee_name, attendee_email, ticket_code, qr_signature,
			claim_token, claimed_by_user_id, status, checked_in_at, checked_in_by, created_at
		FROM tickets
		WHERE claim_token = $1
		FOR UPDATE
	`, claimToken).Scan(
		&tk.ID, &tk.OrderID, &tk.TicketTypeID, &tk.EventID, &tk.AgencyID,
		&tk.AttendeeName, &tk.AttendeeEmail, &tk.TicketCode, &tk.QRSignature,
		&tk.ClaimToken, &tk.ClaimedByUserID, &tk.Status, &tk.CheckedInAt, &tk.CheckedInBy, &tk.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Ticket{}, ErrInvalidClaimToken
		}
		return Ticket{}, fmt.Errorf("lock ticket by claim_token: %w", err)
	}

	if tk.ClaimedByUserID != nil && *tk.ClaimedByUserID != "" {
		if *tk.ClaimedByUserID == userID {
			return tk, nil
		}
		return Ticket{}, ErrAlreadyClaimed
	}

	if _, err := tx.Exec(ctx, "UPDATE tickets SET claimed_by_user_id = $1 WHERE id = $2", userID, tk.ID); err != nil {
		return Ticket{}, fmt.Errorf("claim ticket: %w", err)
	}
	tk.ClaimedByUserID = &userID

	if err := tx.Commit(ctx); err != nil {
		return Ticket{}, fmt.Errorf("commit claim tx: %w", err)
	}

	return tk, nil
}

// ListMyTickets returns all tickets claimed by or purchased by the given user.
func (s *Service) ListMyTickets(ctx context.Context, userID string) ([]Ticket, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrInvalidInput
	}

	rows, err := s.db.Query(ctx, `
		SELECT t.id, t.order_id, t.ticket_type_id, t.event_id, t.agency_id,
			t.attendee_name, t.attendee_email, t.ticket_code, t.qr_signature,
			t.claim_token, t.claimed_by_user_id, t.status, t.checked_in_at, t.checked_in_by, t.created_at
		FROM tickets t
		LEFT JOIN orders o ON o.id = t.order_id
		WHERE t.claimed_by_user_id = $1 OR o.buyer_user_id = $1
		ORDER BY t.created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list my tickets: %w", err)
	}
	defer rows.Close()

	tickets := []Ticket{}
	for rows.Next() {
		var tk Ticket
		if err := rows.Scan(
			&tk.ID, &tk.OrderID, &tk.TicketTypeID, &tk.EventID, &tk.AgencyID,
			&tk.AttendeeName, &tk.AttendeeEmail, &tk.TicketCode, &tk.QRSignature,
			&tk.ClaimToken, &tk.ClaimedByUserID, &tk.Status, &tk.CheckedInAt, &tk.CheckedInBy, &tk.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan ticket: %w", err)
		}
		tickets = append(tickets, tk)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tickets: %w", err)
	}
	return tickets, nil
}

// TicketDetails combines ticket, event, and ticket type info for rendering PDF/QR.
type TicketDetails struct {
	Ticket         Ticket
	EventTitle     string
	EventType      string
	Venue          string
	StartAt        time.Time
	EndAt          time.Time
	TicketTypeName string
	Price          float64
	Currency       string
}

// GetTicketDetails returns full ticket details by ticket code.
func (s *Service) GetTicketDetails(ctx context.Context, ticketCode string) (TicketDetails, error) {
	ticketCode = strings.TrimSpace(ticketCode)
	if ticketCode == "" {
		return TicketDetails{}, ErrInvalidInput
	}

	query := `
		SELECT 
			t.id, t.order_id, t.ticket_type_id, t.event_id, t.agency_id,
			t.attendee_name, t.attendee_email, t.ticket_code, t.qr_signature,
			t.claim_token, t.claimed_by_user_id, t.status, t.checked_in_at, t.checked_in_by, t.created_at,
			e.title, e.event_type, e.venue, e.start_at, e.end_at,
			tt.name, tt.price::float8, tt.currency
		FROM tickets t
		JOIN events e ON e.id = t.event_id
		JOIN ticket_types tt ON tt.id = t.ticket_type_id
		WHERE t.ticket_code = $1
	`
	var td TicketDetails
	err := s.db.QueryRow(ctx, query, ticketCode).Scan(
		&td.Ticket.ID, &td.Ticket.OrderID, &td.Ticket.TicketTypeID, &td.Ticket.EventID, &td.Ticket.AgencyID,
		&td.Ticket.AttendeeName, &td.Ticket.AttendeeEmail, &td.Ticket.TicketCode, &td.Ticket.QRSignature,
		&td.Ticket.ClaimToken, &td.Ticket.ClaimedByUserID, &td.Ticket.Status, &td.Ticket.CheckedInAt, &td.Ticket.CheckedInBy, &td.Ticket.CreatedAt,
		&td.EventTitle, &td.EventType, &td.Venue, &td.StartAt, &td.EndAt,
		&td.TicketTypeName, &td.Price, &td.Currency,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TicketDetails{}, ErrTicketNotFound
		}
		return TicketDetails{}, fmt.Errorf("query ticket details: %w", err)
	}

	return td, nil
}

// GetTicketQRPNG returns the PNG bytes for a valid ticket's QR code.
func (s *Service) GetTicketQRPNG(ctx context.Context, ticketCode string) ([]byte, error) {
	td, err := s.GetTicketDetails(ctx, ticketCode)
	if err != nil {
		return nil, err
	}
	if td.Ticket.Status != "valid" {
		return nil, ErrTicketNotValid
	}

	payload := td.Ticket.QRSignature
	if payload == "" {
		payload = SignQR(s.qrHMACSecret, td.Ticket.TicketCode, td.Ticket.EventID)
	}

	return GenerateQRPNG(payload)
}

// GetTicketPDFBytes returns the PDF bytes for a valid ticket.
func (s *Service) GetTicketPDFBytes(ctx context.Context, ticketCode string) ([]byte, error) {
	td, err := s.GetTicketDetails(ctx, ticketCode)
	if err != nil {
		return nil, err
	}
	if td.Ticket.Status != "valid" {
		return nil, ErrTicketNotValid
	}

	payload := td.Ticket.QRSignature
	if payload == "" {
		payload = SignQR(s.qrHMACSecret, td.Ticket.TicketCode, td.Ticket.EventID)
	}
	qrPNG, err := GenerateQRPNG(payload)
	if err != nil {
		return nil, fmt.Errorf("generate qr png: %w", err)
	}

	pdfData := TicketPDFData{
		TicketCode:     td.Ticket.TicketCode,
		EventTitle:     td.EventTitle,
		EventType:      td.EventType,
		Venue:          td.Venue,
		StartAt:        td.StartAt,
		EndAt:          td.EndAt,
		AttendeeName:   td.Ticket.AttendeeName,
		AttendeeEmail:  td.Ticket.AttendeeEmail,
		TicketTypeName: td.TicketTypeName,
		Price:          td.Price,
		Currency:       td.Currency,
	}

	return GenerateTicketPDF(pdfData, qrPNG)
}

// SendOrderTicketEmails generates QR PNGs and ticket PDFs for all valid tickets in an order
// and dispatches transactional emails via mailer. Mailer or rendering errors are logged without
// failing the already-committed order confirmation.
func SendOrderTicketEmails(ctx context.Context, db *pgxpool.Pool, mailer platform.Mailer, qrHMACSecret, orderID string) {
	if mailer == nil || db == nil {
		return
	}

	rows, err := db.Query(ctx, `
		SELECT
			t.id, t.order_id, t.ticket_type_id, t.event_id, t.agency_id,
			t.attendee_name, t.attendee_email, t.ticket_code, t.qr_signature,
			t.claim_token, t.claimed_by_user_id, t.status, t.checked_in_at, t.checked_in_by, t.created_at,
			e.title, e.event_type, e.venue, e.start_at, e.end_at,
			tt.name, tt.price::float8, tt.currency
		FROM tickets t
		JOIN events e ON e.id = t.event_id
		JOIN ticket_types tt ON tt.id = t.ticket_type_id
		WHERE t.order_id = $1 AND t.status = 'valid'
		ORDER BY t.created_at ASC
	`, orderID)
	if err != nil {
		log.Printf("ticketing: query confirmed tickets for email dispatch (order %s): %v", orderID, err)
		return
	}
	defer rows.Close()

	var details []TicketDetails
	for rows.Next() {
		var td TicketDetails
		if err := rows.Scan(
			&td.Ticket.ID, &td.Ticket.OrderID, &td.Ticket.TicketTypeID, &td.Ticket.EventID, &td.Ticket.AgencyID,
			&td.Ticket.AttendeeName, &td.Ticket.AttendeeEmail, &td.Ticket.TicketCode, &td.Ticket.QRSignature,
			&td.Ticket.ClaimToken, &td.Ticket.ClaimedByUserID, &td.Ticket.Status, &td.Ticket.CheckedInAt, &td.Ticket.CheckedInBy, &td.Ticket.CreatedAt,
			&td.EventTitle, &td.EventType, &td.Venue, &td.StartAt, &td.EndAt,
			&td.TicketTypeName, &td.Price, &td.Currency,
		); err != nil {
			log.Printf("ticketing: scan confirmed ticket for email dispatch (order %s): %v", orderID, err)
			return
		}
		details = append(details, td)
	}
	if err := rows.Err(); err != nil {
		log.Printf("ticketing: iterate confirmed tickets for email dispatch (order %s): %v", orderID, err)
		return
	}

	for _, td := range details {
		payload := td.Ticket.QRSignature
		if payload == "" {
			payload = SignQR(qrHMACSecret, td.Ticket.TicketCode, td.Ticket.EventID)
		}

		qrPNG, err := GenerateQRPNG(payload)
		if err != nil {
			log.Printf("ticketing: generate QR PNG for ticket %s: %v", td.Ticket.TicketCode, err)
			continue
		}

		pdfData := TicketPDFData{
			TicketCode:     td.Ticket.TicketCode,
			EventTitle:     td.EventTitle,
			EventType:      td.EventType,
			Venue:          td.Venue,
			StartAt:        td.StartAt,
			EndAt:          td.EndAt,
			AttendeeName:   td.Ticket.AttendeeName,
			AttendeeEmail:  td.Ticket.AttendeeEmail,
			TicketTypeName: td.TicketTypeName,
			Price:          td.Price,
			Currency:       td.Currency,
		}
		pdfBytes, err := GenerateTicketPDF(pdfData, qrPNG)
		if err != nil {
			log.Printf("ticketing: generate PDF for ticket %s: %v", td.Ticket.TicketCode, err)
			continue
		}

		cleanTitle := strings.NewReplacer("\r", " ", "\n", " ").Replace(td.EventTitle)
		subject := fmt.Sprintf("Your BEO Ticket: %s (%s)", cleanTitle, td.Ticket.TicketCode)
		htmlBody := fmt.Sprintf(
			"<h1>Your Ticket is Confirmed</h1>"+
				"<p>Hi %s,</p>"+
				"<p>Your ticket for <strong>%s</strong> (%s) at <strong>%s</strong> on %s is ready.</p>"+
				"<p>Ticket Code: <strong>%s</strong></p>"+
				"<p>Your QR code and printable PDF ticket are attached.</p>",
			html.EscapeString(td.Ticket.AttendeeName),
			html.EscapeString(td.EventTitle),
			html.EscapeString(td.TicketTypeName),
			html.EscapeString(td.Venue),
			html.EscapeString(td.StartAt.Format("02 Jan 2006 15:04 MST")),
			html.EscapeString(td.Ticket.TicketCode),
		)

		if err := mailer.SendTicketEmail(ctx, td.Ticket.AttendeeEmail, subject, htmlBody, pdfBytes, qrPNG); err != nil {
			log.Printf("ticketing: send ticket email for %s to %s: %v", td.Ticket.TicketCode, td.Ticket.AttendeeEmail, err)
		}
	}
}

type EventAgencyDetail struct {
	ID             string    `json:"id"`
	AgencyID       string    `json:"agency_id"`
	AgencyName     string    `json:"agency_name"`
	AgencyEmail    string    `json:"agency_email"`
	TicketTypeID   string    `json:"ticket_type_id"`
	AllocatedQuota int       `json:"allocated_quota"`
	IssuedCount    int       `json:"issued_count"`
	Status         string    `json:"status"`
	CreatedAt      time.Time `json:"created_at"`
}

// ListEventOrders returns orders for an event, optionally filtered by payment_status.
// Requires the actor to be the event organizer or a co_organizer.
func (s *Service) ListEventOrders(ctx context.Context, eventID, actorID, statusFilter string) ([]Order, error) {
	eventID = strings.TrimSpace(eventID)
	actorID = strings.TrimSpace(actorID)
	statusFilter = strings.TrimSpace(statusFilter)
	if eventID == "" || actorID == "" {
		return nil, ErrInvalidInput
	}

	if statusFilter != "" {
		switch statusFilter {
		case "pending", "pending_verification", "paid", "expired", "rejected":
		default:
			return nil, ErrInvalidInput
		}
	}

	if err := s.requireOrganizerOrCoOrganizer(ctx, eventID, actorID); err != nil {
		return nil, err
	}

	query := `
		SELECT id, event_id, buyer_user_id, agency_id, buyer_email, total_amount::float8,
		       payment_method, payment_status, duitku_reference, proof_file_url, expires_at, created_at, updated_at
		FROM orders
		WHERE event_id = $1
	`
	args := []any{eventID}
	if statusFilter != "" {
		query += " AND payment_status = $2"
		args = append(args, statusFilter)
	}
	query += " ORDER BY created_at DESC"

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query event orders: %w", err)
	}
	defer rows.Close()

	orders := []Order{}
	for rows.Next() {
		var o Order
		if err := rows.Scan(
			&o.ID,
			&o.EventID,
			&o.BuyerUserID,
			&o.AgencyID,
			&o.BuyerEmail,
			&o.TotalAmount,
			&o.PaymentMethod,
			&o.PaymentStatus,
			&o.DuitkuReference,
			&o.ProofFileURL,
			&o.ExpiresAt,
			&o.CreatedAt,
			&o.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan event order: %w", err)
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate event orders: %w", err)
	}

	return orders, nil
}

// ListEventAgencies returns agency quota allocations for an event joined with user details.
// Requires the actor to be the event organizer or a co_organizer.
func (s *Service) ListEventAgencies(ctx context.Context, eventID, actorID string) ([]EventAgencyDetail, error) {
	eventID = strings.TrimSpace(eventID)
	actorID = strings.TrimSpace(actorID)
	if eventID == "" || actorID == "" {
		return nil, ErrInvalidInput
	}

	if err := s.requireOrganizerOrCoOrganizer(ctx, eventID, actorID); err != nil {
		return nil, err
	}

	rows, err := s.db.Query(ctx, `
		SELECT ea.id, ea.agency_user_id, u.name, u.email, ea.ticket_type_id,
		       ea.quota_limit, ea.issued_count, ea.status, ea.created_at
		FROM event_agencies ea
		JOIN users u ON u.id = ea.agency_user_id
		WHERE ea.event_id = $1
		ORDER BY ea.created_at DESC
	`, eventID)
	if err != nil {
		return nil, fmt.Errorf("query event agencies: %w", err)
	}
	defer rows.Close()

	agencies := []EventAgencyDetail{}
	for rows.Next() {
		var a EventAgencyDetail
		if err := rows.Scan(
			&a.ID,
			&a.AgencyID,
			&a.AgencyName,
			&a.AgencyEmail,
			&a.TicketTypeID,
			&a.AllocatedQuota,
			&a.IssuedCount,
			&a.Status,
			&a.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan event agency: %w", err)
		}
		agencies = append(agencies, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate event agencies: %w", err)
	}

	return agencies, nil
}

