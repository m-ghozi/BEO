package platform_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/cerdas-club/beo/apps/api/internal/platform"
)

func TestLoadConfig(t *testing.T) {
	os.Setenv("DATABASE_URL", "postgres://custom:custom@localhost:5432/custom_db")
	defer os.Unsetenv("DATABASE_URL")

	cfg, err := platform.LoadConfig()
	if err != nil {
		t.Fatalf("expected no error loading config, got: %v", err)
	}

	if cfg.DatabaseURL != "postgres://custom:custom@localhost:5432/custom_db" {
		t.Fatalf("expected custom DatabaseURL, got: %s", cfg.DatabaseURL)
	}
	if cfg.JWTSecret == "" {
		t.Fatalf("expected non-empty JWTSecret")
	}
	if cfg.QRHMACSecret == "" {
		t.Fatalf("expected non-empty QRHMACSecret")
	}
}

func TestRunMigrations_AppliesSchemaIdempotently(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("skipping integration test: TEST_DATABASE_URL not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := platform.OpenDB(ctx, dsn)
	if err != nil {
		t.Fatalf("failed to connect to test database: %v", err)
	}
	defer pool.Close()

	migrationsFS := os.DirFS("../../migrations")

	// First run applies migration
	if err := platform.RunMigrations(ctx, pool, migrationsFS); err != nil {
		t.Fatalf("first RunMigrations failed: %v", err)
	}

	// Second run must be idempotent (no error, no duplicates)
	if err := platform.RunMigrations(ctx, pool, migrationsFS); err != nil {
		t.Fatalf("second RunMigrations failed: %v", err)
	}

	var count int
	err = pool.QueryRow(ctx, "SELECT count(*) FROM category_commission_rates").Scan(&count)
	if err != nil {
		t.Fatalf("failed to query category_commission_rates count: %v", err)
	}

	if count != 4 {
		t.Fatalf("expected 4 category_commission_rates, got: %d", count)
	}
}

