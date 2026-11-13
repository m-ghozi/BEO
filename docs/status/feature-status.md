# BEO — Status Fitur Komprehensif

> **Tanggal audit:** 13 November 2026
> **Commit:** `2ad322c` (branch `main`)
> **Metode:** audit langsung terhadap kode (`apps/api`, `apps/web`, `apps/mobile`, `packages/contracts`), bukan hanya dokumentasi. Dokumentasi (`docs/superpowers/specs`, `docs/superpowers/plans`) dan `README.md` dipakai sebagai pembanding.
> **Catatan penting:** seluruh checkbox di ketiga file plan (`backend-api`, `web-spa`, `mobile-app`) masih `- [ ]` (0 dari 101 step dicentang). Jadi status di bawah ini **berdasarkan kondisi kode aktual**, bukan status centang dokumentasi.

## Legenda status

| Simbol | Arti |
|---|---|
| ✅ | **Selesai** — berfungsi end-to-end (API + UI bila relevan) |
| 🟡 | **Sebagian** — alur utama jalan, tetapi ada bagian penting yang kurang/terbatas/bug |
| ❌ | **Belum ada** — tidak ditemukan implementasi di kode |
| 🔮 | **Ditunda (fase 2)** — dinyatakan out-of-scope oleh desain |

---

## Ringkasan eksekutif

| Area | Status | Ringkasan singkat |
|---|---|---|
| Infrastruktur & DevOps | 🟡 | Compose (Postgres/Mailpit/API/Nginx) jalan; belum ada CI, observability, hardening config |
| Auth, akun & RBAC | 🟡 | Register/login/JWT/role event solid; tidak ada bootstrap `platform_admin`, reset password, refresh token |
| Event & agenda | 🟡 | Create/read/sessions/posts jalan; **tidak ada update/publish/cancel/delete** |
| Tiket & checkout | ✅ | Kuota atomik, multi-attendee, free/Duitku/manual, claim token, QR/PDF |
| Pembayaran | 🟡 | Duitku + webhook + manual verification + rekonsiliasi telat bayar; endpoint bayar/proof **tanpa auth** |
| Email, QR & PDF | 🟡 | SMTP + QR inline + PDF jalan; URL claim di-hardcode localhost, tanpa retry/queue |
| Agency, kuota & claim | 🟡 | Alokasi/top-up, reclaim, issue, claim ada; issued ticket tanpa email/ledger, UI agency terbatas |
| CFP & peer review | 🟡 | Submit→assign→review→decide jalan; tanpa deadline, file upload, notifikasi, state machine |
| Check-in venue | ✅ | HID/webcam/manual, atomik & anti-duplikat; audit hanya untuk kegagalan |
| Ledger, payout & admin | 🟡 | Ledger/wallet/payout/admin dashboard ada; payout tidak benar-benar transfer bank |
| Fraud & audit | 🟡 | Tabel audit + hook VectorStore (no-op); belum ada deteksi skor/ML |
| Notifikasi push | 🟡 | Expo push backend + registrasi token + routing tap; EAS project ID & background handling belum |
| Web SPA | 🟡 | 11 route utama lengkap; halaman organizer/agency/CFP masih terbatas |
| Mobile (Expo) | 🟡 | Wallet/QR offline, claim, events, push dasar jalan; deep link universal & cache TTL belum |
| Kontrak & testing | 🟡 | 33 file test (11 Go, 13 web, 8 mobile, 1 contracts); modul inti organizer belum dites |

---

# A. Infrastruktur & DevOps

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| Monorepo npm workspaces (`contracts`, `web`, `mobile`) | ✅ | Root `package.json` + lockfile | `package.json` |
| Go API modular monolith | ✅ | 10 package domain, 49 route | `apps/api/internal/*` |
| PostgreSQL 16 + migrasi otomatis | ✅ | Runner kustom, tracking `schema_migrations`, 4 migrasi | `apps/api/internal/platform/db.go`, `apps/api/migrations` |
| Mailpit (SMTP lokal) | ✅ | Port 1025/8025 | `infra/docker-compose.yml` |
| Docker Compose API + Web (Nginx) | ✅ | Multi-stage build, proxy `/v1/` | `infra/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx.conf` |
| Proxy same-origin produksi | ✅ | Compose mengirim `VITE_API_BASE_URL=""` sehingga lewat Nginx | `infra/docker-compose.yml:56-67` |
| Health check | 🟡 | `GET /v1/healthz` hanya balas `{"status":"ok"}`, tidak cek DB | `apps/api/cmd/server/main.go:127-131` |
| Graceful shutdown + worker expiry | ✅ | Ticker 1 menit + `srv.Shutdown` | `apps/api/cmd/server/main.go:50-70,141-165` |
| CI/CD (GitHub Actions dll.) | ❌ | Tidak ada folder `.github/` | — |
| Structured logging / tracing / metrics | ❌ | Hanya `log.Printf` | `apps/api/cmd/server/main.go` |
| Rate limiting / request ID / panic recovery | ❌ | Tidak ada middleware tersebut | `apps/api/cmd/server/main.go:34-48` |
| Validasi config produksi | 🟡 | Secret punya fallback dev hardcoded; `LoadConfig` mengembalikan error tapi tidak memvalidasi secret | `apps/api/internal/platform/config.go:32-47` |
| Object storage (S3) | ❌ | Hanya filesystem lokal `STORAGE_DIR` | `apps/api/internal/payments/handler.go` |

