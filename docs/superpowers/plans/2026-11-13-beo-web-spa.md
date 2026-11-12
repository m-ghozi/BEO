# BEO Web SPA (`apps/web`) & Shared Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared TypeScript contracts (`packages/contracts`) and the React + TypeScript + Vite Web SPA (`apps/web`) for BEO, covering public event discovery, guest/multi-ticket checkout (Free, Duitku, Manual Transfer), ticket claiming & QR/PDF access, Organizer Studio (events, sessions, posts, manual verification, agency quotas, wallet & payouts), Agency Portal, Conference CFP Review Portal, and the Venue Check-in Terminal (Hardware HID + Webcam `BarcodeDetector` / `zxing-wasm` Web Worker).

**Architecture:** NPM workspaces monorepo root (`package.json`) linking `packages/contracts` (Zod schemas & TypeScript types shared by Web and future Mobile app) and `apps/web` (React 19, Vite, Tailwind CSS, React Router v7, TanStack Query). All API requests go through a typed `apiClient` targeting `/v1/*` on the Go backend (`VITE_API_BASE_URL`, default `http://localhost:8080`).

**Tech Stack:** Node 24, React 19, TypeScript, Vite, Tailwind CSS v4, `react-router-dom`, `@tanstack/react-query`, `zod`, `lucide-react`, `zxing-wasm`, Vitest, `@testing-library/react`.

**Spec:** [docs/superpowers/specs/2026-11-13-beo-design.md](../specs/2026-11-13-beo-design.md)

## Global Constraints

- Monorepo root workspaces: `packages/contracts` and `apps/web`.
- Check-in terminal MUST support **Hardware QR Reader (HID keyboard input)** as primary mode and **Webcam** (`BarcodeDetector` API with `zxing-wasm` Web Worker fallback) as secondary mode.
- Checkout MUST support free tickets, Duitku online payment redirect, and manual transfer proof submission (`pending_verification`), plus guest & multi-ticket attendee lists.
- Agency portal is restricted to `account_type = 'agency'` users to issue tickets and share unique `claim_token` URLs.
- Organizer studio supports all 4 event types (`community`, `seminar_workshop`, `conference`, `meetup_ted`), `sessions`, `posts`, manual payment approval/rejection, agency quota allocation, and ledger wallet/payout requests.

## Review Focus

1. **HID check-in in-flight guard:** Rapidly scanning/pressing Enter twice with a hardware QR reader does not fire duplicate concurrent `POST /v1/events/{eventID}/checkin` requests while a scan is already in-flight. Tested in Task 7.
2. **Webcam fallback & cleanup:** When `window.BarcodeDetector` is unavailable, the scanner falls back to the `zxing-wasm` Web Worker, and unmounting the check-in component stops all `MediaStream` tracks. Tested in Task 7.
3. **Multi-ticket guest checkout validation:** Checkout requires valid name and email for every ticket quantity requested and handles Duitku `payment_url` redirect vs. manual proof submission. Tested in Task 3.
4. **Organizer payout & manual verification:** Rejecting a manual transfer requires a reason; payout request validates `amount > 0 && amount <= balance` and invalidates wallet query on success. Tested in Task 5.
5. **Auth & role route protection:** Unauthenticated visits to `/organizer`, `/agency`, or `/checkin` redirect to `/login`, and `403 Forbidden` API responses render an explicit permission error state. Tested in Task 2 & Task 6.

---

### Task 1: NPM Workspaces, `packages/contracts` & `apps/web` Scaffold

