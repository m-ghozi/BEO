package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/cerdas-club/beo/apps/api/internal/admin"
	"github.com/cerdas-club/beo/apps/api/internal/cfp"
	"github.com/cerdas-club/beo/apps/api/internal/checkin"
	"github.com/cerdas-club/beo/apps/api/internal/events"
	"github.com/cerdas-club/beo/apps/api/internal/fraud"
	"github.com/cerdas-club/beo/apps/api/internal/identity"
	"github.com/cerdas-club/beo/apps/api/internal/ledger"
	"github.com/cerdas-club/beo/apps/api/internal/payments"
	"github.com/cerdas-club/beo/apps/api/internal/platform"
	"github.com/cerdas-club/beo/apps/api/internal/ticketing"
)

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func corsMiddleware(next http.Handler) http.Handler {
	allowOrigin := envOrDefault("CORS_ALLOW_ORIGIN", "*")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-Requested-With")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func startOrderExpiryWorker(ctx context.Context, pool *pgxpool.Pool) {
	ticker := time.NewTicker(1 * time.Minute)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
				released, err := ticketing.ReleaseExpiredOrders(runCtx, pool)
				cancel()
				if err != nil {
					log.Printf("expiry worker error: %v", err)
				} else if released > 0 {
					log.Printf("expiry worker released %d expired orders", released)
				}
			}
		}
	}()
}

func main() {
	cfg, err := platform.LoadConfig()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := platform.OpenDB(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer pool.Close()

	migrationsDir := envOrDefault("MIGRATIONS_DIR", "migrations")
	if err := platform.RunMigrations(ctx, pool, os.DirFS(migrationsDir)); err != nil {
		log.Fatalf("run migrations: %v", err)
	}

	identitySvc := identity.NewService(pool, cfg.JWTSecret)
	pushNotifier := platform.NewExpoPushNotifier(&http.Client{Timeout: 10 * time.Second})
	mailer := platform.NewSMTPMailerFromConfig(cfg)
	eventsSvc := events.NewService(pool, identitySvc, pushNotifier)
	ticketingSvc := ticketing.NewService(pool, identitySvc, cfg.QRHMACSecret)
	ticketingSvc.SetMailer(mailer)
	ledgerSvc := ledger.NewService(pool)

	duitkuClient := payments.NewHTTPDuitkuClient(
		cfg.DuitkuMerchantCode,
		cfg.DuitkuAPIKey,
		cfg.DuitkuBaseURL,
		&http.Client{Timeout: 15 * time.Second},
	)
	callbackURL := envOrDefault("DUITKU_CALLBACK_URL", "http://localhost:8080/v1/webhooks/duitku")
	returnURL := envOrDefault("DUITKU_RETURN_URL", "http://localhost:5173/orders/return")
	paymentsSvc := payments.NewService(
		pool,
		identitySvc,
		ledgerSvc,
		duitkuClient,
		cfg.QRHMACSecret,
		cfg.DuitkuMerchantCode,
		cfg.DuitkuAPIKey,
		callbackURL,
		returnURL,
	)
	paymentsSvc.SetMailer(mailer)

	auditLogger := fraud.NewAuditLogger(pool, fraud.NoopVectorStore{})
	checkinSvc := checkin.NewService(pool, identitySvc, auditLogger, cfg.QRHMACSecret)
	cfpSvc := cfp.NewService(pool, identitySvc)
	adminSvc := admin.NewService(pool)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	identity.NewHandler(identitySvc, cfg.JWTSecret).RegisterRoutes(mux)
	events.NewHandler(eventsSvc, cfg.JWTSecret).RegisterRoutes(mux)
	ticketing.NewHandler(ticketingSvc, cfg.JWTSecret).RegisterRoutes(mux)
	payments.NewHandler(paymentsSvc, ledgerSvc, cfg.JWTSecret, cfg.StorageDir).RegisterRoutes(mux)
	checkin.NewHandler(checkinSvc, cfg.JWTSecret).RegisterRoutes(mux)
	cfp.NewHandler(cfpSvc, cfg.JWTSecret).RegisterRoutes(mux)
	admin.NewHandler(adminSvc, cfg.JWTSecret).RegisterRoutes(mux)

	startOrderExpiryWorker(ctx, pool)

	addr := ":" + envOrDefault("PORT", "8080")
	srv := &http.Server{
		Addr:              addr,
		Handler:           corsMiddleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("BEO API server listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down BEO API server...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown error: %v", err)
	}
	log.Println("BEO API server stopped")
}