---

# B. Auth, akun & RBAC

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| Register (bcrypt) | ✅ | Default `standard`; hanya `standard`/`agency` yang boleh self-register | `apps/api/internal/identity/service.go:71-126` |
| Login + JWT HS256 (7 hari) | ✅ | Error generik untuk user/password salah | `apps/api/internal/identity/middleware.go` |
| Push token registration | ✅ | Idempotent, array `expo_push_tokens` | `apps/api/internal/identity/service.go:172-194` |
| RBAC per-event | ✅ | Owner, `co_organizer`, `reviewer`, `checkin_staff` | `apps/api/internal/identity/service.go:198-285` |
| Proteksi route web by role | 🟡 | `/agency` & `/admin` dijaga; `/organizer*`, `/cfp`, `/checkin` hanya butuh login | `apps/web/src/App.tsx:39-111` |
| Persistensi sesi web | ✅ | `localStorage` + `AuthContext` | `apps/web/src/features/auth/AuthContext.tsx` |
| Persistensi sesi mobile | ✅ | JWT di SecureStore, profil di AsyncStorage | `apps/mobile/src/services/api.ts`, `src/context/AuthContext.tsx` |
| Bootstrap `platform_admin` | ❌ | Registrasi menolak `platform_admin`, tidak ada seed user; admin tak bisa dibuat lewat API | `apps/api/migrations/0001_init.sql`, `identity/service.go:85-88` |
| Refresh token / logout server-side / revocation | ❌ | Hanya access token 7 hari | `identity/middleware.go:38` |
| Lupa password / verifikasi email / MFA | ❌ | Tidak ada | — |
| Profil user (lihat/edit) | 🟡 | Mobile menampilkan profil read-only; tidak ada endpoint update profil | `apps/mobile/app/(tabs)/profile.tsx` |
| Hapus anggota event | ❌ | Hanya assign & list member | `identity/handler.go:31-32` |

---

# C. Event & agenda

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| Buat event (4 tipe) | ✅ | `community`, `seminar_workshop`, `conference`, `meetup_ted`; validasi slug & waktu | `apps/api/internal/events/service.go:150-233` |
| List event publik | ✅ | Hanya `published`, limit maks 100, belum ada pagination UI | `events/service.go:508-572` |
| Detail event by slug/UUID | ✅ | Termasuk sessions | `events/service.go:411-500` |
| Sesi/agenda | ✅ | Create + list, validasi waktu & role | `events/service.go:236-300,627-666` |
| Pengumuman (posts) | ✅ | Create + list + push ke pemegang tiket valid | `events/service.go:304-408` |
| Update / publish / cancel / complete event | ❌ | Status hanya bisa diset saat create; tidak ada `UPDATE events` selain di test | `events/service.go:150-233` (tidak ada handler update) |
| Hapus event | ❌ | Tidak ada | — |
| Filter event `draft`/`cancelled` dari publik | ❌ | Detail by slug/ID tidak memfilter status | `events/service.go:411-500` |
| `modules_enabled` sebagai gating fitur | ❌ | Disimpan & dikembalikan, tidak pernah dicek | grep `modules_enabled` |
| Kapasitas level event | 🟡 | Kapasitas efektif dari kuota tipe tiket, bukan field event | `migrations/0001_init.sql` |
| Speaker/track management | 🟡 | Hanya lewat field sesi (`speaker`, `room/stage`); tidak ada master speaker/track | `event_sessions` |
| Agenda per-hari / bookmark / RSVP | ❌ | Mobile hanya list datar | `apps/mobile/app/events/[slug].tsx` |
| Edit/hapus sesi & post | ❌ | Hanya create/list | — |

---

# D. Tiket & checkout

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| Tipe tiket (harga, kuota, window penjualan) | ✅ | Validasi harga/kuota/currency | `ticketing/service.go:190-238` |
| Reservasi atomik anti-oversell | ✅ | `SELECT ... FOR UPDATE` + hitung `sold+reserved+allocated` | `ticketing/service.go:327-424` |
| Checkout guest & multi-attendee | ✅ | `attendee_name`/`attendee_email` per tiket, tanpa akun | `ticketing/service.go:327-484` |
| Tiket gratis langsung valid | ✅ | Order `paid`, tiket `valid`, email langsung | `ticketing/service.go:402-411` |
| Order berbayar (Duitku / manual) | ✅ | Tiket `pending`, reservasi 30 menit | `ticketing/service.go:412-424` |
| Gating `requires_accepted_cfp` | ✅ | Pembeli harus punya submission `accepted` | `ticketing/service.go:371-388` |
| Kode tiket + HMAC + claim token | ✅ | `BEO-XXXXXXXXXXXX`, HMAC-SHA256, token unik | `ticketing/qr.go`, `ticketing/service.go:277-323` |
| Auto-bind tiket pembeli | ✅ | Berdasarkan email | `ticketing/service.go:462-466` |
| My tickets | ✅ | Tiket yang dibeli atau di-claim | `ticketing/service.go:776-812` |
| Download QR PNG & PDF | ✅ | Hanya tiket `valid`; regenerate signature bila kosong | `ticketing/pdf.go`, `ticketing/service.go:828-916` |
| Daftar order per event | ✅ | Filter status, hanya owner/co-org | `ticketing/service.go:1046-1112` |
| Detail order / status order | ❌ | Tidak ada `GET /orders/{id}` | — |
| Refund / cancel / transfer tiket | ❌ | Tidak ada | — |
| Re-issue / regenerate tiket | ❌ | Tidak ada endpoint | — |
| Claim hanya untuk tiket valid | ❌ | Claim tidak mengecek status tiket (`pending`/`cancelled` bisa diklaim) | `ticketing/service.go:750-772` |
| Summary ketersediaan tiket per event | ❌ | Hanya bisa disimpulkan dari angka tipe tiket | — |
| Proteksi aset tiket (PDF/QR publik) | ❌ | Cukup kode tiket, tanpa auth/ownership | `ticketing/handler.go:43-44` |

