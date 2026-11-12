# BEO Backend API & Monorepo Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo foundation, local Docker infrastructure (PostgreSQL + Mailpit), and the complete Go modular monolith REST API (`apps/api`) for BEO covering identity/RBAC, universal events, atomic ticketing, agency issuance & claim tokens, Duitku/manual payments, commission ledger & payouts, Brevo email + PDF/QR tickets, venue check-in, CFP review workflow, and fraud audit/VectorStore readiness.

**Architecture:** A single Go 1.26 modular monolith (`apps/api`) organized by domain packages (`identity`, `events`, `ticketing`, `payments`, `ledger`, `checkin`, `cfp`, `fraud`) backed by PostgreSQL 16 (`pgx/v5`) with `chi/v5` HTTP routing and a `platform` package for config, DB, JWT, Brevo SMTP, storage, Expo push, and `VectorStore` interface. Two companion plans will cover `apps/web` (React/Vite SPA) and `apps/mobile` (Expo React Native).

**Tech Stack:** Go 1.26, `github.com/go-chi/chi/v5`, `github.com/jackc/pgx/v5`, `github.com/golang-jwt/jwt/v5`, `github.com/skip2/go-qrcode`, `github.com/go-pdf/fpdf`, PostgreSQL 16, Mailpit (local SMTP), Brevo SMTP (prod).

**Spec:** [docs/superpowers/specs/2026-11-13-beo-design.md](../specs/2026-11-13-beo-design.md)

## Global Constraints

- Monorepo root folders: `apps/api`, `apps/web`, `apps/mobile`, `packages/contracts`, `infra/`.
- Centralized merchant of record: single platform Duitku config & BEO bank account; commission % varies by `event_category` and is recorded in immutable `ledger_entries`.
- Zero overselling: ticket & agency quota mutations MUST use PostgreSQL row-level locking (`SELECT ... FOR UPDATE`) inside transactions.
- Agency accounts (`account_type = 'agency'`) issue tickets from `allocated_agency_quota` and generate unique `claim_token` links.
- QR tickets use `HMAC-SHA256` signatures over `ticket_code` + `event_id`; check-in is atomic (`WHERE checked_in_at IS NULL`).
- Transactional emails use Brevo SMTP (Mailpit in `infra/docker-compose.yml` for local dev).
- All sensitive actions record to `audit_events` and expose `fraud.VectorStore` interface (`IndexEventVector`, `SearchSimilarPatterns`).

## Review Focus

1. **Concurrent checkout race condition on last ticket:** When `quota - sold_count - reserved_count == 1` and two concurrent requests reserve 1 ticket, exactly 1 succeeds and 1 fails with `ErrOutOfStock` (`409 Conflict`). Tested in Task 4.
2. **Idempotent Duitku webhook delivery:** Receiving the same valid Duitku `PAID` callback twice for the same `merchant_order_id` returns `200 OK` both times without creating duplicate `tickets` or `ledger_entries`. Tested in Task 5.
3. **Manual transfer rejection releases quota:** When an organizer rejects a `pending_verification` manual order, `reserved_count` is decremented back and zero `tickets` or `ledger_entries` are created. Tested in Task 5.
4. **Agency quota enforcement:** An agency attempting to issue tickets beyond `event_agencies.quota_limit` fails with `ErrAgencyQuotaExceeded` (`409 Conflict`) and `issued_count` stays unchanged. Tested in Task 4.
5. **Double QR scan at venue check-in:** Scanning the same valid QR twice succeeds on the first scan (`200 OK`) and returns `409 Conflict` (`duplicate`) on the second, with both attempts recorded in `checkin_logs` and `audit_events`. Tested in Task 7.

---

### Task 1: Monorepo Scaffold, Docker Infra & PostgreSQL Schema

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `apps/api/go.mod`
- Create: `apps/api/internal/platform/config.go`
- Create: `apps/api/internal/platform/db.go`
- Create: `apps/api/migrations/0001_init.sql`
- Test: `apps/api/internal/platform/db_test.go`

**Interfaces:**
- Produces:
  - `platform.Config` struct + `platform.LoadConfig() (Config, error)`
  - `platform.OpenDB(ctx context.Context, dsn string) (*pgxpool.Pool, error)`
  - `platform.RunMigrations(ctx context.Context, pool *pgxpool.Pool, migrationsFS fs.FS) error`

