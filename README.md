# BEO — Beo Event Organizer

Universal event management monorepo built with **Go**, **PostgreSQL**, **React + Vite (Web SPA)**, and **Expo / React Native (Attendee Mobile App)**.

Supports **Community Events**, **Seminars / Workshops**, **Scientific Conferences (CFP & Peer Review)**, and **TED-style Meetups** — with integrated **Duitku** online payments, manual bank transfer verification, **Brevo** SMTP ticket emails (QR + PDF), **Agency** quota distribution & claim tokens, centralized **Platform Ledger & Payouts**, **Hardware HID / Webcam / Manual** gate check-in, and **Offline QR + Push Notifications** on mobile.

---

## Monorepo Structure

```text
.
├── apps/
│   ├── api/                 # Go Modular Monolith REST API + PostgreSQL migrations + PDF/QR/SMTP/Push
│   ├── web/                 # React 19 + Vite + Tailwind CSS v4 Web SPA (Public, Organizer, Agency, CFP, Check-in, Admin)
│   └── mobile/              # Expo (React Native) Attendee App (Offline QR Pass, Deep-link Claim, Schedule, Push)
├── packages/
│   └── contracts/           # Shared TypeScript DTOs & Zod validation schemas (@beo/contracts)
├── infra/
│   └── docker-compose.yml   # Podman / Docker Compose stack (PostgreSQL 16, Mailpit, Go API, Nginx Web SPA)
└── docs/                    # Design specification & implementation plans
```

---

## Key Features

- **Universal Event Types:** `community`, `seminar_workshop`, `conference` (with Call for Papers submission, reviewer scoring, and acceptance gating), and `meetup_ted`.
- **Ticketing & Multi-Attendee Checkout:**
  - Free tickets, **Duitku** online gateway (with return page & late-payment reconciliation), and **Manual Bank Transfer** (multipart receipt upload + organizer verification).
  - Automatic **QR Code (HMAC-SHA256)** & **PDF** ticket generation sent via SMTP (Brevo in production, Mailpit locally), plus `claim_token` links for group/delegated tickets.
- **Agency Sales & Quota Management:**
  - Dedicated `agency` accounts with organizer-controlled ticket quotas, quota top-ups/reclamation, and shareable `/claim?token=...` links (`beo://claim?token=...` on mobile).
- **Venue Check-in Terminal (`/events/:eventId/checkin`):**
  - **Hardware HID QR Scanner** mode with auto-focus and in-flight deduplication.
  - **Webcam Scanner** fallback (`BarcodeDetector` API + `zxing-wasm` Web Worker).
  - **Manual Ticket Code** fallback (`BEO-XXXX`) for damaged/unreachable screens.
- **Centralized Ledger & Platform Admin (`/admin`):**
  - Category-based platform commission rates (`category_commission_rates`), organizer wallet & payout requests, and `platform_admin` dashboard for payout approvals, commission editing, and audit log monitoring.
- **Attendee Mobile App (`apps/mobile`):**
  - Offline-cached ticket wallet and QR pass rendering, deep-link token claiming, event schedule & organizer announcements, and Expo Push Notifications.

---

## Quick Start (Podman / Docker Compose)

Start PostgreSQL, Mailpit, Go API, and Nginx-served Web SPA:

```bash
podman compose -f infra/docker-compose.yml up -d --build
```

*(Works identically with `docker compose -f infra/docker-compose.yml up -d --build`.)*

### Local Service URLs
- **Web SPA:** http://localhost:5173 (proxies `/v1/*` to the Go API)
- **Go API:** http://localhost:8080 (`GET /v1/healthz`)
- **Mailpit (Local Email Inbox):** http://localhost:8025
- **PostgreSQL 16:** `postgres://beo:beo@localhost:5432/beo?sslmode=disable`

### Running the Mobile App (Expo)

```bash
EXPO_PUBLIC_API_URL=http://localhost:8080 npm start --workspace=@beo/mobile
```
*(Use `http://10.0.2.2:8080` on Android Emulator or your machine's LAN IP when testing on a physical device.)*

---

## Running Tests

```bash
# Shared contracts & Zod schemas
npm test --workspace=@beo/contracts

# Web SPA unit tests & production build
npm test --workspace=@beo/web && npm run build --workspace=@beo/web

# Mobile App unit tests & TypeScript check
npm test --workspace=@beo/mobile && npm run typecheck --workspace=@beo/mobile

# Go API (vet & unit tests; set TEST_DATABASE_URL for DB integration tests)
cd apps/api && go vet ./... && go test ./...
```

---

## Key Environment Variables (`apps/api`)

| Variable | Default (Dev) | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `DATABASE_URL` | `postgres://beo:beo@localhost:5432/beo?sslmode=disable` | PostgreSQL connection string |
| `JWT_SECRET` | dev default | HMAC secret for JWT auth tokens |
| `QR_HMAC_SECRET` | dev default | HMAC secret for signing/verifying ticket QR payloads |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `1025` | SMTP server (Mailpit locally, Brevo in production) |
| `SMTP_USER` / `SMTP_PASS` | `""` | SMTP credentials |
| `DUITKU_MERCHANT_CODE` / `DUITKU_API_KEY` | dev defaults | Duitku payment gateway credentials |
| `DUITKU_RETURN_URL` | `http://localhost:5173/orders/return` | Post-payment redirect URL |
| `STORAGE_DIR` | `./uploads` | Directory for uploaded manual transfer proofs |

---

## License

See [LICENSE](LICENSE).
