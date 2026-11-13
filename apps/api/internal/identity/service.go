package identity

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidAccountType = errors.New("invalid account type")
	ErrEmailExists        = errors.New("email already exists")
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrForbidden          = errors.New("forbidden")
	ErrUserNotFound       = errors.New("user not found")
	ErrEventNotFound      = errors.New("event not found")
	ErrInvalidRole        = errors.New("invalid event role")
	ErrInvalidInput       = errors.New("invalid input")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrEmptyJWTSecret     = errors.New("jwt secret cannot be empty")
)

type AccountType string

const (
	AccountTypeStandard      AccountType = "standard"
	AccountTypeAgency        AccountType = "agency"
	AccountTypePlatformAdmin AccountType = "platform_admin"
)

type User struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Email          string    `json:"email"`
	AccountType    string    `json:"account_type"`
	ExpoPushTokens []string  `json:"expo_push_tokens,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

type RegisterInput struct {
	Name        string `json:"name"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	AccountType string `json:"account_type"`
}

type Service struct {
	db        *pgxpool.Pool
	jwtSecret string
}

func NewService(db *pgxpool.Pool, jwtSecret string) *Service {
	if strings.TrimSpace(jwtSecret) == "" {
		panic("identity: jwtSecret cannot be empty")
	}
	return &Service{
		db:        db,
		jwtSecret: jwtSecret,
	}
}

// Register creates a new user, hashes the password using bcrypt, enforces account_type rules,
// and returns the created User along with a signed JWT token.
func (s *Service) Register(ctx context.Context, in RegisterInput) (User, string, error) {
	name := strings.TrimSpace(in.Name)
	email := strings.ToLower(strings.TrimSpace(in.Email))
	password := in.Password
	accountType := strings.TrimSpace(in.AccountType)

	if name == "" || email == "" || password == "" {
		return User{}, "", fmt.Errorf("%w: name, email, and password are required", ErrInvalidInput)
	}

	if accountType == "" {
		accountType = string(AccountTypeStandard)
	}

	// Self-registration only allows standard and agency. Platform admin cannot be self-registered.
	if accountType != string(AccountTypeStandard) && accountType != string(AccountTypeAgency) {
		return User{}, "", ErrInvalidAccountType
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return User{}, "", fmt.Errorf("hash password: %w", err)
	}

	userID := uuid.NewString()
	now := time.Now().UTC()

	var user User
	query := `
		INSERT INTO users (id, name, email, password_hash, account_type, expo_push_tokens, created_at)
		VALUES ($1, $2, $3, $4, $5, '{}', $6)
		RETURNING id, name, email, account_type, expo_push_tokens, created_at
	`
	err = s.db.QueryRow(ctx, query, userID, name, email, string(hash), accountType, now).Scan(
		&user.ID,
		&user.Name,
		&user.Email,
		&user.AccountType,
		&user.ExpoPushTokens,
		&user.CreatedAt,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return User{}, "", ErrEmailExists
		}
		return User{}, "", fmt.Errorf("insert user: %w", err)
	}

	token, err := GenerateJWT(user, s.jwtSecret)
	if err != nil {
		return User{}, "", fmt.Errorf("generate jwt: %w", err)
	}

	return user, token, nil
}

// Login validates credentials against bcrypt hash and returns the User and a signed JWT token.
func (s *Service) Login(ctx context.Context, email, password string) (User, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || password == "" {
		return User{}, "", ErrInvalidCredentials
	}

	var user User
	var passwordHash string

	query := `
		SELECT id, name, email, password_hash, account_type, expo_push_tokens, created_at
		FROM users
		WHERE email = $1
	`
	err := s.db.QueryRow(ctx, query, email).Scan(
		&user.ID,
		&user.Name,
		&user.Email,
		&passwordHash,
		&user.AccountType,
		&user.ExpoPushTokens,
		&user.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, "", ErrInvalidCredentials
		}
		return User{}, "", fmt.Errorf("query user: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return User{}, "", ErrInvalidCredentials
	}

	token, err := GenerateJWT(user, s.jwtSecret)
	if err != nil {
		return User{}, "", fmt.Errorf("generate jwt: %w", err)
	}

	return user, token, nil
}

