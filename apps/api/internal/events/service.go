package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cerdas-club/beo/apps/api/internal/platform"
)

var (
	ErrInvalidEventType = errors.New("invalid event type")
	ErrInvalidInput     = errors.New("invalid input")
	ErrEventNotFound    = errors.New("event not found")
	ErrForbidden        = errors.New("forbidden")
	ErrSlugExists       = errors.New("event slug already exists")
)

var slugRegex = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type EventType string

const (
	EventTypeCommunity       EventType = "community"
	EventTypeSeminarWorkshop EventType = "seminar_workshop"
	EventTypeConference      EventType = "conference"
	EventTypeMeetupTed       EventType = "meetup_ted"
)

func (t EventType) IsValid() bool {
	switch t {
	case EventTypeCommunity, EventTypeSeminarWorkshop, EventTypeConference, EventTypeMeetupTed:
		return true
	default:
		return false
	}
}

type EventStatus string

const (
	EventStatusDraft     EventStatus = "draft"
	EventStatusPublished EventStatus = "published"
	EventStatusCompleted EventStatus = "completed"
	EventStatusCancelled EventStatus = "cancelled"
)

func (s EventStatus) IsValid() bool {
	switch s {
	case EventStatusDraft, EventStatusPublished, EventStatusCompleted, EventStatusCancelled:
		return true
	default:
		return false
	}
}

type Event struct {
	ID             string                 `json:"id"`
	OrganizerID    string                 `json:"organizer_id"`
	Title          string                 `json:"title"`
	Slug           string                 `json:"slug"`
	EventType      EventType              `json:"event_type"`
	ModulesEnabled map[string]interface{} `json:"modules_enabled"`
	StartAt        time.Time              `json:"start_at"`
	EndAt          time.Time              `json:"end_at"`
	Venue          string                 `json:"venue"`
	Status         EventStatus            `json:"status"`
	CreatedAt      time.Time              `json:"created_at"`
	Sessions       []Session              `json:"sessions,omitempty"`
}

type Session struct {
	ID          string    `json:"id"`
	EventID     string    `json:"event_id"`
	Title       string    `json:"title"`
	SpeakerName string    `json:"speaker_name"`
	SpeakerBio  string    `json:"speaker_bio"`
	StartAt     time.Time `json:"start_at"`
	EndAt       time.Time `json:"end_at"`
	RoomOrStage string    `json:"room_or_stage"`
	CreatedAt   time.Time `json:"created_at"`
}

type Post struct {
	ID          string    `json:"id"`
	EventID     string    `json:"event_id"`
	AuthorID    string    `json:"author_id"`
	Title       string    `json:"title"`
	Body        string    `json:"body"`
	NotifyPush  bool      `json:"notify_push"`
	PublishedAt time.Time `json:"published_at"`
	CreatedAt   time.Time `json:"created_at"`
}

type CreateEventInput struct {
	Title          string                 `json:"title"`
	Slug           string                 `json:"slug"`
	EventType      EventType              `json:"event_type"`
	ModulesEnabled map[string]interface{} `json:"modules_enabled,omitempty"`
	StartAt        time.Time              `json:"start_at"`
	EndAt          time.Time              `json:"end_at"`
	Venue          string                 `json:"venue"`
	Status         EventStatus            `json:"status,omitempty"`
}

type CreateSessionInput struct {
	Title       string    `json:"title"`
	SpeakerName string    `json:"speaker_name"`
	SpeakerBio  string    `json:"speaker_bio"`
	StartAt     time.Time `json:"start_at"`
	EndAt       time.Time `json:"end_at"`
	RoomOrStage string    `json:"room_or_stage"`
}

type CreatePostInput struct {
	Title      string `json:"title"`
	Body       string `json:"body"`
	NotifyPush bool   `json:"notify_push"`
}

// RoleChecker abstracts the permission verification implemented by identity.Service.
type RoleChecker interface {
	HasEventRole(ctx context.Context, eventID, userID string, roles ...string) (bool, error)
}

type Service struct {
	db           *pgxpool.Pool
	roleChecker  RoleChecker
	pushNotifier platform.PushNotifier
}

func NewService(db *pgxpool.Pool, roleChecker RoleChecker, pushNotifier platform.PushNotifier) *Service {
	return &Service{
		db:           db,
		roleChecker:  roleChecker,
		pushNotifier: pushNotifier,
	}
}

