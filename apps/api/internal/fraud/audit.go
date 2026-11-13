package fraud

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalidAuditInput = errors.New("invalid audit event input")

// VectorStore defines an extension hook for indexing and querying fraud/audit event embeddings.
type VectorStore interface {
	IndexEventVector(ctx context.Context, id string, vector []float32, meta map[string]any) error
	SearchSimilarPatterns(ctx context.Context, vector []float32, limit int) ([]string, error)
}

// NoopVectorStore is a no-op VectorStore implementation used when vector indexing is disabled.
type NoopVectorStore struct{}

func (NoopVectorStore) IndexEventVector(ctx context.Context, id string, vector []float32, meta map[string]any) error {
	return nil
}

func (NoopVectorStore) SearchSimilarPatterns(ctx context.Context, vector []float32, limit int) ([]string, error) {
	return nil, nil
}

// AuditEventInput contains the fields recorded in audit_events.
type AuditEventInput struct {
	EventID       string
	ActorID       string
	EventCategory string
	Payload       map[string]any
	IPAddress     string
	UserAgent     string
}

// AuditLogger persists security and fraud audit events and optionally indexes them in a VectorStore.
type AuditLogger struct {
	db    *pgxpool.Pool
	store VectorStore
}

// NewAuditLogger creates an AuditLogger backed by Postgres and an optional VectorStore.
func NewAuditLogger(db *pgxpool.Pool, store VectorStore) *AuditLogger {
	if store == nil {
		store = NoopVectorStore{}
	}
	return &AuditLogger{
		db:    db,
		store: store,
	}
}

// Log inserts an audit event into audit_events and forwards metadata to the VectorStore hook.
func (l *AuditLogger) Log(ctx context.Context, in AuditEventInput) error {
	category := strings.TrimSpace(in.EventCategory)
	if category == "" {
		return ErrInvalidAuditInput
	}

	payload := in.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal audit payload: %w", err)
	}

	id := uuid.NewString()
	const query = `
		INSERT INTO audit_events (id, event_id, actor_id, event_category, payload, ip_address, user_agent, created_at)
		VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), $4, $5::jsonb, $6, $7, NOW())
	`
	if _, err := l.db.Exec(
		ctx,
		query,
		id,
		strings.TrimSpace(in.EventID),
		strings.TrimSpace(in.ActorID),
		category,
		string(payloadBytes),
		strings.TrimSpace(in.IPAddress),
		strings.TrimSpace(in.UserAgent),
	); err != nil {
		return fmt.Errorf("insert audit event: %w", err)
	}

	if l.store != nil {
		_ = l.store.IndexEventVector(ctx, id, nil, payload)
	}

	return nil
}