---

# E. Pembayaran

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| Duitku inquiry (HTTP nyata) | ✅ | Signature `MD5(merchantCode+orderID+amount+apiKey)` | `payments/duitku.go:78-142` |
| Webhook Duitku (JSON & form-urlencoded) | ✅ | Verifikasi signature constant-time, cek amount | `payments/service.go:130-175` |
| Idempotensi webhook | ✅ | Order sudah `paid` tidak diproses ulang | `payments/service.go:177-222` |
| Rekonsiliasi pembayaran telat | ✅ | Order expired dicek ulang; jika overbooked dicatat audit `late_payment_overbooked` | `payments/service.go:436-515` |
| Manual transfer (URL/JSON) | ✅ | Status `pending_verification` | `payments/service.go:226-253` |
| Upload bukti multipart (5 MB, jpg/png/webp/pdf) | ✅ | Nama file UUID, traversal guard saat serve | `payments/handler.go:240-336` |
| Verifikasi manual (approve/reject) | ✅ | Approve → paid + tiket valid + ledger + email; reject → lepas kuota | `payments/service.go:256-336` |
| Ledger penjualan (gross + komisi) | ✅ | Rate dari `category_commission_rates` | `ledger/service.go:54-95` |
| Wallet balance organizer | ✅ | `SUM(ledger amount)` | `ledger/service.go:98-115` |
| Request payout (anti-overdraw) | ✅ | Row lock + `payout_debit` + audit | `ledger/service.go:119-202` |
| Auth/ownership pada endpoint bayar & proof | ❌ | `/pay/duitku`, `/proof`, `/proof-upload` **publik** tanpa cek pemilik/ metode bayar | `payments/handler.go:48-51` |
| Callback gagal (`resultCode != 00`) | 🟡 | Dibalas `200 ok` tanpa mengubah/membatalkan order | `payments/service.go:147-150` |
| Refund / chargeback | ❌ | Tidak ada | — |
| Order status query / halaman status | ❌ | Tidak ada | — |
| Rekonsiliasi order macet (`pending_verification`) | ❌ | Tidak ada job/rekonsiliasi | — |
| Transfer bank otomatis untuk payout | ❌ | Hanya perubahan status (`pending→approved→paid`) | `admin/service.go:358-379` |
| Bukti transfer di object storage | ❌ | Hanya filesystem lokal + URL | `payments/handler.go` |

---

# F. Email, QR & PDF

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| SMTP STARTTLS + PLAIN auth (Brevo/Mailpit) | ✅ | Multipart HTML + inline QR (`cid:qrcode`) + PDF | `platform/mailer.go:58-214` |
| Email tiket gratis & setelah pembayaran | ✅ | Dipanggil saat order valid/paid | `ticketing/service.go:479-481,921-1030` |
| QR PNG & PDF tiket | ✅ | `fpdf` + `go-qrcode` | `ticketing/pdf.go` |
| Proteksi header injection | 🟡 | Dicek untuk `to`/`subject`; `from` belum | `platform/mailer.go:133-141` |
| Link claim di email | 🟡 | **Hardcoded** `http://localhost:5173/claim?token=` | `ticketing/service.go:999` |
| Email status pembayaran | 🟡 | Hanya email tiket; tidak ada email "pembayaran gagal/expired" | `ticketing/service.go` |
| Email hasil CFP (accepted/rejected) | ❌ | Tidak ada | — |
| Template email terkelola | ❌ | HTML inline di kode | `platform/mailer.go` |
| Queue/retry/bounce handling | ❌ | Error email di-log lalu diabaikan | `ticketing/service.go:1026-1028` |

---

# G. Agency, kuota & claim

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| Akun agency | ✅ | `account_type='agency'`, hanya boleh dibuat saat register | `identity/service.go` |
| Alokasi kuota ke agency | ✅ | Kuota dipotong dari pool tipe tiket | `ticketing/service.go:487-567` |
| Top-up kuota agency | ✅ | Alokasi berulang menambah `quota_limit` (upsert kumulatif) | `ticketing/service.go:547-566` |
| Reclaim kuota belum terpakai | ✅ | API tersedia, cek sisa kuota | `ticketing/service.go:570-638` |
| Issue tiket massal oleh agency | ✅ | Cek alokasi aktif + `issued_count <= quota_limit` | `ticketing/service.go:641-720` |
| Claim token per tiket | ✅ | Unik, terikat ke user saat claim | `ticketing/service.go:723-773` |
| Daftar agency per event | ✅ | Join nama/email agency | `ticketing/service.go:1116-1163` |
| Portal agency (web) | 🟡 | Harus paste Event ID & Ticket Type ID; hasil hanya di state (hilang saat reload); tanpa daftar kuota | `apps/web/src/features/agency-portal/AgencyPortalPage.tsx` |
| UI reclaim / top-up kuota | ❌ | Endpoint reclaim belum dipakai web | — |
| Daftar alokasi milik agency | ❌ | Tidak ada endpoint "my allocations" | — |
| Email/PDF untuk tiket hasil agency | ❌ | Issuance tidak memicu email/PDF | `ticketing/service.go:715-719` |
| Ledger/billing B2B untuk penjualan agency | ❌ | Order agency `total_amount=0`, tanpa entri ledger | `ticketing/service.go:641-720` |
| Link claim di mobile/email | 🟡 | `beo://claim?token=` didukung app; email mengirim URL web localhost | `apps/mobile/app/(tabs)/claim.tsx`, `ticketing/service.go:999` |