- [ ] **Step 1: Create `infra/docker-compose.yml` and `apps/api/go.mod`**
  - `infra/docker-compose.yml`: PostgreSQL 16 (`beo`, user `beo`, pass `beo`, port `5432`) and Mailpit (`1025` SMTP, `8025` web UI).
  - `apps/api/go.mod`: module `github.com/cerdas-club/beo/apps/api`, `go 1.26`.

- [ ] **Step 2: Write `apps/api/migrations/0001_init.sql`**
  - Define all 16 tables from Section 7 of the spec (`users`, `category_commission_rates`, `events`, `event_members`, `event_sessions`, `ticket_types`, `event_agencies`, `orders`, `tickets`, `ledger_entries`, `payout_requests`, `checkin_logs`, `cfp_submissions`, `cfp_reviews`, `event_posts`, `audit_events`) plus default seed rows for `category_commission_rates` (`community: 2.5`, `seminar_workshop: 5.0`, `conference: 5.0`, `meetup_ted: 3.0`).

- [ ] **Step 3: Write the failing test in `apps/api/internal/platform/db_test.go`**
  - `TestRunMigrations_AppliesSchemaIdempotently(t *testing.T)`: connects to `TEST_DATABASE_URL` (skips cleanly if unset, fails if connection fails), runs `RunMigrations` twice, and asserts `SELECT count(*) FROM category_commission_rates` equals `4`.

- [ ] **Step 4: Run test to verify it fails**
  - Run: `cd apps/api && go test ./internal/platform/... -v`
  - Expected: FAIL (`LoadConfig` / `OpenDB` / `RunMigrations` undefined).

- [ ] **Step 5: Implement `config.go` and `db.go`**
  - Implement `LoadConfig()` reading `DATABASE_URL`, `JWT_SECRET`, `QR_HMAC_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY`, `DUITKU_BASE_URL`, `STORAGE_DIR`.
  - Implement `OpenDB` with `pgxpool.New` and `Ping`, and `RunMigrations` tracking applied filenames in `schema_migrations`.

- [ ] **Step 6: Run test to verify it passes**
  - Start Docker Postgres (`docker compose -f infra/docker-compose.yml up -d postgres mailpit`) and run `cd apps/api && TEST_DATABASE_URL="postgres://beo:beo@localhost:5432/beo?sslmode=disable" go test ./internal/platform/... -v`.
  - Expected: PASS.

- [ ] **Step 7: Commit**
  - `git add infra/docker-compose.yml apps/api/go.mod apps/api/internal/platform apps/api/migrations`
  - `git commit -m "chore: scaffold monorepo infra, go module, config, and initial postgres schema"`

---

### Task 2: Identity, Account Types & Per-Event RBAC

**Files:**
- Create: `apps/api/internal/identity/service.go`
- Create: `apps/api/internal/identity/middleware.go`
- Create: `apps/api/internal/identity/handler.go`
- Test: `apps/api/internal/identity/service_test.go`

**Interfaces:**
- Consumes: `*pgxpool.Pool`
- Produces:
  - `identity.User` (`ID`, `Name`, `Email`, `AccountType` (`standard|agency|platform_admin`))
  - `identity.Service.Register(ctx, RegisterInput) (User, string, error)`
  - `identity.Service.Login(ctx, email, password string) (User, string, error)`
  - `identity.Service.RegisterPushToken(ctx, userID, token string) error`
  - `identity.Service.AssignEventMember(ctx, eventID, actorID, targetEmail, role string) error`
  - `identity.Service.HasEventRole(ctx, eventID, userID string, roles ...string) (bool, error)`
  - `identity.AuthMiddleware(jwtSecret string) func(http.Handler) http.Handler` & `identity.UserFromContext(ctx) (Claims, bool)`

- [ ] **Step 1: Write failing tests in `apps/api/internal/identity/service_test.go`**
  - `TestRegisterAndLogin_StandardAndAgency`: registers a `standard` user and an `agency` user, verifies bcrypt password hashing, JWT issuance, and rejects invalid `account_type` (e.g. cannot self-register as `platform_admin`).
  - `TestAssignEventMember_EnforcesOrganizerOwnership`: organizer assigns a `reviewer` and `checkin_staff` to an event; non-organizer caller receives `ErrForbidden`.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `cd apps/api && go test ./internal/identity/... -v`
  - Expected: FAIL.

