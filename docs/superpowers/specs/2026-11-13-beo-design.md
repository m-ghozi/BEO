# BEO (Beo Event Organizer) — Design Document

**Date:** 2026-11-13
**Status:** Ready for Approval

---

## 1. Intent & Why

BEO (*Beo Event Organizer*) adalah platform manajemen event universal berbasis monorepo yang memungkinkan pengguna terdaftar membuat dan mengelola berbagai jenis acara—mulai dari event komunitas, seminar/workshop, konferensi ilmiah (lengkap dengan seleksi artikel oleh reviewer), hingga meetup bergaya presentasi (seperti TED).

Di sisi peserta, BEO menyediakan proses registrasi yang mulus (gratis maupun berbayar, baik membeli sendiri, dibelikan pihak lain, maupun lewat agensi), pengiriman tiket digital (email dengan QR code, PDF/gambar siap cetak, serta tautan klaim), dan aplikasi mobile ringan (Android & iOS) agar peserta dapat menyimpan tiket secara *offline* serta menerima *push notification* saat ada pengumuman atau *post* terbaru dari panitia. Di sisi panitia, BEO memastikan operasional lapangan yang cepat dan akurat melalui *check-in* QR code (hardware scanner maupun webcam browser), manajemen keuangan terpusat (*ledger* komisi & pencairan manual), serta pencatatan jejak audit yang siap dikembangkan menjadi sistem *fraud detection* berbasis vector database.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
1. **Universal Event Engine:** Satu model inti event yang dapat mengaktifkan modul tambahan sesuai tipe event (`community`, `seminar_workshop`, `conference`, `meetup_ted`), termasuk jadwal sesi/pembicara (`sessions`).
2. **Centralized Merchant, Commission & Payouts:** BEO bertindak sebagai *merchant of record* terpusat (satu akun Duitku & rekening bank BEO). Pada event berbayar, BEO memotong **komisi persentase yang berbeda per kategori event**, mencatat saldo bersih ke dompet/ledger panitia, dan mendukung **pencairan dana (*payout*) manual** kapan pun panitia meminta.
3. **Flexible Payments:** Mendukung tiket gratis, tiket berbayar online melalui **Duitku API**, serta pembayaran non-online (transfer manual/ATM) dengan upload bukti transfer yang diverifikasi panitia.
4. **Agency Ticket Issuance & Claim Token:** Akun bertipe **agensi** dapat menerbitkan tiket secara mandiri sesuai kuota yang ditetapkan panitia, lalu membagikan **link/token unik** agar peserta dapat menerima tiket digital (PDF/QR) sekaligus **mengklaim tiket ke akun BEO** mereka.
5. **Guest & Multi-Ticket Friendly:** Mendukung pembeli yang membelikan tiket untuk orang lain (*guest/delegate*), dengan output tiket digital (PDF, gambar QR siap screenshot/print, email) dan klaim via token ke aplikasi mobile.
6. **Reliable QR Ticketing & Venue Check-in:** Tiket QR code bertanda tangan kriptografis dipindai di venue menggunakan **hardware QR code reader (HID)** atau **webcam di Web SPA** (`BarcodeDetector` API + `zxing-wasm` fallback) dengan validasi atomik anti-double scan.
7. **Conference Paper Review Workflow:** Submisi abstrak/artikel oleh pemakalah, penugasan reviewer oleh panitia, penilaian/seleksi, serta opsi penguncian tiket pemakalah hanya untuk artikel berstatus `accepted`.
8. **Attendee Mobile App & Notifications:** Aplikasi mobile Android & iOS khusus **peserta** untuk akses tiket QR *offline*, jadwal acara, dan *push notification* pengumuman/post panitia.
9. **Fraud Detection Readiness:** Setiap registrasi, transaksi, aktivitas agensi, dan *check-in* tercatat dalam audit log terstruktur serta memiliki abstraksi `VectorStore` untuk deteksi anomali (tiket ganda, tiket fiktif, bot registrasi, dan penyalahgunaan agensi).

### Non-Goals (Fase Awal)
- Aplikasi mobile terpisah untuk panitia/scanner di lapangan (panitia menggunakan Web SPA).
- Generate sertifikat PDF otomatis untuk seminar/workshop (ditunda ke fase 2).
- Antrean *waitlist* otomatis saat tiket habis untuk meetup (ditunda ke fase 2).
- *Seat-map builder* grafis dan *live streaming* video terintegrasi.
- Implementasi penuh model ML/vector *scoring* fraud detection pada rilis pertama (cukup antarmuka `VectorStore`, skema audit log, dan aturan deterministik dasar seperti anti-double check-in & rate limiting).