---

# H. CFP & peer review

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| Submit paper | ✅ | Author dari JWT, status `submitted` | `cfp/service.go:89-136` |
| Assign reviewer | ✅ | Owner/co-org; membuat baris `cfp_reviews` + status `under_review` | `cfp/service.go:139-188` |
| Submit review (score 1–10, komentar, rekomendasi) | ✅ | Hanya reviewer yang di-assign | `cfp/service.go:191-219` |
| Keputusan (accept/reject/revision) | ✅ | Owner/co-org | `cfp/service.go:222-254` |
| List submission sesuai role | ✅ | Organizer lihat semua; author/reviewer sesuai hak | `cfp/service.go:258-321` |
| Portal CFP (web) | 🟡 | Form submit/assign/review/decide ada; UI role-blind, assign via paste UUID | `apps/web/src/features/cfp-review/CFPPortalPage.tsx` |
| Validasi role `reviewer` | ❌ | Role string tidak dicek; yang penting ada baris assignment | `cfp/service.go` |
| Deadline CFP & konfigurasi track | ❌ | Tidak ada | — |
| Upload file paper | ❌ | Hanya string `file_url` dari caller | `cfp/service.go:117-118` |
| Lihat daftar review/skor agregat | ❌ | Tidak ada endpoint | — |
| Notifikasi email/push keputusan CFP | ❌ | Tidak ada | — |
| State machine transisi | 🟡 | Organizer bisa set status mana pun yang diizinkan dari status mana pun | `cfp/service.go:241-245` |

---

# I. Check-in venue

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| Mode HID / webcam / manual | ✅ | Manual menerima kode `BEO-XXXX` tanpa HMAC; HID/webcam wajib signature | `checkin/service.go:69-100`, migrasi `0004` |
| Scan atomik & anti-duplikat | ✅ | `UPDATE ... WHERE checked_in_at IS NULL` | `checkin/service.go:102-118` |
| Klasifikasi invalid / wrong event / tampered | ✅ | Dicatat di `checkin_logs` | `checkin/service.go:130-198` |
| UI check-in | ✅ | HID auto-focus, webcam BarcodeDetector + zxing-wasm worker, manual; 25 scan terakhir | `apps/web/src/features/checkin-scanner/` |
| Deduplikasi scan | ✅ | Server + cooldown webcam 2,5 dtk + in-flight guard | `CheckinPage.tsx`, `useQRScanner.ts` |
| Audit check-in sukses | ❌ | Hanya kegagalan yang masuk `audit_events` | `checkin/service.go:120-127,168-177` |
| Atomisitas tiket + log | 🟡 | Update tiket & insert log tidak dalam satu transaksi | `checkin/service.go:110-124` |
| Fallback otomatis HID→webcam→manual | ❌ | Operator harus ganti mode manual; webcam bisa gagal senyap | `useQRScanner.ts` |
| Offline queue / export / undo check-in | ❌ | Tidak ada | — |
| Statistik check-in realtime | ❌ | Tidak ada | — |

---

# J. Ledger, payout & platform admin

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| Ledger immutable (gross/commission/payout_debit) | ✅ | Tabel `ledger_entries` | `migrations/0001_init.sql`, `ledger/service.go` |
| Komisi per kategori event (seed 2.5/5/5/3 %) | ✅ | `category_commission_rates` | `0001_init.sql:227-233` |
| Edit rate komisi (admin) | ✅ | Validasi 0–100, NaN/Inf ditolak | `admin/service.go:230-260` |
| Overview admin (users/events/orders/revenue/komisi/payout) | ✅ | 6 counter | `admin/service.go:107-129` |
| List event/user admin | 🟡 | Read-only, limit 100, tanpa pagination/filter | `admin/service.go:132-227` |
| Approval / complete / reject payout | ✅ | Reject mengembalikan `payout_debit` + audit | `admin/service.go:263-436` |
| Audit log viewer | ✅ | 100 event terakhir | `admin/service.go:439-480` |
| Dashboard admin (web) | ✅ | 5 tab sesuai endpoint di atas | `apps/web/src/features/admin/AdminDashboardPage.tsx` |
| Bootstrap admin pertama | ❌ | Tidak ada seed/CLI; harus edit DB manual | `0001_init.sql` |
| Manajemen user/role/suspend | ❌ | Tidak ada | — |
| Moderasi event / hapus user | ❌ | Tidak ada | — |
| Pagination, search, filter, export | ❌ | Tidak ada | — |
| Pencairan dana nyata ke bank | ❌ | Status saja, tanpa integrasi disbursement | `admin/service.go:358-379` |