- [ ] **Step 3: Implement `service.go`, `middleware.go`, and `handler.go`**
  - Implement registration, login, push token registration, per-event role assignment, JWT middleware, and HTTP handlers (`POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/me/push-token`, `POST /v1/events/{eventID}/members`).

- [ ] **Step 4: Run tests to verify pass**
  - Run: `cd apps/api && TEST_DATABASE_URL="postgres://beo:beo@localhost:5432/beo?sslmode=disable" go test ./internal/identity/... -v`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add apps/api/internal/identity`
  - `git commit -m "feat(identity): add user auth, account types, push tokens, and per-event RBAC"`

---

### Task 3: Universal Events, Sessions & Announcements + Push Dispatch

**Files:**
- Create: `apps/api/internal/platform/push.go`
- Create: `apps/api/internal/events/service.go`
- Create: `apps/api/internal/events/handler.go`
- Test: `apps/api/internal/events/service_test.go`

**Interfaces:**
- Consumes: `identity.Service.HasEventRole`
- Produces:
  - `platform.PushNotifier` interface (`Send(ctx, tokens []string, title, body string, data map[string]string) error`) + `ExpoPushNotifier`
  - `events.Service.CreateEvent(ctx, organizerID string, in CreateEventInput) (Event, error)`
  - `events.Service.AddSession(ctx, eventID, actorID string, in CreateSessionInput) (Session, error)`
  - `events.Service.PublishPost(ctx, eventID, actorID string, in CreatePostInput) (Post, error)`

- [ ] **Step 1: Write failing tests in `apps/api/internal/events/service_test.go`**
  - `TestCreateEvent_SupportsAllFourTypes`: creates `community`, `seminar_workshop`, `conference`, and `meetup_ted` events, adds `event_sessions`, and rejects invalid `event_type`.
  - `TestPublishPost_TriggersPushToClaimedAttendees`: uses a mock `PushNotifier` to assert `PublishPost` with `notify_push=true` collects distinct `expo_push_tokens` of attendees with valid tickets for that event and calls `Send`.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `cd apps/api && go test ./internal/events/... -v`
  - Expected: FAIL.

- [ ] **Step 3: Implement `platform/push.go`, `events/service.go`, and `events/handler.go`**
  - Implement event CRUD, public listing/detail by slug, session creation, post publishing + push dispatch, and HTTP endpoints (`POST /v1/events`, `GET /v1/events`, `GET /v1/events/{slug}`, `POST /v1/events/{eventID}/sessions`, `POST /v1/events/{eventID}/posts`).

- [ ] **Step 4: Run tests to verify pass**
  - Run: `cd apps/api && TEST_DATABASE_URL="postgres://beo:beo@localhost:5432/beo?sslmode=disable" go test ./internal/events/... -v`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add apps/api/internal/platform/push.go apps/api/internal/events`
  - `git commit -m "feat(events): add universal events, sessions, posts, and push notification dispatch"`

---

### Task 4: Ticketing, Atomic Quota, Guest/Multi-Ticket, Agency Issuance & Claim Tokens

**Files:**
- Create: `apps/api/internal/ticketing/qr.go`
- Create: `apps/api/internal/ticketing/service.go`
- Create: `apps/api/internal/ticketing/handler.go`
- Test: `apps/api/internal/ticketing/service_test.go`

**Interfaces:**
- Consumes: `identity.Service.HasEventRole`, `platform.Config.QRHMACSecret`
- Produces:
  - `ticketing.SignQR(secret, ticketCode, eventID string) string` & `ticketing.VerifyQR(secret, payload string) (ticketCode, eventID string, err error)`
  - `ticketing.Service.CreateTicketType(ctx, eventID, actorID string, in CreateTicketTypeInput) (TicketType, error)`
  - `ticketing.Service.ReserveOrder(ctx, in ReserveOrderInput) (Order, error)` (supports `buyer_user_id` nullable for guest checkout & multiple `Attendees`)
  - `ticketing.Service.AllocateAgencyQuota(ctx, eventID, actorID string, in AllocateAgencyInput) (EventAgency, error)`
  - `ticketing.Service.IssueAgencyTickets(ctx, agencyUserID, eventID string, in IssueAgencyTicketsInput) ([]Ticket, error)`
  - `ticketing.Service.ClaimTicket(ctx, userID, claimToken string) (Ticket, error)`