### Anti-Goals
- **Overselling kuota tiket & kuota agensi:** Tidak boleh terjadi kondisi kuota publik atau kuota agensi terlampaui akibat *race condition*.
- **Kesalahan hitung komisi/saldo panitia:** Seluruh mutasi saldo komisi dan *payout* harus tercatat sebagai *immutable ledger entries* di PostgreSQL.
- **Ketergantungan koneksi internet peserta di pintu masuk:** QR tiket harus dapat dibuka secara *offline* di mobile app (maupun via PDF/screenshot).

---

## 3. Constraints

- **Monorepo:** Seluruh komponen (backend, web frontend, mobile frontend, shared contracts, konfigurasi infra) berada dalam satu repositori.
- **Backend:** Golang.
- **Database:** PostgreSQL untuk konsistensi transaksi kuota, ledger keuangan, dan audit log; siap terhubung ke **Vector Database** (Qdrant atau `pgvector`) melalui abstraksi `VectorStore`.
- **Web Frontend:** Single Page Application (SPA).
- **Mobile Frontend:** Aplikasi ringan lintas platform **Android & iOS** (tidak harus Dart/Flutter).
- **Payment Gateway:** **Duitku API** (terpusat milik BEO) + transfer manual ke rekening BEO dengan verifikasi panitia.
- **Email / SMTP:** **Brevo** (SMTP / Transactional Email) untuk pengiriman tiket QR, notifikasi status pembayaran, dan informasi seleksi CFP dengan deliverability tinggi.

---

## 4. Approaches Considered

### Pendekatan A: *Ultra-Lean* (Go Modular Monolith + PostgreSQL/`pgvector` + React/Vite + Capacitor)
- **Trade-off:** Satu codebase UI React dibungkus Capacitor untuk Android/iOS, paling cepat rilis, tetapi pengalaman mobile berbasis WebView kurang responsif untuk penggunaan lapangan.

### Pendekatan B: *Balanced & Native-Feel* (Go Modular Monolith + PostgreSQL + Abstraksi Vector DB + React/Vite + Expo/React Native) — **[DIPILIH]**
- **Gambaran:**
  - **Backend:** Go *modular monolith* dengan batas modul domain yang tegas.
  - **Database:** **PostgreSQL** untuk data transaksional & ledger + *interface* `VectorStore` (siap disambungkan ke **Qdrant** atau `pgvector`).
  - **Web SPA:** **React + TypeScript (Vite)** untuk publik/checkout, dashboard panitia & pencairan dana, portal reviewer konferensi, portal agensi, dan terminal *check-in* (hardware scanner + webcam).
  - **Mobile App:** **Expo (React Native)** dengan TypeScript khusus peserta Android & iOS (UI native, *push notification* FCM/APNs, *offline QR cache*).
- **Alasan Dipilih:** Menggabungkan kesederhanaan operasi satu backend Go dan transaksi ACID PostgreSQL dengan aplikasi mobile native yang nyaman dipakai peserta, sambil tetap berbagi tipe TypeScript di monorepo.

### Pendekatan C: *Microservices + NoSQL* (Go Microservices + MongoDB + Qdrant + Svelte + Kotlin Multiplatform)
- **Trade-off:** Kompleksitas operasional dan transaksi terdistribusi terlalu berat untuk fase awal, terutama untuk menjaga konsistensi kuota tiket dan ledger keuangan.

---

## 5. System Architecture & Monorepo Layout