---

# K. Fraud & audit

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| Tabel `audit_events` (IP, UA, payload JSONB) | ✅ | Logger audit | `fraud/audit.go:43-100` |
| Audit aksi sensitif | 🟡 | Ada untuk check-in gagal, verifikasi manual, rekonsiliasi, payout; **tidak** untuk check-in sukses, order, claim, event/sesi/post, alokasi/issue agency, edit komisi | grep `auditLogger.Log` |
| Interface `VectorStore` + `NoopVectorStore` | 🟡 | Hook siap, implementasi no-op | `fraud/audit.go:22-31`, `main.go:121` |
| Skor fraud / anomali / ML | 🔮 | Dinyatakan fase lanjutan di desain | `design.md:34,164` |
| Rate limiting dasar | ❌ | Belum ada (padahal disebut di desain) | — |
| Device fingerprint | ❌ | Hanya User-Agent/IP dari header | `checkin/handler.go` |
| Kepercayaan `X-Forwarded-For` | 🟡 | Dipakai langsung tanpa trusted proxy | `checkin/handler.go:71-79` |

---

# L. Notifikasi push

| Fitur | Status | Keterangan | Bukti |
|---|---|---|---|
| Expo Push client (batch 100) | ✅ | HTTP nyata, timeout 10 dtk | `platform/push.go:51-112` |
| Push pengumuman ke pemegang tiket valid | ✅ | Token distinct per event | `events/service.go:363-405` |
| Registrasi token (login/register/manual) | ✅ | `POST /v1/me/push-token` | `identity`; `mobile/src/context/AuthContext.tsx` |
| Handler foreground | ✅ | Banner tetap tampil | `mobile/src/services/notifications.ts:6-13` |
| Routing tap notifikasi | ✅ | `event_slug` → detail event; `claim_token` → claim; event menang | `notificationRouting.ts` |
| EAS project ID / `eas.json` | ❌ | Tidak ada `extra.eas.projectId`; token bisa gagal senyap | `apps/mobile/app.json` |
| Background notification task | ❌ | Tidak ada `expo-task-manager` | — |
| Unregister token saat logout | ❌ | Token lama tetap di server | `AuthContext.logout` |
| Push untuk `claim_token` | ❌ | Backend tidak pernah mengirim push claim | `events/service.go:397-402` |
| In-app inbox / read state | ❌ | Tidak ada | — |
| Icon/warna notifikasi Android | ❌ | Tidak dikonfigurasi | `app.json` |

---

# M. Web SPA — inventaris route

| Route | Halaman | Status | Catatan |
|---|---|---|---|
| `/` | `EventsListPage` | ✅ | List event publik, tanpa pagination |
| `/events/:slug` | `EventDetailPage` | ✅ | Tiket, sesi, pengumuman; error sekunder di-*swallow* |
| `/orders/return` | `OrderReturnPage` | 🟡 | Sukses ditentukan dari query `resultCode` di klien, tanpa verifikasi backend |
| `/login`, `/register` | Auth | ✅ | Form + validasi shared schema |
| `/my-tickets` | `MyTicketsPage` | ✅ | QR/PDF, status |
| `/claim` | `ClaimTicketPage` | ✅ | Prefill `?token=` |
| `/organizer` | `OrganizerDashboardPage` | ✅ | List & create event |
| `/organizer/events/:eventId` | `EventManagePage` | 🟡 | 6 tab (sessions, posts, tiket, order, agency, tim); **create-only**, tanpa edit/hapus, tanpa reclaim UI |
| `/organizer/wallet` | `WalletPayoutsPage` | ✅ | Balance + request payout |
| `/agency` | `AgencyPortalPage` | 🟡 | Butuh raw ID, hasil ephemeral, tanpa kuota |
| `/admin` | `AdminDashboardPage` | 🟡 | 5 tab; event/user read-only, tanpa filter/export |
| `/events/:eventId/cfp` | `CFPPortalPage` | 🟡 | Fungsional; UI role-blind, assign via UUID |
| `/events/:eventId/checkin` | `CheckinPage` | ✅ | HID/webcam/manual; webcam punya mode gagal senyap |
| `*` | 404 | ✅ | Halaman 404 |

**Detail penting web**

| Aspek | Status | Keterangan |
|---|---|---|
| Checkout multi-tiket | ✅ | Validasi nama/email per attendee |
| Rekening manual transfer | 🟡 | **Hardcoded** BCA `123-456-7890` di `CheckoutForm.tsx` |
| Webcam scanner | 🟡 | `BarcodeDetector` → fallback `zxing-wasm` worker; gagal senyap bila `Worker` tidak ada atau detector error |
| Guard role halaman organizer/CFP/check-in | ❌ | Hanya `ProtectedRoute` login; otorisasi bergantung 403 API |
| Pagination / search event | 🟡 | Search ada; pagination tidak |
| Toast/notifikasi global | ❌ | Feedback inline per halaman |
| Aksesibilitas | 🟡 | Label form & aria-label ikon ada; tab admin tanpa `role=tablist/tabpanel`, tanpa skip-link |

---

# N. Mobile App (Expo) — inventaris layar

