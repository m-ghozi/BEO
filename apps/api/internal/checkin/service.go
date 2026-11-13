package checkin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cerdas-club/beo/apps/api/internal/fraud"
	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/ticketing"
)

var (
	ErrInvalidInput  = errors.New("invalid check-in input")
	ErrForbidden     = errors.New("forbidden: scanner lacks check-in role for event")
	ErrInvalidTicket = errors.New("invalid or unrecognized ticket")
	ErrDuplicateScan = errors.New("ticket already checked in")
)

// ScanResult represents the outcome of a QR check-in scan.
type ScanResult struct {
	TicketID      string     `json:"ticket_id,omitempty"`
	TicketCode    string     `json:"ticket_code,omitempty"`
	AttendeeName  string     `json:"attendee_name,omitempty"`
	AttendeeEmail string     `json:"attendee_email,omitempty"`
	CheckedInAt   *time.Time `json:"checked_in_at,omitempty"`
	Result        string     `json:"result"`
}

// Service handles atomic venue ticket check-in and fraud/audit logging.
type Service struct {
	db       *pgxpool.Pool
	identity *identity.Service
	audit    *fraud.AuditLogger
	qrSecret string
}

// NewService creates a new check-in Service.
func NewService(db *pgxpool.Pool, identitySvc *identity.Service, auditLogger *fraud.AuditLogger, qrSecret string) *Service {
	if auditLogger == nil {
		auditLogger = fraud.NewAuditLogger(db, nil)
	}
	return &Service{
		db:       db,
		identity: identitySvc,
		audit:    auditLogger,
		qrSecret: qrSecret,
	}
}

// ScanQR verifies a signed QR payload, atomically marks the ticket checked in if eligible,
// records a checkin_logs row, and emits audit_events on invalid or duplicate attempts.
func (s *Service) ScanQR(ctx context.Context, eventID, scannerUserID, qrPayload, scanMode, ip, ua string) (ScanResult, error) {
	eventID = strings.TrimSpace(eventID)
	scannerUserID = strings.TrimSpace(scannerUserID)
	qrPayload = strings.TrimSpace(qrPayload)
	scanMode = strings.TrimSpace(scanMode)

	if eventID == "" || scannerUserID == "" || qrPayload == "" {
		return ScanResult{}, ErrInvalidInput
	}
	if scanMode != "hid" && scanMode != "webcam" && scanMode != "manual" {
		return ScanResult{}, ErrInvalidInput
	}

	hasRole, err := s.identity.HasEventRole(ctx, eventID, scannerUserID, "checkin_staff", "co_organizer")
	if err != nil {
		return ScanResult{}, fmt.Errorf("check scanner role: %w", err)
	}
	if !hasRole {
		return ScanResult{}, ErrForbidden
	}

	var ticketCode string
	if scanMode == "manual" && !strings.Contains(qrPayload, "|") {
		ticketCode = qrPayload
	} else {
		var qrEventID string
		var verifyErr error
		ticketCode, qrEventID, verifyErr = ticketing.VerifyQR(s.qrSecret, qrPayload)
		if verifyErr != nil || qrEventID != eventID {
			var ticketID string
			reason := "invalid_signature"
			if verifyErr == nil && qrEventID != eventID {
				reason = "wrong_event"
				_ = s.db.QueryRow(ctx, `SELECT id FROM tickets WHERE ticket_code = $1`, ticketCode).Scan(&ticketID)
			}
			if logErr := s.recordFailedScan(ctx, ticketID, eventID, scannerUserID, scanMode, "invalid", "checkin_invalid", reason, ticketCode, ip, ua); logErr != nil {
				return ScanResult{}, logErr
			}
			return ScanResult{TicketID: ticketID, TicketCode: ticketCode, Result: "invalid"}, ErrInvalidTicket
		}
	}

	const atomicUpdate = `
		UPDATE tickets
		SET checked_in_at = NOW(), checked_in_by = $1
		WHERE ticket_code = $2 AND event_id = $3 AND status = 'valid' AND checked_in_at IS NULL
		RETURNING id, attendee_name, attendee_email, checked_in_at
	`
	var res ScanResult
	res.TicketCode = ticketCode
	err = s.db.QueryRow(ctx, atomicUpdate, scannerUserID, ticketCode, eventID).Scan(
		&res.TicketID, &res.AttendeeName, &res.AttendeeEmail, &res.CheckedInAt,
	)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return ScanResult{}, fmt.Errorf("atomic ticket check-in: %w", err)
		}
		return s.handleZeroRowsUpdated(ctx, eventID, scannerUserID, ticketCode, scanMode, ip, ua)
	}

	if err := s.insertCheckinLog(ctx, res.TicketID, eventID, scannerUserID, scanMode, "success", map[string]any{
		"ticket_code": ticketCode,
	}); err != nil {
		return ScanResult{}, err
	}

	res.Result = "success"
	return res, nil
}