```text
beo/
├── apps/
│   ├── api/                    # Golang Modular Monolith (REST API + Worker + Email/Push/PDF)
│   │   ├── cmd/server/         # Entrypoint HTTP server & background worker
│   │   ├── internal/
│   │   │   ├── platform/       # Config, DB (pgx), Auth (JWT/OTP), Storage, Mailer, Push, VectorStore interface
│   │   │   ├── identity/       # Users (standard | agency), event_members (organizer, reviewer, checkin_staff)
│   │   │   ├── events/         # Event CRUD, tipe event, sessions/jadwal, pengumuman/posts
│   │   │   ├── ticketing/      # Tipe tiket, kuota atomik, guest/multi-ticket, agency issuance, claim token, QR/PDF
│   │   │   ├── payments/       # Duitku API client & webhook, manual transfer proof & verification
│   │   │   ├── ledger/         # Komisi per kategori event, saldo panitia, payout requests
│   │   │   ├── checkin/        # Validasi QR, atomic check-in, log scanner/webcam
│   │   │   ├── cfp/            # Call for Papers: submisi artikel, assignment reviewer, scoring & seleksi
│   │   │   └── fraud/          # Audit log collector, rule engine dasar, VectorStore hook
│   │   └── migrations/         # SQL migrations (PostgreSQL)
│   ├── web/                    # React + TypeScript + Vite SPA
│   │   └── src/
│   │       ├── features/       # public-events, organizer-studio, wallet-payouts, cfp-review, checkin-scanner, agency-portal
│   │       └── workers/        # Web Worker untuk zxing-wasm QR decoding
│   └── mobile/                 # Expo (React Native + TypeScript) - Khusus Peserta
│       └── src/
│           ├── screens/        # My Tickets (QR offline), Claim Ticket (token), Event Feed & Schedule, Announcements
│           └── services/       # API client, offline cache, Push Notifications
├── packages/
│   └── contracts/              # OpenAPI spec / shared TypeScript types & Zod schemas
├── docs/
│   └── superpowers/specs/      # Dokumen desain & arsitektur
└── infra/                      # Docker Compose (Postgres, Mailpit/SMTP, Qdrant opsional)
```

---

## 6. Core Domain & Workflows

### 6.1 Akun, Peran & Multi-Tenancy
- **Self-Service Organizer:** Setiap pengguna terdaftar (`account_type = 'standard'`) dapat langsung membuat event dan otomatis menjadi pemilik/panitia utama pada event tersebut.
- **Per-Event Roles (`event_members`):** Pemilik event dapat mengundang/menetapkan anggota tim untuk event tertentu sebagai `co_organizer`, `reviewer` (untuk konferensi), atau `checkin_staff`.
- **Akun Agensi (`account_type = 'agency'`):** Akun khusus yang dinyatakan sebagai agensi agar dapat ditugaskan kuota penjualan oleh panitia dan mengakses `agency-portal`.
- **Platform Admin:** Mengelola konfigurasi tarif komisi per kategori event dan memproses pencairan dana (*payout*) panitia.

### 6.2 Universal Event Model & 4 Tipe Event
Setiap event memiliki atribut inti (judul, deskripsi, slug, waktu, venue, kapasitas, status `draft | published | closed`, kategori event, serta daftar `sessions` / jadwal pembicara):
1. **Event Komunitas:** Fokus pada registrasi cepat, daftar hadir, dan pengumuman komunitas.
2. **Seminar / Workshop:** Multi-sesi/jadwal pembicara dan beberapa *tier* tiket. *(Sertifikat PDF otomatis ditunda ke fase 2).*
3. **Konferensi Ilmiah:** Mengaktifkan modul **CFP (Call for Papers)**:
   - Pemakalah mengunggah abstrak/artikel (PDF) ke sebuah *track*.
   - Panitia menugaskan artikel ke **Reviewer**; reviewer memberi skor & rekomendasi; panitia menetapkan status (`submitted -> under_review -> revision_required | accepted | rejected`).
   - Tiket tipe pemakalah dapat mengaktifkan flag `requires_accepted_cfp` sehingga hanya bisa dipesan oleh penulis dengan artikel berstatus `accepted`.
4. **Meetup Bergaya TED:** Fokus pada *lineup* pembicara (`sessions`) dengan durasi slot presentasi singkat. *(Waitlist otomatis ditunda ke fase 2).*