| Route | Layar | Status | Catatan |
|---|---|---|---|
| `/(auth)/login` | Login | ✅ | Zod schema + error API |
| `/(auth)/register` | Register | ✅ | Selalu `standard` |
| `/(tabs)` | My Tickets | ✅ | Wallet + cache offline + pull-to-refresh |
| `/(tabs)/events` | Events | 🟡 | Online saja; tanpa cache; diam-diam maks 50 event |
| `/(tabs)/claim` | Claim | ✅ | Input manual + `beo://claim?token=` |
| `/(tabs)/profile` | Profile | ✅ | Read-only + sync push + logout |
| `/events/[slug]` | Event detail | 🟡 | Sesi + pengumuman + cache; tanpa tombol back/header |
| `/tickets/[code]` | QR pass | ✅ | QR dari cache tanpa jaringan |
| `+not-found` | — | ❌ | Tidak ada |

**Detail penting mobile**

| Aspek | Status | Keterangan |
|---|---|---|
| Offline ticket wallet & QR | ✅ | AsyncStorage + SecureStore; QR `qr_signature` dari server |
| Cache event detail | ✅ | Fallback saat fetch gagal + banner timestamp |
| TTL / batas umur cache | ❌ | `updatedAt` disimpan tapi tidak pernah dipakai |
| Deteksi offline sejati | ❌ | Semua error (termasuk 404/500) dilabeli “Offline Mode” |
| Cache events directory | ❌ | Hanya wallet & event detail |
| Deep link `beo://` | ✅ | Scheme terdaftar; prefill claim |
| Universal link HTTPS | ❌ | Tanpa associatedDomains/intentFilters/assetlinks |
| Claim saat belum login | ❌ | Token hilang karena redirect ke login |
| Push notification | 🟡 | Dasar jalan; project ID/background/unregister belum |
| Status tiket | 🟡 | `checked_in_at` menang atas `cancelled`; QR tetap tampil untuk tiket cancelled |
| Cache claim fallback | 🟡 | Bila refresh wallet gagal, cache ditimpa hanya 1 tiket |
| Timeout/retry request | ❌ | `fetch` tanpa AbortController |
| Base URL device | 🟡 | Default `localhost:8080`; perlu `EXPO_PUBLIC_API_URL` |

---

# O. Kontrak & testing

| Aspek | Status | Keterangan |
|---|---|---|
| `@beo/contracts` (DTO + Zod) | ✅ | Dipakai web & mobile |
| Test Go | ✅ | 11 file; integrasi **skip** kecuali `TEST_DATABASE_URL` diset |
| Test Web (Vitest) | ✅ | 13 file |
| Test Mobile (Jest) | ✅ | 8 file / 40 kasus |
| Test Contracts | ✅ | 1 file |
| CI menjalankan test | ❌ | Tidak ada pipeline |
| Coverage modul organizer | ❌ | `OrganizerDashboardPage` & `EventManagePage` tanpa test |
| Coverage fraud/ledger langsung | ❌ | Tidak ada test khusus |

**Perintah verifikasi**

```bash
npm test --workspace=@beo/contracts
npm test --workspace=@beo/web
npm run build --workspace=@beo/web
npm test --workspace=@beo/mobile
npm run typecheck --workspace=@beo/mobile
cd apps/api && go vet ./... && go test ./...
```

---

# P. Inventaris endpoint API (49 route)

Semua di bawah prefix `/v1`. Auth = butuh Bearer JWT.

| Domain | Method & Path | Auth/Role |
|---|---|---|
| Health | `GET /healthz` | publik |
| Identity | `POST /auth/register` | publik |
| Identity | `POST /auth/login` | publik |
| Identity | `POST /me/push-token` | auth |
| Identity | `GET /events/{eventID}/members` | owner/co-org |
| Identity | `POST /events/{eventID}/members` | **owner saja** |
| Events | `POST /events` | auth (semua tipe akun) |
| Events | `GET /organizer/events` | auth |
| Events | `GET /events` | publik |
| Events | `GET /events/{slug}` | publik |
| Events | `POST /events/{eventID}/sessions` | owner/co-org |
| Events | `POST /events/{eventID}/posts` | owner/co-org |
| Events | `GET /events/{eventID}/sessions` | publik |
| Events | `GET /events/{eventID}/posts` | publik |
| Ticketing | `GET /events/{eventID}/ticket-types` | publik |
| Ticketing | `POST /events/{eventID}/ticket-types` | owner/co-org |
| Ticketing | `GET /events/{eventID}/orders` | owner/co-org |
| Ticketing | `POST /events/{eventID}/orders` | publik (opsional Bearer) |
| Ticketing | `GET /events/{eventID}/agencies` | owner/co-org |
| Ticketing | `POST /events/{eventID}/agencies` | owner/co-org |
| Ticketing | `POST /events/{eventID}/agencies/{agencyID}/reclaim` | owner/co-org |
| Ticketing | `POST /agency/events/{eventID}/issue` | agency (alokasi aktif) |
| Ticketing | `POST /tickets/claim` | auth |
| Ticketing | `GET /me/tickets` | auth |
| Ticketing | `GET /tickets/{ticketCode}/pdf` | **publik** |
| Ticketing | `GET /tickets/{ticketCode}/qr.png` | **publik** |
| Payments | `POST /orders/{orderID}/pay/duitku` | **publik** |
| Payments | `POST /webhooks/duitku` | publik (signature MD5) |
| Payments | `POST /orders/{orderID}/proof` | **publik** |
| Payments | `POST /orders/{orderID}/proof-upload` | **publik** |
| Payments | `GET /uploads/{filename}` | **publik** |
| Payments | `POST /orders/{orderID}/verify` | owner/co-org |
| Payments | `GET /organizer/wallet` | auth |
| Payments | `GET /organizer/payouts` | auth |
| Payments | `POST /organizer/payouts` | auth |
| Check-in | `POST /events/{eventID}/checkin` | owner/co-org/checkin_staff |
| CFP | `POST /events/{eventID}/cfp/submissions` | auth |
| CFP | `GET /events/{eventID}/cfp/submissions` | auth (difilter role) |
| CFP | `POST /events/{eventID}/cfp/submissions/{submissionID}/assign` | owner/co-org |
| CFP | `POST /cfp/submissions/{submissionID}/reviews` | reviewer ter-assign |
| CFP | `POST /events/{eventID}/cfp/submissions/{submissionID}/decision` | owner/co-org |
| Admin | `GET /admin/overview` | platform_admin |
| Admin | `GET /admin/events` | platform_admin |
| Admin | `GET /admin/users` | platform_admin |
| Admin | `GET /admin/commissions` | platform_admin |
| Admin | `PUT /admin/commissions/{eventType}` | platform_admin |
| Admin | `GET /admin/payouts` | platform_admin |
| Admin | `POST /admin/payouts/{payoutID}/process` | platform_admin |
| Admin | `GET /admin/audit-events` | platform_admin |