**Files:**
- Create: `package.json`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/index.css`
- Create: `apps/web/src/main.tsx`
- Test: `packages/contracts/src/index.test.ts`

**Interfaces:**
- Produces:
  - `@beo/contracts`: `EventType`, `AccountType`, `EventDTO`, `SessionDTO`, `PostDTO`, `TicketTypeDTO`, `OrderDTO`, `TicketDTO`, `CFPSubmissionDTO`, `WalletDTO`, `CheckinResultDTO`, plus Zod schemas (`RegisterSchema`, `CreateEventSchema`, `ReserveOrderSchema`, `ClaimTicketSchema`).

- [ ] **Step 1: Create root `package.json` with npm workspaces (`packages/contracts`, `apps/web`) and `packages/contracts` setup**
- [ ] **Step 2: Write failing test in `packages/contracts/src/index.test.ts`**
  - Validates `CreateEventSchema` accepts all 4 `event_type` values and rejects invalid slugs; validates `ReserveOrderSchema` requires at least 1 attendee with valid email.
- [ ] **Step 3: Run test to verify failure**
  - Run: `npm test --workspace=@beo/contracts`
  - Expected: FAIL.
- [ ] **Step 4: Implement `packages/contracts/src/index.ts` and scaffold `apps/web` (Vite + React + Tailwind CSS + Vitest)**
- [ ] **Step 5: Run tests & Vite build to verify pass**
  - Run: `npm test --workspace=@beo/contracts && npm run build --workspace=@beo/web`
  - Expected: PASS and clean `dist/` build.
- [ ] **Step 6: Commit**
  - `git add package.json packages/contracts apps/web`
  - `git commit -m "chore(web): scaffold npm workspaces, shared contracts, and Vite React app"`

---

### Task 2: Typed API Client, Auth Context & App Shell

**Files:**
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/features/auth/AuthContext.tsx`
- Create: `apps/web/src/features/auth/LoginPage.tsx`
- Create: `apps/web/src/features/auth/RegisterPage.tsx`
- Create: `apps/web/src/components/Layout.tsx`
- Create: `apps/web/src/App.tsx`
- Test: `apps/web/src/features/auth/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `@beo/contracts`
- Produces:
  - `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` (`ApiError` with HTTP `status` and `message`)
  - `useAuth()` (`user`, `token`, `login`, `register`, `logout`, `isAuthenticated`)
  - `ProtectedRoute` component (redirects to `/login` when unauthenticated, optionally checks `accountType`)

- [ ] **Step 1: Write failing test in `apps/web/src/features/auth/AuthContext.test.tsx`**
  - Tests `login` stores JWT + user in `localStorage` and sets `isAuthenticated = true`, `logout` clears them, and `ProtectedRoute` redirects unauthenticated users to `/login` (**Review Focus #5**).
- [ ] **Step 2: Run test to verify failure**
  - Run: `npm test --workspace=@beo/web -- AuthContext.test.tsx`
  - Expected: FAIL.
- [ ] **Step 3: Implement `api.ts`, `AuthContext.tsx`, `LoginPage.tsx`, `RegisterPage.tsx`, `Layout.tsx`, and `App.tsx`**
- [ ] **Step 4: Run tests to verify pass**
  - Run: `npm test --workspace=@beo/web`
  - Expected: PASS.
- [ ] **Step 5: Commit**
  - `git add apps/web/src`
  - `git commit -m "feat(web,auth): add typed API client, JWT auth context, login/register pages, and app shell"`

---

### Task 3: Public Events Directory, Event Detail & Guest/Multi-Ticket Checkout

**Files:**
- Create: `apps/web/src/features/public-events/EventsListPage.tsx`
- Create: `apps/web/src/features/public-events/EventDetailPage.tsx`
- Create: `apps/web/src/features/public-events/CheckoutForm.tsx`
- Test: `apps/web/src/features/public-events/CheckoutForm.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `@beo/contracts`
- Produces: Public routes `/`, `/events/:slug` with event schedule (`sessions`), announcements (`posts`), ticket tier selection, multi-attendee guest form, and payment flow (Free instant confirmation, Duitku redirect `payment_url`, or Manual Transfer proof URL submission).

