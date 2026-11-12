package identity_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/platform"
)

const testJWTSecret = "test-jwt-secret-key-for-identity-32b"

func setupTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("skipping integration test: TEST_DATABASE_URL not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := platform.OpenDB(ctx, dsn)
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}

	migrationsFS := os.DirFS("../../migrations")
	if err := platform.RunMigrations(ctx, pool, migrationsFS); err != nil {
		t.Fatalf("failed to run migrations: %v", err)
	}

	return pool
}

func TestRegisterAndLogin_StandardAndAgency(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	svc := identity.NewService(pool, testJWTSecret)

	uniqueSuffix := uuid.NewString()[:8]
	stdEmail := fmt.Sprintf("std-%s@example.com", uniqueSuffix)
	agencyEmail := fmt.Sprintf("agency-%s@example.com", uniqueSuffix)
	adminEmail := fmt.Sprintf("admin-%s@example.com", uniqueSuffix)

	// 1. Register a standard user
	stdUser, stdToken, err := svc.Register(ctx, identity.RegisterInput{
		Name:        "Standard User",
		Email:       stdEmail,
		Password:    "StandardSecret123!",
		AccountType: "standard",
	})
	if err != nil {
		t.Fatalf("failed to register standard user: %v", err)
	}
	if stdUser.ID == "" {
		t.Errorf("expected non-empty user ID")
	}
	if stdUser.Email != stdEmail {
		t.Errorf("expected email %s, got %s", stdEmail, stdUser.Email)
	}
	if stdUser.AccountType != "standard" {
		t.Errorf("expected account_type standard, got %s", stdUser.AccountType)
	}
	if stdToken == "" {
		t.Errorf("expected non-empty JWT token")
	}

	// Verify bcrypt password hashing in DB
	var dbHash string
	err = pool.QueryRow(ctx, "SELECT password_hash FROM users WHERE id = $1", stdUser.ID).Scan(&dbHash)
	if err != nil {
		t.Fatalf("failed to query password_hash from db: %v", err)
	}
	if dbHash == "StandardSecret123!" {
		t.Errorf("password must not be stored in plain text")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(dbHash), []byte("StandardSecret123!")); err != nil {
		t.Errorf("stored hash does not match bcrypt password: %v", err)
	}

	// 2. Register an agency user
	agencyUser, agencyToken, err := svc.Register(ctx, identity.RegisterInput{
		Name:        "Agency Partner",
		Email:       agencyEmail,
		Password:    "AgencySecret123!",
		AccountType: "agency",
	})
	if err != nil {
		t.Fatalf("failed to register agency user: %v", err)
	}
	if agencyUser.AccountType != "agency" {
		t.Errorf("expected account_type agency, got %s", agencyUser.AccountType)
	}
	if agencyToken == "" {
		t.Errorf("expected non-empty JWT token for agency")
	}

	// 3. Reject invalid account_type (cannot self-register as platform_admin or arbitrary types)
	_, _, err = svc.Register(ctx, identity.RegisterInput{
		Name:        "Fake Admin",
		Email:       adminEmail,
		Password:    "AdminSecret123!",
		AccountType: "platform_admin",
	})
	if err == nil {
		t.Fatalf("expected error when self-registering as platform_admin, got nil")
	}
	if !errors.Is(err, identity.ErrInvalidAccountType) {
		t.Errorf("expected ErrInvalidAccountType, got: %v", err)
	}

	_, _, err = svc.Register(ctx, identity.RegisterInput{
		Name:        "Fake Role",
		Email:       fmt.Sprintf("fake-%s@example.com", uniqueSuffix),
		Password:    "FakeSecret123!",
		AccountType: "superadmin",
	})
	if !errors.Is(err, identity.ErrInvalidAccountType) {
		t.Errorf("expected ErrInvalidAccountType for arbitrary role, got: %v", err)
	}

	// 4. Reject duplicate email
	_, _, err = svc.Register(ctx, identity.RegisterInput{
		Name:        "Duplicate User",
		Email:       stdEmail,
		Password:    "AnyPassword123!",
		AccountType: "standard",
	})
	if !errors.Is(err, identity.ErrEmailExists) {
		t.Errorf("expected ErrEmailExists for duplicate email, got: %v", err)
	}

	// 5. Login verification
	loggedInUser, loginToken, err := svc.Login(ctx, stdEmail, "StandardSecret123!")
	if err != nil {
		t.Fatalf("failed to login with valid credentials: %v", err)
	}
	if loggedInUser.ID != stdUser.ID {
		t.Errorf("expected user ID %s, got %s", stdUser.ID, loggedInUser.ID)
	}
	if loginToken == "" {
		t.Errorf("expected non-empty login JWT token")
	}

	// Reject invalid password
	_, _, err = svc.Login(ctx, stdEmail, "WrongPassword!")
	if !errors.Is(err, identity.ErrInvalidCredentials) {
		t.Errorf("expected ErrInvalidCredentials on bad password, got: %v", err)
	}

	// Reject unknown email
	_, _, err = svc.Login(ctx, "nonexistent@example.com", "StandardSecret123!")
	if !errors.Is(err, identity.ErrInvalidCredentials) {
		t.Errorf("expected ErrInvalidCredentials on unknown email, got: %v", err)
	}
}