---

# Q. Gap prioritas (rekomendasi perbaikan)

## P0 — Keamanan & blokir operasional

| # | Masalah | Dampak | Perbaikan |
|---|---|---|---|
| 1 | Endpoint `pay/duitku`, `proof`, `proof-upload` publik tanpa cek pemilik | Siapa pun tahu order ID bisa memicu pembayaran/mengunggah bukti | Wajibkan auth + ownership/order token, cek `payment_method` |
| 2 | QR/PDF tiket dapat diunduh hanya dengan kode tiket | Kebocoran QR / check-in orang lain | Auth + ownership, atau signed URL berumur pendek |
| 3 | Bukti transfer dapat diakses publik | Data pembayaran sensitif bocor | Serve via auth atau signed URL |
| 4 | Draft/cancelled event bisa dibaca publik by slug/ID | Event belum rilis terekspos | Filter status di `GetEventBySlug/ID` (kecuali organizer) |
| 5 | Claim tidak cek status tiket | Tiket pending/cancelled bisa diklaim | Tolak claim bila status bukan `valid` |
| 6 | Tidak ada cara membuat `platform_admin` | Dashboard admin tidak bisa dipakai di deploy bersih | Seed/CLI bootstrap admin |
| 7 | Tidak ada rate limiting | Brute force login, spam order | Middleware rate limit (login, order, proof, claim) |
| 8 | Secret dev hardcoded tanpa validasi produksi | Deploy produksi bisa memakai secret default | Fail-fast bila env produksi tidak diset |
| 9 | Bank transfer & claim URL hardcoded | Salah rekening/link di produksi | Konfigurasi per organizer/env |

## P1 — Kelengkapan fitur inti

| # | Masalah | Dampak | Perbaikan |
|---|---|---|---|
| 1 | Tidak ada update/publish/cancel/delete event | Draft tidak bisa diterbitkan lewat UI/API | Endpoint update + transisi status + audit |
| 2 | Tiket agency tanpa email/PDF & ledger | Tiket tidak terkirim, omzet B2B tidak tercatat | Kirim email saat issue + entri ledger/billing |
| 3 | Check-in sukses tidak masuk audit; log tidak transaksional | Jejak audit tidak lengkap, data bisa tidak konsisten | Satu transaksi + audit sukses |
| 4 | CFP tanpa deadline, upload file, gating tipe event, notifikasi | Fitur konferensi belum siap produksi | Tambah konfigurasi CFP, storage file, email keputusan |
| 5 | Webcam scanner gagal senyap | Operator mengira sedang scan | Fallback otomatis + pesan error + indikator status |
| 6 | Deep link claim hilang saat logout | User kehilangan tiket yang mau diklaim | Simpan pending deep link, replay setelah login |
| 7 | Cache mobile tanpa TTL & error 404 dilabeli offline | Data basi / misleading | TTL, NetInfo, stale-while-revalidate |
| 8 | EAS project ID & background push belum ada | Push produksi bisa tidak berfungsi | `eas.json`, projectId, background task, unregister saat logout |
| 9 | Tidak ada refund/cancel/transfer tiket & detail order | Operasional attendee terbatas | Endpoint order detail + alur refund/cancel |
| 10 | Order return hanya percaya query string | Status palsu / pending berkepanjangan | Verifikasi status order ke backend |

## P2 — Pengalaman, skala & kualitas

| # | Masalah | Perbaikan |
|---|---|---|
| 1 | Pagination/filter/export admin & event list | Tambah limit/offset, search, filter tanggal, export CSV |
| 2 | UI agency masih paste ID | Dropdown event/tiket + tampilkan sisa kuota & riwayat issue |
| 3 | Halaman organizer create-only & cache key tidak konsisten | Edit/hapus, reclaim UI, samakan query key |
| 4 | UI CFP role-blind | Sembunyikan aksi sesuai role, pilih reviewer dari daftar |
| 5 | Aksesibilitas tab admin & hasil scan | `role=tablist/tabpanel`, `aria-live`, skip-link |
| 6 | Mobile tanpa header/back | Gunakan Stack + header, tambah `+not-found` |
| 7 | Test modul organizer & jalur scanner nyata | Tambah test `EventManagePage`, `OrganizerDashboardPage`, worker error |
| 8 | Belum ada CI | GitHub Actions: vet/test/build semua workspace |
| 9 | Observability | Structured log, request ID, metrics, readiness check DB |
| 10 | Versi React Native drift | Naikkan ke `0.76.9` sesuai SDK 52 |

