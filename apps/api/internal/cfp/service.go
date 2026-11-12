package cfp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidInput       = errors.New("invalid input")
	ErrForbidden          = errors.New("forbidden")
	ErrEventNotFound      = errors.New("event not found")
	ErrSubmissionNotFound = errors.New("submission not found")
)

// RoleChecker verifies whether a user holds an organizer or delegated role on an event.
type RoleChecker interface {
	HasEventRole(ctx context.Context, eventID, userID string, roles ...string) (bool, error)
}

// Submission represents a paper or talk proposal submitted to a conference CFP.
type Submission struct {
	ID           string    `json:"id"`
	EventID      string    `json:"event_id"`
	AuthorUserID string    `json:"author_user_id"`
	Track        string    `json:"track"`
	Title        string    `json:"title"`
	Abstract     string    `json:"abstract"`
	FileURL      string    `json:"file_url"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Review represents a reviewer assignment and score for a CFP submission.
type Review struct {
	ID             string    `json:"id"`
	SubmissionID   string    `json:"submission_id"`
	ReviewerUserID string    `json:"reviewer_user_id"`
	Score          int       `json:"score"`
	Comments       string    `json:"comments"`
	Recommendation string    `json:"recommendation"`
	CreatedAt      time.Time `json:"created_at"`
}

// SubmitPaperInput carries the fields required to submit a paper to a conference CFP.
type SubmitPaperInput struct {
	Track    string `json:"track"`
	Title    string `json:"title"`
	Abstract string `json:"abstract"`
	FileURL  string `json:"file_url"`
}

// Service manages the conference Call for Papers workflow.
type Service struct {
	db          *pgxpool.Pool
	roleChecker RoleChecker
}

// NewService creates a new CFP Service.
func NewService(db *pgxpool.Pool, roleChecker RoleChecker) *Service {
	return &Service{
		db:          db,
		roleChecker: roleChecker,
	}
}

func (s *Service) requireOrganizer(ctx context.Context, eventID, actorID string) error {
	if s.roleChecker == nil {
		return ErrForbidden
	}
	ok, err := s.roleChecker.HasEventRole(ctx, eventID, actorID, "co_organizer")
	if err != nil {
		return fmt.Errorf("check event role: %w", err)
	}
	if !ok {
		return ErrForbidden
	}
	return nil
}

// SubmitPaper creates a new CFP submission for an event.
func (s *Service) SubmitPaper(ctx context.Context, eventID, authorID string, in SubmitPaperInput) (Submission, error) {
	eventID = strings.TrimSpace(eventID)
	authorID = strings.TrimSpace(authorID)
	title := strings.TrimSpace(in.Title)
	if eventID == "" || authorID == "" || title == "" {
		return Submission{}, ErrInvalidInput
	}

	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM events WHERE id = $1)`, eventID).Scan(&exists); err != nil {
		return Submission{}, fmt.Errorf("check event existence: %w", err)
	}
	if !exists {
		return Submission{}, ErrEventNotFound
	}

	subID := uuid.NewString()
	var sub Submission
	err := s.db.QueryRow(ctx, `
		INSERT INTO cfp_submissions (id, event_id, author_user_id, track, title, abstract, file_url, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', NOW(), NOW())
		RETURNING id, event_id, author_user_id, track, title, abstract, file_url, status, created_at, updated_at
	`,
		subID,
		eventID,
		authorID,
		strings.TrimSpace(in.Track),
		title,
		strings.TrimSpace(in.Abstract),
		strings.TrimSpace(in.FileURL),
	).Scan(
		&sub.ID,
		&sub.EventID,
		&sub.AuthorUserID,
		&sub.Track,
		&sub.Title,
		&sub.Abstract,
		&sub.FileURL,
		&sub.Status,
		&sub.CreatedAt,
		&sub.UpdatedAt,
	)
	if err != nil {
		return Submission{}, fmt.Errorf("insert cfp submission: %w", err)
	}

	return sub, nil
}