// CreateEvent validates input, verifies event_type against the 4 universal types, and persists the event.
func (s *Service) CreateEvent(ctx context.Context, organizerID string, in CreateEventInput) (Event, error) {
	organizerID = strings.TrimSpace(organizerID)
	if organizerID == "" {
		return Event{}, fmt.Errorf("%w: organizerID is required", ErrInvalidInput)
	}

	title := strings.TrimSpace(in.Title)
	if title == "" {
		return Event{}, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}

	slug := strings.ToLower(strings.TrimSpace(in.Slug))
	if slug == "" {
		return Event{}, fmt.Errorf("%w: slug is required", ErrInvalidInput)
	}
	if !slugRegex.MatchString(slug) {
		return Event{}, fmt.Errorf("%w: invalid slug format, must contain only lowercase alphanumeric characters and hyphens", ErrInvalidInput)
	}

	if !in.EventType.IsValid() {
		return Event{}, ErrInvalidEventType
	}

	if in.StartAt.IsZero() || in.EndAt.IsZero() || in.EndAt.Before(in.StartAt) {
		return Event{}, fmt.Errorf("%w: invalid start_at or end_at", ErrInvalidInput)
	}

	status := in.Status
	if status == "" {
		status = EventStatusDraft
	} else if !status.IsValid() {
		return Event{}, fmt.Errorf("%w: invalid event status", ErrInvalidInput)
	}

	modulesEnabled := in.ModulesEnabled
	if modulesEnabled == nil {
		modulesEnabled = make(map[string]interface{})
	}
	modulesJSON, err := json.Marshal(modulesEnabled)
	if err != nil {
		return Event{}, fmt.Errorf("marshal modules_enabled: %w", err)
	}

	eventID := uuid.NewString()
	now := time.Now().UTC()

	query := `
		INSERT INTO events (id, organizer_id, title, slug, event_type, modules_enabled, start_at, end_at, venue, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, organizer_id, title, slug, event_type, modules_enabled, start_at, end_at, venue, status, created_at
	`

	var evt Event
	var scannedModules []byte
	err = s.db.QueryRow(ctx, query,
		eventID, organizerID, title, slug, string(in.EventType), modulesJSON, in.StartAt, in.EndAt, in.Venue, string(status), now,
	).Scan(
		&evt.ID,
		&evt.OrganizerID,
		&evt.Title,
		&evt.Slug,
		&evt.EventType,
		&scannedModules,
		&evt.StartAt,
		&evt.EndAt,
		&evt.Venue,
		&evt.Status,
		&evt.CreatedAt,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return Event{}, ErrSlugExists
		}
		return Event{}, fmt.Errorf("insert event: %w", err)
	}

	evt.ModulesEnabled = make(map[string]interface{})
	if len(scannedModules) > 0 {
		_ = json.Unmarshal(scannedModules, &evt.ModulesEnabled)
	}

	return evt, nil
}

// AddSession checks that actor has organizer or co_organizer role, and inserts an event_session.
func (s *Service) AddSession(ctx context.Context, eventID, actorID string, in CreateSessionInput) (Session, error) {
	eventID = strings.TrimSpace(eventID)
	actorID = strings.TrimSpace(actorID)
	if eventID == "" || actorID == "" {
		return Session{}, fmt.Errorf("%w: eventID and actorID are required", ErrInvalidInput)
	}

	if s.roleChecker != nil {
		hasRole, err := s.roleChecker.HasEventRole(ctx, eventID, actorID, "co_organizer")
		if err != nil {
			return Session{}, fmt.Errorf("check event role: %w", err)
		}
		if !hasRole {
			var exists bool
			_ = s.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM events WHERE id = $1)", eventID).Scan(&exists)
			if !exists {
				return Session{}, ErrEventNotFound
			}
			return Session{}, ErrForbidden
		}
	}

	title := strings.TrimSpace(in.Title)
	if title == "" {
		return Session{}, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}

	if in.StartAt.IsZero() || in.EndAt.IsZero() || in.EndAt.Before(in.StartAt) {
		return Session{}, fmt.Errorf("%w: invalid start_at or end_at", ErrInvalidInput)
	}

	sessionID := uuid.NewString()
	now := time.Now().UTC()

	query := `
		INSERT INTO event_sessions (id, event_id, title, speaker_name, speaker_bio, start_at, end_at, room_or_stage, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, event_id, title, speaker_name, speaker_bio, start_at, end_at, room_or_stage, created_at
	`

	var sess Session
	err := s.db.QueryRow(ctx, query,
		sessionID, eventID, title, strings.TrimSpace(in.SpeakerName), strings.TrimSpace(in.SpeakerBio),
		in.StartAt, in.EndAt, strings.TrimSpace(in.RoomOrStage), now,
	).Scan(
		&sess.ID,
		&sess.EventID,
		&sess.Title,
		&sess.SpeakerName,
		&sess.SpeakerBio,
		&sess.StartAt,
		&sess.EndAt,
		&sess.RoomOrStage,
		&sess.CreatedAt,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return Session{}, ErrEventNotFound
		}
		return Session{}, fmt.Errorf("insert session: %w", err)
	}

	return sess, nil
}