---

# R. Deviasi dokumentasi vs kode

| Hal | Dokumentasi | Kondisi kode | Status |
|---|---|---|---|
| Checklist plan | 0/101 step dicentang | Mayoritas fitur inti sudah diimplementasi | Dokumentasi stale |
| Dashboard admin | Tidak ada task di plan, tetapi diklaim README | Diimplementasi penuh (overview, payout, komisi, audit) | Kode > docs |
| Check-in manual `BEO-XXXX` | README klaim; desain hanya `hid`/`webcam` | Diimplementasi + migrasi `0004` | Kode > docs |
| Reclaim kuota agency | README klaim "quota top-ups/reclamation" | API reclaim ada; top-up via alokasi kumulatif; UI belum | Sebagian |
| Rekonsiliasi pembayaran telat | README klaim; plan tidak merinci | Diimplementasi (`late_payment_overbooked`) | Kode > docs |
| TTL manual transfer | Desain: 30 menit Duitku, **24 jam manual** | Keduanya 30 menit | Deviasi |
| Status event | Desain: `draft`/`published`/`closed` | Kode: `draft`/`published`/`completed`/`cancelled` | Deviasi |
| Ledger | Desain: gross, commission, net | Kode: gross, commission, payout_debit (net diturunkan) | Setara |
| Email CFP & status pembayaran | Desain menyebut Brevo untuk keduanya | Hanya email tiket | Belum |
| Compose API + Web | Plan hanya Postgres + Mailpit | Compose mencakup API + Nginx | Kode > docs |
| Proxy `/v1` | README klaim proxy dev 5173 | Produksi via Nginx; dev Vite tanpa proxy (pakai `VITE_API_BASE_URL`) | Deviasi kecil |
| Path spec di plan mobile | Menunjuk `/home/mriza/...` | Repo di `/home/shiro/...` | Dokumentasi stale |

---

# S. Isu operasional yang ditemukan saat menjalankan project

| Isu | Penyebab | Solusi yang diterapkan |
|---|---|---|
| Compose gagal: port 5432 sudah dipakai | Container `postgres` pribadi di host | `infra/docker-compose.override.yml` memetakan project ke **5433** |
| Expo crash `metro-cache/src/stores/FileStore` | `package-lock.json` lama meng-hoist **expo 58** bersama expo 52 | Lockfile diregenerasi bersih (backup di `/tmp/beo-lock-backup.json`) |
| Bundle mobile gagal `Cannot find module 'query-string'` | `expo-router@4.0.22` mengimpor `query-string` tanpa mendeklarasikannya | Tambah `query-string@^7.1.3` ke `apps/mobile/package.json` |
| QR Expo tidak muncul | Dijalankan dengan `CI=1` (mode non-interaktif) | Jalankan `npm start` di terminal interaktif, atau pakai URL `exp://<LAN-IP>:8081` |
| Warning kompatibilitas | `react-native@0.76.5` vs ekspektasi SDK 52 `0.76.9` | Belum diubah (opsional) |
| Admin tidak bisa diakses | Tidak ada user `platform_admin` | Perlu seed manual/bootstrap (P0) |
| Duitku & claim link | Default dev localhost | Perlu konfigurasi env produksi |

---

# T. Out of scope / ditunda (fase 2)

Berdasarkan `docs/superpowers/specs/2026-11-13-beo-design.md`:

1. 🔮 Aplikasi mobile organizer/scanner terpisah (panitia memakai Web SPA).
2. 🔮 Generate sertifikat PDF otomatis untuk seminar/workshop.
3. 🔮 Waitlist otomatis saat tiket habis (meetup).
4. 🔮 Seat-map builder grafis dan live streaming.
5. 🔮 Fraud detection ML/vector scoring penuh (hanya interface + aturan deterministik).
6. 🔮 Worker embedding Qdrant/pgvector.
7. 🔮 Qdrant di Compose (opsional).

---

# U. Rekomendasi urutan pengerjaan

1. **Sprint keamanan (P0):** auth endpoint pembayaran & aset tiket, filter event draft, cek status claim, bootstrap admin, rate limiting, validasi config.
2. **Sprint lifecycle event & order:** update/publish/cancel event, detail order, refund/cancel, verifikasi halaman return.
3. **Sprint agency & check-in:** email/PDF + ledger tiket agency, UI alokasi/reclaim, transaksi check-in + audit sukses.
4. **Sprint CFP produksi:** deadline, upload file, gating modul, notifikasi keputusan, daftar review.
5. **Sprint mobile produksi:** EAS project ID, background push, deep link universal + replay saat login, TTL cache, NetInfo, header navigasi.
6. **Sprint kualitas:** CI, observability, pagination/filter/export, aksesibilitas, test organizer/scanner.

---

*Dokumen ini dihasilkan dari audit kode pada commit `2ad322c`. Perbarui tabel status setiap kali fitur besar selesai.*