// RegisterPushToken appends an Expo push token to the user's tokens array idempotently.
func (s *Service) RegisterPushToken(ctx context.Context, userID, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return fmt.Errorf("%w: token cannot be empty", ErrInvalidInput)
	}

	query := `
		UPDATE users
		SET expo_push_tokens = CASE
			WHEN $2 = ANY(expo_push_tokens) THEN expo_push_tokens
			ELSE array_append(expo_push_tokens, $2)
		END
		WHERE id = $1
	`
	res, err := s.db.Exec(ctx, query, userID, token)
	if err != nil {
		return fmt.Errorf("update push token: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

// AssignEventMember allows the event organizer to assign a role ('co_organizer', 'reviewer', 'checkin_staff')
// to a user identified by targetEmail. Returns ErrForbidden if actorID is not the event organizer.
func (s *Service) AssignEventMember(ctx context.Context, eventID, actorID, targetEmail, role string) error {
	eventID = strings.TrimSpace(eventID)
	actorID = strings.TrimSpace(actorID)
	targetEmail = strings.ToLower(strings.TrimSpace(targetEmail))
	role = strings.TrimSpace(role)

	switch role {
	case "co_organizer", "reviewer", "checkin_staff":
		// valid role
	default:
		return ErrInvalidRole
	}

	var organizerID string
	err := s.db.QueryRow(ctx, "SELECT organizer_id FROM events WHERE id = $1", eventID).Scan(&organizerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrEventNotFound
		}
		return fmt.Errorf("query event organizer: %w", err)
	}

	if organizerID != actorID {
		return ErrForbidden
	}

	var targetUserID string
	err = s.db.QueryRow(ctx, "SELECT id FROM users WHERE email = $1", targetEmail).Scan(&targetUserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserNotFound
		}
		return fmt.Errorf("query target user: %w", err)
	}

	memberID := uuid.NewString()
	insertQuery := `
		INSERT INTO event_members (id, event_id, user_id, role, created_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (event_id, user_id, role) DO NOTHING
	`
	_, err = s.db.Exec(ctx, insertQuery, memberID, eventID, targetUserID, role)
	if err != nil {
		return fmt.Errorf("assign event member: %w", err)
	}

	return nil
}

// HasEventRole checks if a user has any of the specified roles for an event.
// Returns true if userID is the event organizer (events.organizer_id) OR has a matching role in event_members.
func (s *Service) HasEventRole(ctx context.Context, eventID, userID string, roles ...string) (bool, error) {
	eventID = strings.TrimSpace(eventID)
	userID = strings.TrimSpace(userID)

	if eventID == "" || userID == "" {
		return false, nil
	}

	var hasRole bool
	if len(roles) == 0 {
		query := `
			SELECT (
				EXISTS (SELECT 1 FROM events WHERE id = $1 AND organizer_id = $2)
				OR
				EXISTS (SELECT 1 FROM event_members WHERE event_id = $1 AND user_id = $2)
			)
		`
		err := s.db.QueryRow(ctx, query, eventID, userID).Scan(&hasRole)
		if err != nil {
			return false, fmt.Errorf("check event role: %w", err)
		}
	} else {
		query := `
			SELECT (
				EXISTS (SELECT 1 FROM events WHERE id = $1 AND organizer_id = $2)
				OR
				EXISTS (SELECT 1 FROM event_members WHERE event_id = $1 AND user_id = $2 AND role = ANY($3))
			)
		`
		err := s.db.QueryRow(ctx, query, eventID, userID, roles).Scan(&hasRole)
		if err != nil {
			return false, fmt.Errorf("check event role: %w", err)
		}
	}

	return hasRole, nil
}