// PublishPost creates an announcement post for an event and, if notify_push is true,
// finds distinct expo_push_tokens belonging to attendees holding valid tickets for the event and dispatches them.
func (s *Service) PublishPost(ctx context.Context, eventID, actorID string, in CreatePostInput) (Post, error) {
	eventID = strings.TrimSpace(eventID)
	actorID = strings.TrimSpace(actorID)
	if eventID == "" || actorID == "" {
		return Post{}, fmt.Errorf("%w: eventID and actorID are required", ErrInvalidInput)
	}

	if s.roleChecker != nil {
		hasRole, err := s.roleChecker.HasEventRole(ctx, eventID, actorID, "co_organizer")
		if err != nil {
			return Post{}, fmt.Errorf("check event role: %w", err)
		}
		if !hasRole {
			var exists bool
			_ = s.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM events WHERE id = $1)", eventID).Scan(&exists)
			if !exists {
				return Post{}, ErrEventNotFound
			}
			return Post{}, ErrForbidden
		}
	}

	title := strings.TrimSpace(in.Title)
	body := strings.TrimSpace(in.Body)
	if title == "" || body == "" {
		return Post{}, fmt.Errorf("%w: title and body are required", ErrInvalidInput)
	}

	postID := uuid.NewString()
	now := time.Now().UTC()

	query := `
		INSERT INTO event_posts (id, event_id, author_id, title, body, notify_push, published_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, event_id, author_id, title, body, notify_push, published_at, created_at
	`

	var post Post
	err := s.db.QueryRow(ctx, query,
		postID, eventID, actorID, title, body, in.NotifyPush, now, now,
	).Scan(
		&post.ID,
		&post.EventID,
		&post.AuthorID,
		&post.Title,
		&post.Body,
		&post.NotifyPush,
		&post.PublishedAt,
		&post.CreatedAt,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			return Post{}, ErrEventNotFound
		}
		return Post{}, fmt.Errorf("insert post: %w", err)
	}

	// Dispatch push notification if requested and notifier is provided
	if in.NotifyPush && s.pushNotifier != nil {
		tokenQuery := `
			SELECT DISTINCT token
			FROM tickets t
			JOIN users u ON t.claimed_by_user_id = u.id
			CROSS JOIN unnest(u.expo_push_tokens) AS token
			WHERE t.event_id = $1
			  AND t.status = 'valid'
			  AND token <> ''
		`
		rows, err := s.db.Query(ctx, tokenQuery, eventID)
		if err != nil {
			return post, fmt.Errorf("query attendee push tokens: %w", err)
		}
		defer rows.Close()

		var tokens []string
		for rows.Next() {
			var tok string
			if err := rows.Scan(&tok); err != nil {
				return post, fmt.Errorf("scan push token: %w", err)
			}
			tokens = append(tokens, tok)
		}
		if err := rows.Err(); err != nil {
			return post, fmt.Errorf("iterate push tokens: %w", err)
		}

		if len(tokens) > 0 {
			data := map[string]string{
				"event_id": eventID,
				"post_id":  post.ID,
			}
			if err := s.pushNotifier.Send(ctx, tokens, post.Title, post.Body, data); err != nil {
				return post, fmt.Errorf("send push notifications: %w", err)
			}
		}
	}

	return post, nil
}

// GetEventBySlug returns the event matching the slug, including its sessions.
func (s *Service) GetEventBySlug(ctx context.Context, slug string) (Event, error) {
	slug = strings.ToLower(strings.TrimSpace(slug))
	if slug == "" {
		return Event{}, ErrEventNotFound
	}

	query := `
		SELECT id, organizer_id, title, slug, event_type, modules_enabled, start_at, end_at, venue, status, created_at
		FROM events
		WHERE slug = $1
	`

	var evt Event
	var scannedModules []byte
	err := s.db.QueryRow(ctx, query, slug).Scan(
		&evt.ID,
		&evt.OrganizerID,
		&evt.Title,
		&evt.Slug,
		&evt.EventType,
		&scannedModules,
		&evt.StartAt,
		&evt.EndAt,
		&evt.Venue,
		&evt.Status,
		&evt.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Event{}, ErrEventNotFound
		}
		return Event{}, fmt.Errorf("query event by slug: %w", err)
	}

	evt.ModulesEnabled = make(map[string]interface{})
	if len(scannedModules) > 0 {
		_ = json.Unmarshal(scannedModules, &evt.ModulesEnabled)
	}

	sessions, err := s.ListSessions(ctx, evt.ID)
	if err != nil {
		return Event{}, fmt.Errorf("list event sessions: %w", err)
	}
	evt.Sessions = sessions

	return evt, nil
}