### 6.3 Pembayaran Terpusat, Komisi & Pencairan Dana (*Payout*)
```text
[Peserta Checkout]
   ├──► Gratis ─────────────────────────────────────────────────► [CONFIRMED + QR/PDF/Email]
   ├──► Duitku API (Rekening BEO) ──► [Webhook Verified] ──────► [CONFIRMED + Catat Ledger]
   └──► Transfer Manual (Rekening BEO) ──► [Upload Bukti]
                                               │
                                    [Panitia Approve / Reject]
                                               │ (Approve)
                                               └────────────────► [CONFIRMED + Catat Ledger]
```
- **Monetisasi Komisi BEO:** Saat order berbayar berstatus `paid/confirmed`, sistem menghitung komisi BEO berdasarkan tarif kategori event (`category_commission_rates`), lalu mencatat dua entri di `ledger_entries`: pemasukan kotor, potongan komisi BEO, dan **saldo bersih milik panitia** (`net_amount`).
- **Pencairan Manual Panitia:** Panitia dapat mengajukan penarikan dana (`payout_requests`) kapan saja sesuai saldo tersedia (*available balance*) ke rekening bank yang didaftarkan panitia.
- **Pencegahan Overselling:** Reservasi tiket mengunci baris kuota di PostgreSQL (`SELECT ... FOR UPDATE`) dengan *reservation TTL* (30 menit untuk Duitku, 24 jam untuk transfer manual) yang otomatis dilepas oleh *background worker* jika kedaluwarsa.

### 6.4 Penjualan Tiket oleh Agensi & Klaim Token
1. **Alokasi Kuota:** Panitia menunjuk akun `agency` pada suatu event dan menetapkan `quota_limit` untuk agensi tersebut. Kuota ini dialokasikan secara khusus (*dedicated allocation*) dari kuota `ticket_types` agar tidak berebut/oversell dengan pembeli publik, dan sisa kuota yang belum terbit dapat ditarik kembali oleh panitia.
2. **Penerbitan Mandiri oleh Agensi:** Agensi masuk ke `agency-portal`, memilih event, dan menerbitkan tiket (satu atau massal) hingga batas `quota_limit`. Pencatatan penagihan antara panitia dan agensi mengikuti status penyelesaian B2B atau catatan order agensi.
3. **Link & Token Klaim Unik:** Setiap tiket yang diterbitkan menghasilkan `claim_token` unik dan tautan klaim (serta tiket digital PDF / gambar QR yang bisa diunduh/dicetak).
4. **Klaim ke Akun Peserta:** Peserta yang sudah mendaftar di BEO (via Web atau Mobile App) cukup memasukkan/membuka link `claim_token` tersebut untuk mengikat tiket ke akunnya (`claimed_by_user_id`), sehingga tiket langsung tersinkronisasi ke aplikasi mobile peserta.

### 6.5 Guest Checkout, Tiket Digital/Cetak & Venue Check-in
- **Pembelian untuk Orang Lain:** Satu order dapat berisi beberapa tiket dengan `attendee_name` dan `attendee_email` berbeda tanpa mewajibkan peserta tersebut punya akun BEO saat pembelian.
- **Format Tiket:** Setiap tiket yang terkonfirmasi memiliki:
  - Email konfirmasi berisi QR code inline + lampiran **PDF tiket siap cetak**.
  - Gambar QR beresolusi tinggi (dapat di-*screenshot* atau dicetak).
  - Tautan `claim_token` untuk diklaim ke akun BEO / mobile app.
- **Signed QR & Check-in di Venue:**
  - QR berisi payload ringkas bertanda tangan **HMAC-SHA256** (`ticket_code` + `event_id` + `signature`).
  - Panitia melakukan check-in di Web SPA menggunakan **Hardware QR Reader (HID)** sebagai mode utama, atau **Webcam Browser** (`BarcodeDetector` API + fallback `zxing-wasm` di Web Worker).
  - Validasi backend melakukan update atomik `WHERE checked_in_at IS NULL`; scan ulang langsung memicu peringatan duplikasi dan tercatat di `checkin_logs` serta `audit_events`.

### 6.6 Aplikasi Mobile Peserta & Push Notification
- **Akses Tiket Offline:** Tiket yang sudah diklaim ke akun peserta disimpan di penyimpanan lokal aplikasi Expo sehingga QR code tetap bisa ditampilkan di pintu masuk tanpa internet.
- **Klaim Token di App:** Peserta dapat menempelkan `claim_token` atau membuka *deep link* klaim langsung di mobile app.
- **Pengumuman Panitia:** Panitia mempublikasikan *post* di Web SPA; backend memicu *push notification* (Expo Push -> FCM/APNs) ke perangkat peserta yang terdaftar/mengklaim tiket pada event tersebut.

### 6.7 Audit Trail & Kesiapan Fraud Detection (Vector DB)
Setiap aksi sensitif (registrasi, order, verifikasi manual, penerbitan tiket agensi, klaim token, dan scan check-in) mencatat IP, User-Agent/device fingerprint, timestamp, dan `agency_id` ke `audit_events`. Interface `fraud.VectorStore` (`IndexEventVector`, `SearchSimilarPatterns`) disiapkan agar worker di fase lanjutan dapat mengirim *embedding* pola ke **Qdrant** / `pgvector` untuk mendeteksi bot, tiket ganda, dan anomali agensi.