- [ ] **Step 1: Write failing test in `apps/web/src/features/public-events/CheckoutForm.test.tsx`**
  - Tests multi-ticket attendee validation (requires name & email for each ticket), Duitku `POST /v1/events/{id}/orders` + `POST /v1/orders/{id}/pay/duitku`, and manual transfer `POST /v1/orders/{id}/proof` (**Review Focus #3**).
- [ ] **Step 2: Run test to verify failure**
  - Run: `npm test --workspace=@beo/web -- CheckoutForm.test.tsx`
  - Expected: FAIL.
- [ ] **Step 3: Implement `EventsListPage.tsx`, `EventDetailPage.tsx`, `CheckoutForm.tsx`, and wire routes in `App.tsx`**
- [ ] **Step 4: Run tests to verify pass**
  - Run: `npm test --workspace=@beo/web`
  - Expected: PASS.
- [ ] **Step 5: Commit**
  - `git add apps/web/src`
  - `git commit -m "feat(web,events): add public event directory, detail page, and multi-ticket checkout"`

---

### Task 4: Attendee Ticket Wallet, Claim Token & QR/PDF Downloads

**Files:**
- Create: `apps/web/src/features/tickets/MyTicketsPage.tsx`
- Create: `apps/web/src/features/tickets/ClaimTicketPage.tsx`
- Test: `apps/web/src/features/tickets/ClaimTicketPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `useAuth`, `@beo/contracts`
- Produces: Routes `/my-tickets` (lists claimed tickets with QR image preview `/v1/tickets/{code}/qr.png` & PDF download `/v1/tickets/{code}/pdf`) and `/claim` (supports `?token=...` query param to call `POST /v1/tickets/claim`).

- [ ] **Step 1: Write failing test in `apps/web/src/features/tickets/ClaimTicketPage.test.tsx`**
  - Verifies `/claim?token=abc-123` pre-fills token, calls `POST /v1/tickets/claim`, and shows claimed ticket details with PDF/QR links.
- [ ] **Step 2: Run test to verify failure**
  - Run: `npm test --workspace=@beo/web -- ClaimTicketPage.test.tsx`
  - Expected: FAIL.
- [ ] **Step 3: Implement `MyTicketsPage.tsx`, `ClaimTicketPage.tsx`, and wire routes in `App.tsx`**
- [ ] **Step 4: Run tests to verify pass**
  - Run: `npm test --workspace=@beo/web`
  - Expected: PASS.
- [ ] **Step 5: Commit**
  - `git add apps/web/src`
  - `git commit -m "feat(web,tickets): add attendee ticket wallet, claim token page, and QR/PDF downloads"`

---

### Task 5: Organizer Studio (Events, Sessions, Posts, Verification, Agencies, Wallet & Payouts)

**Files:**
- Create: `apps/web/src/features/organizer-studio/OrganizerDashboardPage.tsx`
- Create: `apps/web/src/features/organizer-studio/EventManagePage.tsx`
- Create: `apps/web/src/features/organizer-studio/WalletPayoutsPage.tsx`
- Test: `apps/web/src/features/organizer-studio/WalletPayoutsPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `useAuth`, `@beo/contracts`
- Produces: Protected routes `/organizer`, `/organizer/events/:eventId`, `/organizer/wallet` covering event creation (4 types), session/post publishing, ticket type creation, manual transfer approve/reject (requiring reason on reject), agency quota allocation, team member assignment, and wallet balance + payout requests.

- [ ] **Step 1: Write failing test in `apps/web/src/features/organizer-studio/WalletPayoutsPage.test.tsx`**
  - Tests payout form blocks `amount > balance` or `amount <= 0`, submits `POST /v1/organizer/payouts` for valid amount, and invalidates wallet query (**Review Focus #4**).
- [ ] **Step 2: Run test to verify failure**
  - Run: `npm test --workspace=@beo/web -- WalletPayoutsPage.test.tsx`
  - Expected: FAIL.
- [ ] **Step 3: Implement `OrganizerDashboardPage.tsx`, `EventManagePage.tsx`, `WalletPayoutsPage.tsx`, and wire routes in `App.tsx`**
- [ ] **Step 4: Run tests to verify pass**
  - Run: `npm test --workspace=@beo/web`
  - Expected: PASS.
- [ ] **Step 5: Commit**
  - `git add apps/web/src`
  - `git commit -m "feat(web,organizer): add organizer studio, event management, manual verification, and wallet payouts"`

---

### Task 6: Agency Portal & Conference CFP Portal

**Files:**
- Create: `apps/web/src/features/agency-portal/AgencyPortalPage.tsx`
- Create: `apps/web/src/features/cfp-review/CFPPortalPage.tsx`
- Test: `apps/web/src/features/agency-portal/AgencyPortalPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `useAuth`, `@beo/contracts`
- Produces:
  - `/agency` (restricted to `account_type === 'agency'`): issue tickets via `POST /v1/agency/events/{eventID}/issue` and display copyable `/claim?token=...` links.
  - `/events/:eventId/cfp`: author paper submission (`POST /v1/events/{eventID}/cfp/submissions`), reviewer scoring (`POST /v1/cfp/submissions/{id}/reviews`), and organizer reviewer assignment & decision (`accepted | rejected | revision_required`), surfacing `403` errors cleanly (**Review Focus #5**).

- [ ] **Step 1: Write failing test in `apps/web/src/features/agency-portal/AgencyPortalPage.test.tsx`**
  - Verifies non-agency account is blocked from `/agency`, and agency account issuing tickets renders the generated `claim_token` URLs.
- [ ] **Step 2: Run test to verify failure**
  - Run: `npm test --workspace=@beo/web -- AgencyPortalPage.test.tsx`
  - Expected: FAIL.
- [ ] **Step 3: Implement `AgencyPortalPage.tsx`, `CFPPortalPage.tsx`, and wire routes in `App.tsx`**
- [ ] **Step 4: Run tests to verify pass**
  - Run: `npm test --workspace=@beo/web`
  - Expected: PASS.
- [ ] **Step 5: Commit**
  - `git add apps/web/src`
  - `git commit -m "feat(web,agency,cfp): add agency ticket issuance portal and conference CFP review portal"`

---

### Task 7: Venue Check-in Terminal (Hardware HID + Webcam `BarcodeDetector` / `zxing-wasm` Worker)

**Files:**
- Create: `apps/web/src/workers/qr-decoder.worker.ts`
- Create: `apps/web/src/features/checkin-scanner/useQRScanner.ts`
- Create: `apps/web/src/features/checkin-scanner/CheckinPage.tsx`
- Test: `apps/web/src/features/checkin-scanner/CheckinPage.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `useAuth`, `zxing-wasm/reader`
- Produces: Protected route `/events/:eventId/checkin` with:
  1. Auto-focused HID Hardware QR input (`scan_mode: "hid"`), ignoring duplicate Enter submissions while a request is in-flight (**Review Focus #1**).
  2. Webcam toggle (`scan_mode: "webcam"`), using `window.BarcodeDetector` when available and falling back to `qr-decoder.worker.ts` (`zxing-wasm`), stopping all `MediaStream` tracks on unmount (**Review Focus #2**).
  3. Live scan result banner (`success` green, `duplicate` amber alert, `invalid` red error) + recent scan log list.

- [ ] **Step 1: Write failing tests in `apps/web/src/features/checkin-scanner/CheckinPage.test.tsx`**
  - Tests HID input submits `scan_mode: "hid"`, ignores rapid duplicate submission while in-flight, renders `duplicate` warning on `409`, and verifies webcam fallback stops `MediaStream` tracks on unmount.
- [ ] **Step 2: Run test to verify failure**
  - Run: `npm test --workspace=@beo/web -- CheckinPage.test.tsx`
  - Expected: FAIL.
- [ ] **Step 3: Implement `qr-decoder.worker.ts`, `useQRScanner.ts`, `CheckinPage.tsx`, and wire route in `App.tsx`**
- [ ] **Step 4: Run full Web SPA test suite & production Vite build**
  - Run: `npm test --workspace=@beo/contracts && npm test --workspace=@beo/web && npm run build --workspace=@beo/web`
  - Expected: All tests PASS and Vite production bundle builds cleanly.
- [ ] **Step 5: Commit**
  - `git add apps/web/src`
  - `git commit -m "feat(web,checkin): add venue check-in terminal with HID scanner and webcam BarcodeDetector/zxing-wasm worker"`