func TestAssignEventMember_EnforcesOrganizerOwnership(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	svc := identity.NewService(pool, testJWTSecret)

	uniqueSuffix := uuid.NewString()[:8]

	// Create users: organizer, non-organizer, reviewer target, checkin staff target
	organizer, _, err := svc.Register(ctx, identity.RegisterInput{
		Name:        "Organizer",
		Email:       fmt.Sprintf("org-%s@example.com", uniqueSuffix),
		Password:    "Pass1234!",
		AccountType: "standard",
	})
	if err != nil {
		t.Fatalf("failed to register organizer: %v", err)
	}

	nonOrganizer, _, err := svc.Register(ctx, identity.RegisterInput{
		Name:        "Non Organizer",
		Email:       fmt.Sprintf("other-%s@example.com", uniqueSuffix),
		Password:    "Pass1234!",
		AccountType: "standard",
	})
	if err != nil {
		t.Fatalf("failed to register non-organizer: %v", err)
	}

	reviewerEmail := fmt.Sprintf("rev-%s@example.com", uniqueSuffix)
	reviewer, _, err := svc.Register(ctx, identity.RegisterInput{
		Name:        "Reviewer",
		Email:       reviewerEmail,
		Password:    "Pass1234!",
		AccountType: "standard",
	})
	if err != nil {
		t.Fatalf("failed to register reviewer: %v", err)
	}

	checkinEmail := fmt.Sprintf("checkin-%s@example.com", uniqueSuffix)
	checkinStaff, _, err := svc.Register(ctx, identity.RegisterInput{
		Name:        "Checkin Staff",
		Email:       checkinEmail,
		Password:    "Pass1234!",
		AccountType: "standard",
	})
	if err != nil {
		t.Fatalf("failed to register checkin staff: %v", err)
	}

	// Create an event owned by organizer
	eventID := uuid.NewString()
	eventSlug := fmt.Sprintf("event-%s", uniqueSuffix)
	_, err = pool.Exec(ctx, `
		INSERT INTO events (id, organizer_id, title, slug, event_type, start_at, end_at, venue, status)
		VALUES ($1, $2, 'Tech Conference 2026', $3, 'conference', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 'Main Hall', 'published')
	`, eventID, organizer.ID, eventSlug)
	if err != nil {
		t.Fatalf("failed to insert test event: %v", err)
	}

	// 1. Organizer assigns reviewer -> success
	err = svc.AssignEventMember(ctx, eventID, organizer.ID, reviewerEmail, "reviewer")
	if err != nil {
		t.Fatalf("organizer failed to assign reviewer: %v", err)
	}

	// 2. Organizer assigns checkin_staff -> success
	err = svc.AssignEventMember(ctx, eventID, organizer.ID, checkinEmail, "checkin_staff")
	if err != nil {
		t.Fatalf("organizer failed to assign checkin_staff: %v", err)
	}

	// 3. Non-organizer caller receives ErrForbidden
	err = svc.AssignEventMember(ctx, eventID, nonOrganizer.ID, reviewerEmail, "checkin_staff")
	if !errors.Is(err, identity.ErrForbidden) {
		t.Fatalf("expected ErrForbidden for non-organizer, got: %v", err)
	}

	// 4. Invalid role rejected
	err = svc.AssignEventMember(ctx, eventID, organizer.ID, reviewerEmail, "superadmin")
	if !errors.Is(err, identity.ErrInvalidRole) {
		t.Fatalf("expected ErrInvalidRole, got: %v", err)
	}

	// 5. Unknown target email rejected
	err = svc.AssignEventMember(ctx, eventID, organizer.ID, "unknown-email@example.com", "reviewer")
	if !errors.Is(err, identity.ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got: %v", err)
	}

	// 6. Verify HasEventRole:
	// - Organizer always has event role (even if not explicitly listed in event_members)
	hasRole, err := svc.HasEventRole(ctx, eventID, organizer.ID, "reviewer")
	if err != nil || !hasRole {
		t.Errorf("organizer must have event role, got %v (err: %v)", hasRole, err)
	}
	hasRole, err = svc.HasEventRole(ctx, eventID, organizer.ID, "checkin_staff")
	if err != nil || !hasRole {
		t.Errorf("organizer must have checkin_staff role, got %v (err: %v)", hasRole, err)
	}
	hasRole, err = svc.HasEventRole(ctx, eventID, organizer.ID)
	if err != nil || !hasRole {
		t.Errorf("organizer must satisfy HasEventRole without specific roles, got %v (err: %v)", hasRole, err)
	}

	// - Reviewer has role reviewer
	hasRole, err = svc.HasEventRole(ctx, eventID, reviewer.ID, "reviewer")
	if err != nil || !hasRole {
		t.Errorf("reviewer should have reviewer role, got %v (err: %v)", hasRole, err)
	}

	// - Reviewer does NOT have checkin_staff role
	hasRole, err = svc.HasEventRole(ctx, eventID, reviewer.ID, "checkin_staff")
	if err != nil || hasRole {
		t.Errorf("reviewer should not have checkin_staff role, got %v (err: %v)", hasRole, err)
	}

	// - Checkin staff has checkin_staff role
	hasRole, err = svc.HasEventRole(ctx, eventID, checkinStaff.ID, "checkin_staff")
	if err != nil || !hasRole {
		t.Errorf("checkinStaff should have checkin_staff role, got %v (err: %v)", hasRole, err)
	}

	// - Non-organizer has neither
	hasRole, err = svc.HasEventRole(ctx, eventID, nonOrganizer.ID, "reviewer", "checkin_staff")
	if err != nil || hasRole {
		t.Errorf("nonOrganizer should have neither role, got %v (err: %v)", hasRole, err)
	}
}