---

## 7. High-Level Data Model (PostgreSQL)

- `users`: id, name, email, password_hash, account_type (`standard | agency | platform_admin`), expo_push_tokens, created_at
- `category_commission_rates`: event_category, commission_percent, updated_at
- `events`: id, organizer_id, title, slug, event_type (`community | seminar_workshop | conference | meetup_ted`), modules_enabled (JSONB), start_at, end_at, venue, status
- `event_members`: id, event_id, user_id, role (`co_organizer | reviewer | checkin_staff`), created_at
- `event_sessions`: id, event_id, title, speaker_name, speaker_bio, start_at, end_at, room_or_stage
- `event_agencies`: id, event_id, agency_user_id, ticket_type_id, quota_limit, issued_count, status
- `ticket_types`: id, event_id, name, price, currency, quota, allocated_agency_quota, sold_count, reserved_count, requires_accepted_cfp, sales_start_at, sales_end_at
- `orders`: id, event_id, buyer_user_id (nullable), agency_id (nullable), buyer_email, total_amount, payment_method (`free | duitku | manual_transfer | agency_issued`), payment_status (`pending | pending_verification | paid | expired | rejected`), duitku_reference, proof_file_url, expires_at
- `tickets`: id, order_id, ticket_type_id, event_id, agency_id (nullable), attendee_name, attendee_email, ticket_code, qr_signature, claim_token, claimed_by_user_id (nullable), status (`valid | cancelled`), checked_in_at, checked_in_by
- `ledger_entries`: id, organizer_id, event_id, order_id (nullable), entry_type (`ticket_sale_gross | platform_commission | payout_debit`), amount, created_at
- `payout_requests`: id, organizer_id, amount, bank_name, bank_account_number, bank_account_name, status (`pending | approved | paid | rejected`), processed_at
- `checkin_logs`: id, ticket_id, event_id, scanner_user_id, scan_mode (`hid | webcam`), result (`success | duplicate | invalid`), metadata (JSONB), created_at
- `cfp_submissions`: id, event_id, author_user_id, track, title, abstract, file_url, status (`submitted | under_review | revision_required | accepted | rejected`)
- `cfp_reviews`: id, submission_id, reviewer_user_id, score, comments, recommendation, created_at
- `event_posts`: id, event_id, author_id, title, body, notify_push, published_at
- `audit_events`: id, event_id, actor_id, event_category, payload (JSONB), ip_address, user_agent, created_at

---

## 8. Decisions & Builder Scope

### Keputusan Arsitektur yang Diambil dalam Dokumen Ini
1. **Peran Per-Event (`event_members`):** Setiap user terdaftar bisa langsung membuat event, sedangkan `reviewer`, `co_organizer`, dan `checkin_staff` ditugaskan per event.
2. **Kuota Agensi Terpisah (`allocated_agency_quota`):** Kuota agensi dipesan/dipisahkan secara eksklusif dari `ticket_types.quota` saat panitia menetapkannya, sehingga agensi memiliki kuota pasti dan tidak terjadi *overselling* dengan pembeli publik.
3. **Verifikasi Pembayaran Manual:** Tetap berada di level panitia event (atau dapat dibantu platform admin jika diperlukan), dengan status dana masuk ke ledger panitia setelah disetujui.

### Diserahkan ke Implementer (*What's Left to the Builder*)
- Pemilihan router/library HTTP Go (`chi`, `echo`, atau `net/http` + `sqlc`/`pgx`).
- Pemilihan UI component library di React/Vite (mis. Tailwind + shadcn/ui), library generate PDF tiket di Go, dan library state/navigasi di Expo.
- Konfigurasi penyimpanan file (lokal pada dev, S3-compatible pada produksi) dan integrasi kredensial **Brevo SMTP** (dengan Mailpit di Docker Compose untuk testing lokal).
- Implementasi konkret *adapter* `DuitkuClient` sesuai dokumentasi API Duitku terbaru (sandbox vs production).
- Strategi pengetesan unit, integrasi, dan *concurrency test* untuk reservasi kuota, ledger, dan *idempotency* webhook.