func (s *Service) handleZeroRowsUpdated(ctx context.Context, eventID, scannerUserID, ticketCode, scanMode, ip, ua string) (ScanResult, error) {
	var ticketID, status string
	var checkedInAt *time.Time
	err := s.db.QueryRow(ctx, `
		SELECT id, status, checked_in_at
		FROM tickets
		WHERE ticket_code = $1 AND event_id = $2
	`, ticketCode, eventID).Scan(&ticketID, &status, &checkedInAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return ScanResult{}, fmt.Errorf("inspect ticket after zero-row update: %w", err)
	}

	if err == nil && status == "valid" && checkedInAt != nil {
		if logErr := s.recordFailedScan(ctx, ticketID, eventID, scannerUserID, scanMode, "duplicate", "checkin_duplicate", "already_checked_in", ticketCode, ip, ua); logErr != nil {
			return ScanResult{}, logErr
		}
		return ScanResult{TicketID: ticketID, TicketCode: ticketCode, Result: "duplicate"}, ErrDuplicateScan
	}

	reason := "ticket_not_found"
	if err == nil {
		reason = "ticket_status_" + status
	}
	if logErr := s.recordFailedScan(ctx, ticketID, eventID, scannerUserID, scanMode, "invalid", "checkin_invalid", reason, ticketCode, ip, ua); logErr != nil {
		return ScanResult{}, logErr
	}
	return ScanResult{TicketID: ticketID, TicketCode: ticketCode, Result: "invalid"}, ErrInvalidTicket
}

func (s *Service) recordFailedScan(ctx context.Context, ticketID, eventID, scannerUserID, scanMode, result, auditCategory, reason, ticketCode, ip, ua string) error {
	meta := map[string]any{
		"reason":      reason,
		"ticket_code": ticketCode,
		"scan_mode":   scanMode,
	}
	if err := s.insertCheckinLog(ctx, ticketID, eventID, scannerUserID, scanMode, result, meta); err != nil {
		return err
	}
	if err := s.audit.Log(ctx, fraud.AuditEventInput{
		EventID:       eventID,
		ActorID:       scannerUserID,
		EventCategory: auditCategory,
		Payload:       meta,
		IPAddress:     ip,
		UserAgent:     ua,
	}); err != nil {
		return fmt.Errorf("log audit event: %w", err)
	}
	return nil
}

func (s *Service) insertCheckinLog(ctx context.Context, ticketID, eventID, scannerUserID, scanMode, result string, metadata map[string]any) error {
	if metadata == nil {
		metadata = map[string]any{}
	}
	metaBytes, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal checkin metadata: %w", err)
	}

	const query = `
		INSERT INTO checkin_logs (id, ticket_id, event_id, scanner_user_id, scan_mode, result, metadata, created_at)
		VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, ''), $5, $6, $7::jsonb, NOW())
	`
	if _, err := s.db.Exec(ctx, query, uuid.NewString(), ticketID, eventID, scannerUserID, scanMode, result, string(metaBytes)); err != nil {
		return fmt.Errorf("insert checkin_log: %w", err)
	}
	return nil
}