func TestRegisterPushToken(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	svc := identity.NewService(pool, testJWTSecret)

	uniqueSuffix := uuid.NewString()[:8]
	user, _, err := svc.Register(ctx, identity.RegisterInput{
		Name:        "Push User",
		Email:       fmt.Sprintf("push-%s@example.com", uniqueSuffix),
		Password:    "Password123!",
		AccountType: "standard",
	})
	if err != nil {
		t.Fatalf("failed to register user: %v", err)
	}

	token1 := "ExponentPushToken[token-12345]"
	if err := svc.RegisterPushToken(ctx, user.ID, token1); err != nil {
		t.Fatalf("failed to register push token: %v", err)
	}

	// Verify token is in DB
	var tokens []string
	err = pool.QueryRow(ctx, "SELECT expo_push_tokens FROM users WHERE id = $1", user.ID).Scan(&tokens)
	if err != nil {
		t.Fatalf("failed to query tokens: %v", err)
	}
	if len(tokens) != 1 || tokens[0] != token1 {
		t.Fatalf("expected tokens [%s], got %v", token1, tokens)
	}

	// Adding same token again should be idempotent (no duplicate)
	if err := svc.RegisterPushToken(ctx, user.ID, token1); err != nil {
		t.Fatalf("failed on duplicate token registration: %v", err)
	}
	err = pool.QueryRow(ctx, "SELECT expo_push_tokens FROM users WHERE id = $1", user.ID).Scan(&tokens)
	if err != nil {
		t.Fatalf("failed to query tokens: %v", err)
	}
	if len(tokens) != 1 {
		t.Fatalf("expected tokens count 1 after duplicate registration, got %d", len(tokens))
	}

	// Adding second token
	token2 := "ExponentPushToken[token-67890]"
	if err := svc.RegisterPushToken(ctx, user.ID, token2); err != nil {
		t.Fatalf("failed to register second token: %v", err)
	}
	err = pool.QueryRow(ctx, "SELECT expo_push_tokens FROM users WHERE id = $1", user.ID).Scan(&tokens)
	if err != nil {
		t.Fatalf("failed to query tokens: %v", err)
	}
	if len(tokens) != 2 {
		t.Fatalf("expected 2 tokens, got %d", len(tokens))
	}
}