- [ ] **Step 1: Write failing tests in `apps/api/internal/ticketing/service_test.go`**
  - `TestSignAndVerifyQR`: verifies `SignQR` produces `ticketCode|eventID|hmacHex` and `VerifyQR` rejects tampered payloads.
  - `TestReserveOrder_ConcurrentLastTicket` (**Review Focus #1**): sets `quota=1`, launches 2 goroutines reserving 1 ticket each, asserts 1 succeeds and 1 returns `ErrOutOfStock`.
  - `TestAgencyAllocationAndIssuance_EnforcesQuotaLimit` (**Review Focus #4**): allocates `quota_limit=2` to an `agency` user (verifying `allocated_agency_quota` is carved out of `ticket_types.quota`), issues 2 tickets with `claim_token`, then asserts a 3rd ticket fails with `ErrAgencyQuotaExceeded`.
  - `TestClaimTicket_BindsToStandardUser`: claims an agency/guest ticket using `claim_token` and asserts `claimed_by_user_id` is set and double-claim by another user is rejected.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `cd apps/api && go test ./internal/ticketing/... -v`
  - Expected: FAIL.

- [ ] **Step 3: Implement `qr.go`, `service.go`, and `handler.go`**
  - Use `SELECT ... FOR UPDATE` on `ticket_types` and `event_agencies` inside `pgx` transactions.
  - Enforce `requires_accepted_cfp` check when reserving conference presenter tickets.
  - Expose HTTP endpoints (`POST /v1/events/{eventID}/ticket-types`, `POST /v1/events/{eventID}/orders`, `POST /v1/events/{eventID}/agencies`, `POST /v1/agency/events/{eventID}/issue`, `POST /v1/tickets/claim`, `GET /v1/me/tickets`).

- [ ] **Step 4: Run tests to verify pass**
  - Run: `cd apps/api && TEST_DATABASE_URL="postgres://beo:beo@localhost:5432/beo?sslmode=disable" go test ./internal/ticketing/... -v`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add apps/api/internal/ticketing`
  - `git commit -m "feat(ticketing): add atomic quota reservation, signed QR, agency issuance, and claim tokens"`

---

### Task 5: Payments (Duitku & Manual Verification), Commission Ledger & Organizer Payouts

**Files:**
- Create: `apps/api/internal/ledger/service.go`
- Create: `apps/api/internal/payments/duitku.go`
- Create: `apps/api/internal/payments/service.go`
- Create: `apps/api/internal/payments/handler.go`
- Test: `apps/api/internal/payments/service_test.go`

**Interfaces:**
- Consumes: `ticketing.SignQR`, `identity.Service.HasEventRole`
- Produces:
  - `ledger.Service.RecordPaidOrder(ctx, tx pgx.Tx, orderID string) error` (calculates commission from `category_commission_rates`, inserts `ticket_sale_gross` & `platform_commission` entries)
  - `ledger.Service.GetBalance(ctx, organizerID string) (int64, error)`
  - `ledger.Service.RequestPayout(ctx, organizerID string, in PayoutInput) (PayoutRequest, error)`
  - `payments.DuitkuClient` interface + HTTP implementation
  - `payments.Service.InitiateDuitku(ctx, orderID string) (paymentURL string, err error)`
  - `payments.Service.HandleDuitkuWebhook(ctx, payload DuitkuCallback) error`
  - `payments.Service.SubmitManualProof(ctx, orderID, proofURL string) error`
  - `payments.Service.VerifyManualOrder(ctx, orderID, actorID string, approve bool, reason string) error`

- [ ] **Step 1: Write failing tests in `apps/api/internal/payments/service_test.go`**
  - `TestHandleDuitkuWebhook_IdempotentConfirmationAndLedger` (**Review Focus #2**): delivers the same valid `DuitkuCallback` twice; asserts `tickets` count is 1, `ledger_entries` records exact gross and category commission (e.g. 5% for `conference`), and second call returns `nil` without duplicating rows.
  - `TestVerifyManualOrder_RejectReleasesQuota` (**Review Focus #3**): submits proof, organizer rejects (`approve=false`); asserts `payment_status='rejected'`, `ticket_types.reserved_count` returns to 0, and no `tickets` or `ledger_entries` exist.
  - `TestRequestPayout_PreventsOverdraw`: verifies organizer can request payout up to available ledger balance and overdraw returns `ErrInsufficientBalance`.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `cd apps/api && go test ./internal/payments/... ./internal/ledger/... -v`
  - Expected: FAIL.

- [ ] **Step 3: Implement `ledger/service.go`, `payments/duitku.go`, `payments/service.go`, and `payments/handler.go`**
  - Implement Duitku signature verification, idempotent order confirmation + ticket generation + ledger recording in one DB transaction, manual proof upload/review, and payout request endpoints (`POST /v1/orders/{orderID}/pay/duitku`, `POST /v1/webhooks/duitku`, `POST /v1/orders/{orderID}/proof`, `POST /v1/orders/{orderID}/verify`, `GET /v1/organizer/wallet`, `POST /v1/organizer/payouts`).

- [ ] **Step 4: Run tests to verify pass**
  - Run: `cd apps/api && TEST_DATABASE_URL="postgres://beo:beo@localhost:5432/beo?sslmode=disable" go test ./internal/payments/... ./internal/ledger/... -v`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add apps/api/internal/ledger apps/api/internal/payments`
  - `git commit -m "feat(payments,ledger): add Duitku, manual verification, commission ledger, and payouts"`

---

### Task 6: Brevo Emailer, Ticket PDF/QR Generator & Reservation Expiry Worker

**Files:**
- Create: `apps/api/internal/platform/mailer.go`
- Create: `apps/api/internal/ticketing/pdf.go`
- Create: `apps/api/internal/ticketing/worker.go`
- Test: `apps/api/internal/ticketing/pdf_mailer_test.go`

**Interfaces:**
- Consumes: `platform.Config` (SMTP settings for Brevo/Mailpit), `ticketing.SignQR`
- Produces:
  - `platform.Mailer` interface (`SendTicketEmail(ctx, toEmail, subject, htmlBody string, pdfBytes, qrPNG []byte) error`) + `SMTPMailer`
  - `ticketing.GenerateQRPNG(payload string) ([]byte, error)`
  - `ticketing.GenerateTicketPDF(t TicketPDFData, qrPNG []byte) ([]byte, error)`
  - `ticketing.ReleaseExpiredOrders(ctx context.Context, pool *pgxpool.Pool) (int, error)`

- [ ] **Step 1: Write failing tests in `apps/api/internal/ticketing/pdf_mailer_test.go`**
  - `TestGenerateQRAndPDF`: generates PNG + PDF bytes for a sample ticket and asserts non-empty valid PNG header and `%PDF-` header.
  - `TestReleaseExpiredOrders`: inserts an order with `expires_at < NOW()` and `reserved_count = 2`, runs `ReleaseExpiredOrders`, and asserts order becomes `expired` and `reserved_count == 0`.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `cd apps/api && go test ./internal/ticketing/... -run "TestGenerateQRAndPDF|TestReleaseExpiredOrders" -v`
  - Expected: FAIL.

- [ ] **Step 3: Implement `mailer.go`, `pdf.go`, `worker.go`, and ticket download handler (`GET /v1/tickets/{ticketCode}/pdf` & `/qr.png`)**
  - Implement `SMTPMailer` compatible with Brevo SMTP (STARTTLS on port 587) and Mailpit (local port 1025).

- [ ] **Step 4: Run tests to verify pass**
  - Run: `cd apps/api && TEST_DATABASE_URL="postgres://beo:beo@localhost:5432/beo?sslmode=disable" go test ./internal/ticketing/... -v`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add apps/api/internal/platform/mailer.go apps/api/internal/ticketing`
  - `git commit -m "feat(ticketing,mailer): add Brevo SMTP mailer, QR/PDF ticket rendering, and expiry worker"`

---

### Task 7: Venue Check-in (Atomic Scan) & Fraud Audit / VectorStore Hook

**Files:**
- Create: `apps/api/internal/fraud/audit.go`
- Create: `apps/api/internal/checkin/service.go`
- Create: `apps/api/internal/checkin/handler.go`
- Test: `apps/api/internal/checkin/service_test.go`

**Interfaces:**
- Consumes: `ticketing.VerifyQR`, `identity.Service.HasEventRole`
- Produces:
  - `fraud.VectorStore` interface (`IndexEventVector(ctx, id string, vector []float32, meta map[string]any) error`, `SearchSimilarPatterns(ctx, vector []float32, limit int) ([]string, error)`) + `NoopVectorStore`
  - `fraud.AuditLogger.Log(ctx, AuditEventInput) error`
  - `checkin.Service.ScanQR(ctx, eventID, scannerUserID, qrPayload, scanMode, ip, ua string) (ScanResult, error)`

- [ ] **Step 1: Write failing tests in `apps/api/internal/checkin/service_test.go`**
  - `TestScanQR_AtomicAndDuplicateDetection` (**Review Focus #5**): scans valid QR with `scanMode="hid"` -> returns `success`; scans same QR again with `scanMode="webcam"` -> returns `ErrDuplicateScan`; asserts `checkin_logs` has 2 rows (`success`, `duplicate`) and `audit_events` records the duplicate attempt.
  - `TestScanQR_RejectsWrongEventOrTamperedSignature`: asserts `invalid` result is returned and logged.

- [ ] **Step 2: Run tests to verify failure**
  - Run: `cd apps/api && go test ./internal/checkin/... -v`
  - Expected: FAIL.

- [ ] **Step 3: Implement `fraud/audit.go`, `checkin/service.go`, and `checkin/handler.go`**
  - Implement atomic `UPDATE tickets SET checked_in_at = NOW(), checked_in_by = $1 WHERE ticket_code = $2 AND event_id = $3 AND status = 'valid' AND checked_in_at IS NULL` + HTTP endpoint `POST /v1/events/{eventID}/checkin`.

- [ ] **Step 4: Run tests to verify pass**
  - Run: `cd apps/api && TEST_DATABASE_URL="postgres://beo:beo@localhost:5432/beo?sslmode=disable" go test ./internal/checkin/... ./internal/fraud/... -v`
  - Expected: PASS.

- [ ] **Step 5: Commit**
  - `git add apps/api/internal/fraud apps/api/internal/checkin`
  - `git commit -m "feat(checkin,fraud): add atomic QR check-in, audit logging, and VectorStore interface"`

---

### Task 8: Conference CFP Workflow & API Server Entrypoint

**Files:**
- Create: `apps/api/internal/cfp/service.go`
- Create: `apps/api/internal/cfp/handler.go`
- Create: `apps/api/cmd/server/main.go`
- Test: `apps/api/internal/cfp/service_test.go`

**Interfaces:**
- Consumes: all domain handlers & services from Tasks 1–7
- Produces:
  - `cfp.Service.SubmitPaper(ctx, eventID, authorID string, in SubmitPaperInput) (Submission, error)`
  - `cfp.Service.AssignReviewer(ctx, eventID, actorID, submissionID, reviewerID string) error`
  - `cfp.Service.SubmitReview(ctx, submissionID, reviewerID string, score int, comments, rec string) error`
  - `cfp.Service.DecideSubmission(ctx, eventID, actorID, submissionID, decision string) error`
  - `cmd/server/main.go` wiring all routes under `/v1` + background expiry worker.

- [ ] **Step 1: Write failing tests in `apps/api/internal/cfp/service_test.go`**
  - `TestCFPWorkflow_SubmitAssignReviewDecide`: author submits paper -> organizer assigns reviewer -> reviewer scores -> organizer marks `accepted` -> verifies non-assigned reviewer cannot review (`ErrForbidden`).

- [ ] **Step 2: Run tests to verify failure**
  - Run: `cd apps/api && go test ./internal/cfp/... -v`
  - Expected: FAIL.

- [ ] **Step 3: Implement `cfp/service.go`, `cfp/handler.go`, and `cmd/server/main.go`**
  - Wire all routes in `cmd/server/main.go` with CORS middleware and graceful shutdown.

- [ ] **Step 4: Run full Go test suite & build**
  - Run: `cd apps/api && TEST_DATABASE_URL="postgres://beo:beo@localhost:5432/beo?sslmode=disable" go test ./... -v && go build ./cmd/server`
  - Expected: All tests PASS and binary builds cleanly.

- [ ] **Step 5: Commit**
  - `git add apps/api/internal/cfp apps/api/cmd/server`
  - `git commit -m "feat(cfp,server): add conference paper review workflow and wire HTTP server"`