// GetEventByID returns the event matching the ID.
func (s *Service) GetEventByID(ctx context.Context, id string) (Event, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return Event{}, ErrEventNotFound
	}

	query := `
		SELECT id, organizer_id, title, slug, event_type, modules_enabled, start_at, end_at, venue, status, created_at
		FROM events
		WHERE id = $1
	`

	var evt Event
	var scannedModules []byte
	err := s.db.QueryRow(ctx, query, id).Scan(
		&evt.ID,
		&evt.OrganizerID,
		&evt.Title,
		&evt.Slug,
		&evt.EventType,
		&scannedModules,
		&evt.StartAt,
		&evt.EndAt,
		&evt.Venue,
		&evt.Status,
		&evt.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Event{}, ErrEventNotFound
		}
		return Event{}, fmt.Errorf("query event by id: %w", err)
	}

	evt.ModulesEnabled = make(map[string]interface{})
	if len(scannedModules) > 0 {
		_ = json.Unmarshal(scannedModules, &evt.ModulesEnabled)
	}

	return evt, nil
}

type ListEventsOptions struct {
	Limit  int
	Offset int
}

// ListEvents returns published events ordered by start_at ascending with pagination.
func (s *Service) ListEvents(ctx context.Context, opts ...ListEventsOptions) ([]Event, error) {
	limit := 50
	offset := 0
	if len(opts) > 0 {
		if opts[0].Limit > 0 {
			limit = opts[0].Limit
		}
		if opts[0].Offset > 0 {
			offset = opts[0].Offset
		}
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	query := `
		SELECT id, organizer_id, title, slug, event_type, modules_enabled, start_at, end_at, venue, status, created_at
		FROM events
		WHERE status = 'published'
		ORDER BY start_at ASC
		LIMIT $1 OFFSET $2
	`
	rows, err := s.db.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	var evts []Event
	for rows.Next() {
		var evt Event
		var scannedModules []byte
		if err := rows.Scan(
			&evt.ID,
			&evt.OrganizerID,
			&evt.Title,
			&evt.Slug,
			&evt.EventType,
			&scannedModules,
			&evt.StartAt,
			&evt.EndAt,
			&evt.Venue,
			&evt.Status,
			&evt.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		evt.ModulesEnabled = make(map[string]interface{})
		if len(scannedModules) > 0 {
			_ = json.Unmarshal(scannedModules, &evt.ModulesEnabled)
		}
		evts = append(evts, evt)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate events: %w", err)
	}

	if evts == nil {
		evts = []Event{}
	}
	return evts, nil
}

// ListSessions returns all sessions for an event ordered chronologically.
func (s *Service) ListSessions(ctx context.Context, eventID string) ([]Session, error) {
	query := `
		SELECT id, event_id, title, speaker_name, speaker_bio, start_at, end_at, room_or_stage, created_at
		FROM event_sessions
		WHERE event_id = $1
		ORDER BY start_at ASC
	`
	rows, err := s.db.Query(ctx, query, eventID)
	if err != nil {
		return nil, fmt.Errorf("query sessions: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var sess Session
		if err := rows.Scan(
			&sess.ID,
			&sess.EventID,
			&sess.Title,
			&sess.SpeakerName,
			&sess.SpeakerBio,
			&sess.StartAt,
			&sess.EndAt,
			&sess.RoomOrStage,
			&sess.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		sessions = append(sessions, sess)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sessions: %w", err)
	}

	if sessions == nil {
		sessions = []Session{}
	}
	return sessions, nil
}

// ListPosts returns all published posts for an event ordered by published_at descending.
func (s *Service) ListPosts(ctx context.Context, eventID string) ([]Post, error) {
	query := `
		SELECT id, event_id, author_id, title, body, notify_push, published_at, created_at
		FROM event_posts
		WHERE event_id = $1
		ORDER BY published_at DESC
	`
	rows, err := s.db.Query(ctx, query, eventID)
	if err != nil {
		return nil, fmt.Errorf("query posts: %w", err)
	}
	defer rows.Close()

	var posts []Post
	for rows.Next() {
		var p Post
		if err := rows.Scan(
			&p.ID,
			&p.EventID,
			&p.AuthorID,
			&p.Title,
			&p.Body,
			&p.NotifyPush,
			&p.PublishedAt,
			&p.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan post: %w", err)
		}
		posts = append(posts, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate posts: %w", err)
	}

	if posts == nil {
		posts = []Post{}
	}
	return posts, nil
}

