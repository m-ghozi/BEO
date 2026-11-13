package admin_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cerdas-club/beo/apps/api/internal/admin"
	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/ledger"
	"github.com/cerdas-club/beo/apps/api/internal/platform"
)

const testJWTSecret = "test-jwt-secret-key-for-admin-32bytes"

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

func makeToken(t *testing.T, userID, email, accountType string) string {
	t.Helper()
	tok, err := identity.GenerateJWT(identity.User{
		ID:          userID,
		Email:       email,
		AccountType: accountType,
	}, testJWTSecret)
	if err != nil {
		t.Fatalf("GenerateJWT: %v", err)
	}
	return tok
}

func createTestUser(t *testing.T, pool *pgxpool.Pool, prefix, accountType string) identity.User {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	email := fmt.Sprintf("%s-%s@example.com", prefix, uuid.NewString()[:8])
	var u identity.User
	err := pool.QueryRow(ctx, `
		INSERT INTO users (id, name, email, password_hash, account_type, created_at)
		VALUES ($1, $2, $3, 'dummy-hash', $4, NOW())
		RETURNING id, name, email, account_type, created_at
	`, id, prefix+" User", email, accountType).Scan(&u.ID, &u.Name, &u.Email, &u.AccountType, &u.CreatedAt)
	if err != nil {
		t.Fatalf("createTestUser: %v", err)
	}
	return u
}

func TestAdminGuard_RejectsUnauthenticatedAndNonPlatformAdmin(t *testing.T) {
	handler := admin.NewHandler(admin.NewService(nil), testJWTSecret).Routes()

	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/v1/admin/overview"},
		{http.MethodGet, "/v1/admin/events"},
		{http.MethodGet, "/v1/admin/users"},
		{http.MethodGet, "/v1/admin/commissions"},
		{http.MethodPut, "/v1/admin/commissions/community"},
		{http.MethodGet, "/v1/admin/payouts"},
		{http.MethodPost, "/v1/admin/payouts/p-1/process"},
		{http.MethodGet, "/v1/admin/audit-events"},
	}

	stdToken := makeToken(t, "u-std", "std@example.com", "standard")
	agencyToken := makeToken(t, "u-agy", "agency@example.com", "agency")

	for _, rt := range routes {
		// Unauthenticated -> 401
		req := httptest.NewRequest(rt.method, rt.path, nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s without token: expected 401, got %d", rt.method, rt.path, rec.Code)
		}

		// Standard user -> 403 {"error":"platform_admin required"}
		for _, tc := range []struct {
			name  string
			token string
		}{
			{"standard", stdToken},
			{"agency", agencyToken},
		} {
			req = httptest.NewRequest(rt.method, rt.path, nil)
			req.Header.Set("Authorization", "Bearer "+tc.token)
			rec = httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("%s %s as %s: expected 403, got %d", rt.method, rt.path, tc.name, rec.Code)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode 403 body: %v", err)
			}
			if body["error"] != "platform_admin required" {
				t.Fatalf("%s %s as %s: expected error 'platform_admin required', got %q", rt.method, rt.path, tc.name, body["error"])
			}
		}
	}
}

func TestValidateCommissionInput(t *testing.T) {
	for _, valid := range []string{"community", "seminar_workshop", "conference", "meetup_ted"} {
		if err := admin.ValidateCommissionInput(valid, 0); err != nil {
			t.Fatalf("expected %q with 0 to be valid, got %v", valid, err)
		}
		if err := admin.ValidateCommissionInput(valid, 100); err != nil {
			t.Fatalf("expected %q with 100 to be valid, got %v", valid, err)
		}
	}

	if err := admin.ValidateCommissionInput("unknown", 5); !errors.Is(err, admin.ErrInvalidEventType) {
		t.Fatalf("expected ErrInvalidEventType, got %v", err)
	}
	for _, badRate := range []float64{-0.1, 100.1, math.NaN(), math.Inf(1)} {
		if err := admin.ValidateCommissionInput("community", badRate); !errors.Is(err, admin.ErrInvalidCommissionRate) {
			t.Fatalf("expected ErrInvalidCommissionRate for %v, got %v", badRate, err)
		}
	}
}