func TestHTTPHandlersAndAuthMiddleware(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	svc := identity.NewService(pool, testJWTSecret)
	handler := identity.NewHandler(svc, testJWTSecret)

	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)

	uniqueSuffix := uuid.NewString()[:8]
	email := fmt.Sprintf("http-%s@example.com", uniqueSuffix)

	// 1. POST /v1/auth/register
	regPayload := map[string]string{
		"name":         "HTTP User",
		"email":        email,
		"password":     "HttpSecret123!",
		"account_type": "standard",
	}
	bodyBytes, _ := json.Marshal(regPayload)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/register", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on register, got %d: %s", w.Code, w.Body.String())
	}
	var regResp struct {
		User  identity.User `json:"user"`
		Token string        `json:"token"`
	}
	if err := json.NewDecoder(w.Body).Decode(&regResp); err != nil {
		t.Fatalf("failed to decode register response: %v", err)
	}
	if regResp.User.Email != email || regResp.Token == "" {
		t.Fatalf("invalid register response: %+v", regResp)
	}

	// 2. POST /v1/auth/login
	loginPayload := map[string]string{
		"email":    email,
		"password": "HttpSecret123!",
	}
	bodyBytes, _ = json.Marshal(loginPayload)
	req = httptest.NewRequest(http.MethodPost, "/v1/auth/login", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on login, got %d: %s", w.Code, w.Body.String())
	}

	// 3. POST /v1/me/push-token (Protected)
	pushPayload := map[string]string{
		"token": "ExponentPushToken[http-device-token]",
	}
	bodyBytes, _ = json.Marshal(pushPayload)

	// Without token -> 401
	req = httptest.NewRequest(http.MethodPost, "/v1/me/push-token", bytes.NewReader(bodyBytes))
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized without auth header, got %d", w.Code)
	}

	// With Bearer token -> 200
	req = httptest.NewRequest(http.MethodPost, "/v1/me/push-token", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+regResp.Token)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK with valid bearer token, got %d: %s", w.Code, w.Body.String())
	}

	// 4. POST /v1/events/{eventID}/members (Protected)
	eventID := uuid.NewString()
	_, err := pool.Exec(ctx, `
		INSERT INTO events (id, organizer_id, title, slug, event_type, start_at, end_at, venue, status)
		VALUES ($1, $2, 'HTTP Event', $3, 'community', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 'Room A', 'published')
	`, eventID, regResp.User.ID, fmt.Sprintf("http-slug-%s", uniqueSuffix))
	if err != nil {
		t.Fatalf("failed to insert test event: %v", err)
	}

	// Target user
	targetUser, _, err := svc.Register(ctx, identity.RegisterInput{
		Name:        "Staff Target",
		Email:       fmt.Sprintf("target-%s@example.com", uniqueSuffix),
		Password:    "Password123!",
		AccountType: "standard",
	})
	if err != nil {
		t.Fatalf("failed to register target user: %v", err)
	}

	memberPayload := map[string]string{
		"email": targetUser.Email,
		"role":  "checkin_staff",
	}
	bodyBytes, _ = json.Marshal(memberPayload)
	req = httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v1/events/%s/members", eventID), bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+regResp.Token)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusCreated && w.Code != http.StatusOK {
		t.Fatalf("expected 200 or 201 on assign member, got %d: %s", w.Code, w.Body.String())
	}
}