// AssignReviewer assigns a reviewer to a CFP submission and moves submitted papers to under_review.
func (s *Service) AssignReviewer(ctx context.Context, eventID, actorID, submissionID, reviewerID string) error {
	eventID = strings.TrimSpace(eventID)
	actorID = strings.TrimSpace(actorID)
	submissionID = strings.TrimSpace(submissionID)
	reviewerID = strings.TrimSpace(reviewerID)
	if eventID == "" || actorID == "" || submissionID == "" || reviewerID == "" {
		return ErrInvalidInput
	}

	if err := s.requireOrganizer(ctx, eventID, actorID); err != nil {
		return err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin assign reviewer tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var foundID string
	err = tx.QueryRow(ctx, `SELECT id FROM cfp_submissions WHERE id = $1 AND event_id = $2`, submissionID, eventID).Scan(&foundID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrSubmissionNotFound
		}
		return fmt.Errorf("query cfp submission: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO cfp_reviews (id, submission_id, reviewer_user_id, score, comments, recommendation, created_at)
		VALUES ($1, $2, $3, 0, '', '', NOW())
		ON CONFLICT (submission_id, reviewer_user_id) DO NOTHING
	`, uuid.NewString(), submissionID, reviewerID); err != nil {
		return fmt.Errorf("assign reviewer: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE cfp_submissions
		SET status = 'under_review', updated_at = NOW()
		WHERE id = $1 AND status = 'submitted'
	`, submissionID); err != nil {
		return fmt.Errorf("update submission status: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit assign reviewer tx: %w", err)
	}

	return nil
}

// SubmitReview records a score, comments, and recommendation from an assigned reviewer.
func (s *Service) SubmitReview(ctx context.Context, submissionID, reviewerID string, score int, comments, rec string) error {
	submissionID = strings.TrimSpace(submissionID)
	reviewerID = strings.TrimSpace(reviewerID)
	if submissionID == "" || reviewerID == "" || score < 1 || score > 10 {
		return ErrInvalidInput
	}

	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cfp_submissions WHERE id = $1)`, submissionID).Scan(&exists); err != nil {
		return fmt.Errorf("check submission existence: %w", err)
	}
	if !exists {
		return ErrSubmissionNotFound
	}

	tag, err := s.db.Exec(ctx, `
		UPDATE cfp_reviews
		SET score = $1, comments = $2, recommendation = $3
		WHERE submission_id = $4 AND reviewer_user_id = $5
	`, score, strings.TrimSpace(comments), strings.TrimSpace(rec), submissionID, reviewerID)
	if err != nil {
		return fmt.Errorf("update cfp review: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrForbidden
	}

	return nil
}

// DecideSubmission sets the final or intermediate review decision on a CFP submission.
func (s *Service) DecideSubmission(ctx context.Context, eventID, actorID, submissionID, decision string) error {
	eventID = strings.TrimSpace(eventID)
	actorID = strings.TrimSpace(actorID)
	submissionID = strings.TrimSpace(submissionID)
	decision = strings.TrimSpace(decision)
	if eventID == "" || actorID == "" || submissionID == "" {
		return ErrInvalidInput
	}

	switch decision {
	case "under_review", "revision_required", "accepted", "rejected":
	default:
		return ErrInvalidInput
	}

	if err := s.requireOrganizer(ctx, eventID, actorID); err != nil {
		return err
	}

	tag, err := s.db.Exec(ctx, `
		UPDATE cfp_submissions
		SET status = $1, updated_at = NOW()
		WHERE id = $2 AND event_id = $3
	`, decision, submissionID, eventID)
	if err != nil {
		return fmt.Errorf("update submission decision: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrSubmissionNotFound
	}

	return nil
}

// ListSubmissions lists CFP submissions visible to actorID for an event.
// Organizers see all submissions; authors and assigned reviewers see their own.
func (s *Service) ListSubmissions(ctx context.Context, eventID, actorID string) ([]Submission, error) {
	eventID = strings.TrimSpace(eventID)
	actorID = strings.TrimSpace(actorID)
	if eventID == "" || actorID == "" {
		return nil, ErrInvalidInput
	}

	isOrg := false
	if s.roleChecker != nil {
		ok, err := s.roleChecker.HasEventRole(ctx, eventID, actorID, "co_organizer")
		if err != nil {
			return nil, fmt.Errorf("check event role: %w", err)
		}
		isOrg = ok
	}

	var rows pgx.Rows
	var err error
	if isOrg {
		rows, err = s.db.Query(ctx, `
			SELECT id, event_id, author_user_id, track, title, abstract, file_url, status, created_at, updated_at
			FROM cfp_submissions
			WHERE event_id = $1
			ORDER BY created_at DESC
		`, eventID)
	} else {
		rows, err = s.db.Query(ctx, `
			SELECT DISTINCT s.id, s.event_id, s.author_user_id, s.track, s.title, s.abstract, s.file_url, s.status, s.created_at, s.updated_at
			FROM cfp_submissions s
			LEFT JOIN cfp_reviews r ON r.submission_id = s.id
			WHERE s.event_id = $1 AND (s.author_user_id = $2 OR r.reviewer_user_id = $2)
			ORDER BY s.created_at DESC
		`, eventID, actorID)
	}
	if err != nil {
		return nil, fmt.Errorf("list cfp submissions: %w", err)
	}
	defer rows.Close()

	subs := make([]Submission, 0)
	for rows.Next() {
		var sub Submission
		if err := rows.Scan(
			&sub.ID,
			&sub.EventID,
			&sub.AuthorUserID,
			&sub.Track,
			&sub.Title,
			&sub.Abstract,
			&sub.FileURL,
			&sub.Status,
			&sub.CreatedAt,
			&sub.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan cfp submission: %w", err)
		}
		subs = append(subs, sub)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate cfp submissions: %w", err)
	}

	return subs, nil
}