func TestUpdateCommissionHandler_Validation(t *testing.T) {
	handler := admin.NewHandler(admin.NewService(nil), testJWTSecret).Routes()
	adminToken := makeToken(t, "u-admin", "admin@example.com", "platform_admin")

	req := httptest.NewRequest(http.MethodPut, "/v1/admin/commissions/invalid_type", bytes.NewBufferString(`{"rate_percent":5}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid eventType, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPut, "/v1/admin/commissions/community", bytes.NewBufferString(`{"rate_percent":120}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for rate > 100, got %d", rec.Code)
	}
}

func TestAdminOverviewEventsUsersAudit_Integration(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	adminUser := createTestUser(t, pool, "admin", "platform_admin")
	organizer := createTestUser(t, pool, "org", "standard")
	adminToken := makeToken(t, adminUser.ID, adminUser.Email, adminUser.AccountType)

	eventID := uuid.NewString()
	slug := "admin-test-" + uuid.NewString()[:8]
	_, err := pool.Exec(ctx, `
		INSERT INTO events (id, organizer_id, title, slug, event_type, start_at, end_at, venue, status)
		VALUES ($1, $2, 'Admin Test Event', $3, 'conference', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 'Jakarta', 'draft')
	`, eventID, organizer.ID, slug)
	if err != nil {
		t.Fatalf("insert event: %v", err)
	}

	orderID := uuid.NewString()
	_, err = pool.Exec(ctx, `
		INSERT INTO orders (id, event_id, buyer_user_id, buyer_email, total_amount, payment_method, payment_status)
		VALUES ($1, $2, $3, $4, 100000, 'duitku', 'paid')
	`, orderID, eventID, organizer.ID, organizer.Email)
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}

	ledgerSvc := ledger.NewService(pool)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	if err := ledgerSvc.RecordPaidOrder(ctx, tx, orderID); err != nil {
		t.Fatalf("RecordPaidOrder: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit tx: %v", err)
	}

	handler := admin.NewHandler(admin.NewService(pool), testJWTSecret).Routes()

	// Overview
	req := httptest.NewRequest(http.MethodGet, "/v1/admin/overview", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("overview expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var ov admin.Overview
	if err := json.Unmarshal(rec.Body.Bytes(), &ov); err != nil {
		t.Fatalf("decode overview: %v", err)
	}
	if ov.TotalUsers < 2 || ov.TotalEvents < 1 || ov.PaidOrders < 1 || ov.GrossRevenue < 100000 || ov.TotalCommission < 1 {
		t.Fatalf("unexpected overview metrics: %+v", ov)
	}

	// Events
	req = httptest.NewRequest(http.MethodGet, "/v1/admin/events", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("events expected 200, got %d", rec.Code)
	}
	var evts []admin.AdminEvent
	if err := json.Unmarshal(rec.Body.Bytes(), &evts); err != nil {
		t.Fatalf("decode events: %v", err)
	}
	if len(evts) == 0 {
		t.Fatalf("expected at least 1 event")
	}

	// Users
	req = httptest.NewRequest(http.MethodGet, "/v1/admin/users", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("users expected 200, got %d", rec.Code)
	}
	var users []admin.AdminUser
	if err := json.Unmarshal(rec.Body.Bytes(), &users); err != nil {
		t.Fatalf("decode users: %v", err)
	}
	if len(users) < 2 {
		t.Fatalf("expected at least 2 users")
	}

	// Audit events
	req = httptest.NewRequest(http.MethodGet, "/v1/admin/audit-events", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("audit-events expected 200, got %d", rec.Code)
	}
}

func TestAdminCommissions_Integration(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	adminUser := createTestUser(t, pool, "admin-comm", "platform_admin")
	adminToken := makeToken(t, adminUser.ID, adminUser.Email, adminUser.AccountType)
	handler := admin.NewHandler(admin.NewService(pool), testJWTSecret).Routes()

	req := httptest.NewRequest(http.MethodGet, "/v1/admin/commissions", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET commissions expected 200, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPut, "/v1/admin/commissions/community", bytes.NewBufferString(`{"rate_percent":3.5}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT commission expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var updated admin.CommissionRate
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode commission: %v", err)
	}
	if updated.EventType != "community" || updated.RatePercent != 3.5 {
		t.Fatalf("unexpected updated commission: %+v", updated)
	}
}

func TestAdminPayouts_ApproveCompleteReject_Integration(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()

	ctx := context.Background()
	adminUser := createTestUser(t, pool, "admin-payout", "platform_admin")
	organizer := createTestUser(t, pool, "org-payout", "standard")
	adminToken := makeToken(t, adminUser.ID, adminUser.Email, adminUser.AccountType)

	eventID := uuid.NewString()
	_, err := pool.Exec(ctx, `
		INSERT INTO events (id, organizer_id, title, slug, event_type, start_at, end_at, venue, status)
		VALUES ($1, $2, 'Payout Event', $3, 'community', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 'Bandung', 'published')
	`, eventID, organizer.ID, "payout-evt-"+uuid.NewString()[:8])
	if err != nil {
		t.Fatalf("insert event: %v", err)
	}

	// Credit 100000 to organizer ledger
	_, err = pool.Exec(ctx, `
		INSERT INTO ledger_entries (id, organizer_id, event_id, order_id, entry_type, amount)
		VALUES ($1, $2, $3, NULL, 'ticket_sale_gross', 100000)
	`, uuid.NewString(), organizer.ID, eventID)
	if err != nil {
		t.Fatalf("insert ledger credit: %v", err)
	}

	ledgerSvc := ledger.NewService(pool)
	p1, err := ledgerSvc.RequestPayout(ctx, organizer.ID, ledger.PayoutInput{
		Amount:            40000,
		BankName:          "BCA",
		BankAccountNumber: "123456",
		BankAccountName:   "Org One",
	})
	if err != nil {
		t.Fatalf("RequestPayout p1: %v", err)
	}
	p2, err := ledgerSvc.RequestPayout(ctx, organizer.ID, ledger.PayoutInput{
		Amount:            30000,
		BankName:          "Mandiri",
		BankAccountNumber: "654321",
		BankAccountName:   "Org One",
	})
	if err != nil {
		t.Fatalf("RequestPayout p2: %v", err)
	}

	balBefore, err := ledgerSvc.GetBalance(ctx, organizer.ID)
	if err != nil || balBefore != 30000 {
		t.Fatalf("expected balance 30000, got %d (err=%v)", balBefore, err)
	}

	handler := admin.NewHandler(admin.NewService(pool), testJWTSecret).Routes()

	// Approve p1
	req := httptest.NewRequest(http.MethodPost, "/v1/admin/payouts/"+p1.ID+"/process", bytes.NewBufferString(`{"action":"approve","note":"verified"}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("approve p1 expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Complete p1
	req = httptest.NewRequest(http.MethodPost, "/v1/admin/payouts/"+p1.ID+"/process", bytes.NewBufferString(`{"action":"complete","note":"transferred"}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("complete p1 expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var completed admin.AdminPayout
	_ = json.Unmarshal(rec.Body.Bytes(), &completed)
	if completed.Status != "paid" || completed.ProcessedAt == nil {
		t.Fatalf("expected p1 status=paid with processed_at, got %+v", completed)
	}

	// Reject p2 -> should refund 30000 to organizer balance
	req = httptest.NewRequest(http.MethodPost, "/v1/admin/payouts/"+p2.ID+"/process", bytes.NewBufferString(`{"action":"reject","note":"invalid bank account"}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("reject p2 expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var rejected admin.AdminPayout
	_ = json.Unmarshal(rec.Body.Bytes(), &rejected)
	if rejected.Status != "rejected" || rejected.ProcessedAt == nil {
		t.Fatalf("expected p2 status=rejected with processed_at, got %+v", rejected)
	}

	balAfter, err := ledgerSvc.GetBalance(ctx, organizer.ID)
	if err != nil || balAfter != 60000 {
		t.Fatalf("expected balance 60000 after reject refund, got %d (err=%v)", balAfter, err)
	}
}
