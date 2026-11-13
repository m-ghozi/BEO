# BEO — Test Plan Manual

> **Versi:** 1.0 · **Tanggal:** 13 November 2026
> **Sumber acuan:** audit kode `docs/status/feature-status.md`
> **Jenis pengujian:** manual end-to-end (scripted) + exploratory
> **Cakupan:** API, Web SPA, Mobile (Expo), pembayaran, email, check-in, admin

Dokumen ini adalah panduan **manual testing** yang bisa dijalankan berulang. Setiap test case punya langkah dan hasil yang diharapkan. Bagian *Deviasi yang diketahui* di akhir wajib dibaca sebelum menyimpulkan sebuah kegagalan sebagai bug baru.

---

## 1. Konvensi

### 1.1 Status hasil

| Status | Arti |
|---|---|
| **PASS** | Hasil sesuai ekspektasi |
| **FAIL** | Hasil menyimpang dari ekspektasi (catat sebagai bug) |
| **BLOCKED** | Tidak bisa diuji karena prasyarat tidak terpenuhi |
| **N/A** | Tidak berlaku untuk build ini |

### 1.2 Tingkat keparahan

| Level | Arti |
|---|---|
| **P0** | Kehilangan data, kebocoran akses, transaksi finansial salah |
| **P1** | Alur utama tidak bisa diselesaikan |
| **P2** | Fungsi sekunder rusak / ada workaround |
| **P3** | Kosmetik, teks, UX |

### 1.3 Format laporan bug

```
ID kasus : T-04
Judul    : Checkout gratis gagal membuat tiket
Severity : P1
Langkah  : 1) ... 2) ...
Aktual   : ...
Harapan  : ...
Bukti    : screenshot / log / query SQL / respons API
```

### 1.4 Prinsip verifikasi

Jangan percaya UI saja. Setiap alur uang diverifikasi di **3 titik**:

1. **UI** — apa yang dilihat pengguna
2. **Database** — `orders`, `tickets`, `ledger_entries`
3. **Email** — Mailpit (`http://localhost:8025`)

Contoh: halaman `/orders/return` menampilkan "Payment Successful" hanya dari query string, jadi **bukan bukti** pembayaran sah.

---

## 2. Lingkungan uji

### 2.1 Layanan

| Layanan | URL | Catatan |
|---|---|---|
| Web SPA | `http://localhost:5173` | Nginx + proxy `/v1/` |
| API | `http://localhost:8080` | Langsung ke Go server |
| Mailpit | `http://localhost:8025` | Semua email keluar |
| Postgres | `localhost:5433` | user `beo`, db `beo` |
| Expo Metro | `http://10.198.17.58:8081` | Untuk aplikasi mobile |

### 2.2 Perintah dasar

```bash
# Nyalakan stack
docker compose -f infra/docker-compose.yml -f infra/docker-compose.override.yml up -d

# Status
docker compose -f infra/docker-compose.yml -f infra/docker-compose.override.yml ps

# Log API (pantau saat uji pembayaran/checkin)
docker logs -f beo_api

# Query DB
docker exec beo_postgres psql -U beo -d beo -c "SELECT ..."

# Mobile
cd apps/mobile
EXPO_PUBLIC_API_URL=http://10.198.17.58:8080 npx expo start --port 8081 --lan
```

### 2.3 Prasyarat pembayaran Duitku

Callback Duitku harus bisa diakses dari internet:

```bash
cloudflared tunnel --url http://localhost:8080
# lalu set DUITKU_CALLBACK_URL=https://<url>.trycloudflare.com/v1/webhooks/duitku
# di infra/docker-compose.override.yml, kemudian:
docker compose -f infra/docker-compose.yml -f infra/docker-compose.override.yml up -d api
```

Kredensial sandbox yang dipakai saat ini:

| Env | Nilai |
|---|---|
| `DUITKU_MERCHANT_CODE` | `DS37924` |
| `DUITKU_API_KEY` | `f08cbb095385bf327638e3945fa9d95d` |
| `DUITKU_BASE_URL` | `https://sandbox.duitku.com/webapi` |
| `DUITKU_PAYMENT_METHOD` | `BC` (BCA VA) |

---

## 3. Persiapan data uji

### 3.1 Akun

Buat lewat UI `/register` (password minimal 6 karakter):

| Kode | Email | Tipe | Peran |
|---|---|---|---|
| `U-ORG` | `org1@test.local` | standard | Organizer pemilik event |
| `U-ORG2` | `org2@test.local` | standard | Co-organizer |
| `U-REV` | `rev1@test.local` | standard | Reviewer CFP |
| `U-SCAN` | `scan1@test.local` | standard | Check-in staff |
| `U-BUY` | `buyer1@test.local` | standard | Pembeli tiket |
| `U-AGY` | `agency1@test.local` | agency | Akun agency |
| `U-ADM` | `admin1@test.local` | standard → **diubah ke `platform_admin`** | Admin platform |

### 3.2 Membuat `platform_admin`

Tidak ada UI/endpoint bootstrap admin. Setelah `admin1@test.local` terdaftar:

```bash
docker exec beo_postgres psql -U beo -d beo -c \
  "UPDATE users SET account_type='platform_admin' WHERE email='admin1@test.local';"
```

> **Penting:** `account_type` disimpan di dalam JWT. Setelah diubah, **logout lalu login ulang** agar token baru memuat `platform_admin`.

### 3.3 Event uji

Buat lewat UI `/organizer` (atau API) dengan `status: published`:

| Field | Nilai |
|---|---|
| title | `Test Event QA` |
| slug | `test-event-qa` |
| event_type | `conference` |
| start_at / end_at | besok, format RFC3339 (`2026-12-01T09:00:00Z`) |
| venue | `Jakarta Convention Center` |
| status | `published` |

Catat `event_id` dari URL `/organizer/events/{eventId}`.

### 3.4 Tipe tiket

Buat 3 tipe di tab **Tickets** pada halaman event:

| Nama | Harga | Kuota | Catatan |
|---|---|---|---|
| `Free Pass` | 0 | 20 | Untuk alur gratis |
| `Early Bird` | 50000 | 10 | Untuk Duitku/manual |
| `CFP Pass` | 25000 | 5 | `requires_accepted_cfp = true` |

`sales_end_at` wajib diisi dan harus di masa depan.

### 3.5 Anggota event

Di tab **Team** (`POST /v1/events/{eventId}/members`), dengan akun `U-ORG`:

| Email | Role |
|---|---|
| `org2@test.local` | `co_organizer` |
| `rev1@test.local` | `reviewer` |
| `scan1@test.local` | `checkin_staff` |

### 3.6 Reset data

```bash
# Hapus semua data (DESTRUKTIF)
docker compose -f infra/docker-compose.yml -f infra/docker-compose.override.yml down -v
docker compose -f infra/docker-compose.yml -f infra/docker-compose.override.yml up -d
```

---

## 4. Smoke test (S)

Dijalankan pertama, sebelum suite lain.

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| S-01 | API hidup | `curl -s localhost:8080/v1/healthz` | `{"status":"ok"}` HTTP 200 |
| S-02 | Web hidup | Buka `http://localhost:5173` | Halaman daftar event tampil |
| S-03 | Mailpit hidup | Buka `http://localhost:8025` | UI Mailpit tampil, inbox kosong |
| S-04 | Migrasi DB | `docker exec beo_postgres psql -U beo -d beo -c "\dt"` | Tabel `events`, `orders`, `tickets`, `ledger_entries`, `schema_migrations` ada |
| S-05 | Metro hidup | `curl -s localhost:8081/status` | `packager-status:running` |
| S-06 | DB reachable dari host | `psql postgres://beo:beo@localhost:5433/beo -c "SELECT 1"` | Mengembalikan `1` |

---

## 5. Auth & akun (A)

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| A-01 | Registrasi valid | `/register`, isi nama/email/password (≥6) | Redirect ke `/`, user login otomatis, muncul di `/admin/users` |
| A-02 | Registrasi email duplikat | Daftar ulang dengan email sama | Error jelas, tidak membuat user baru |
| A-03 | Registrasi password pendek | Password `123` | Ditolak validasi form |
| A-04 | Registrasi tipe agency | Pilih tipe akun `agency` | User dibuat dengan `account_type='agency'` |
| A-05 | Login valid | `/login` dengan akun A-01 | Masuk, nama tampil di header |
| A-06 | Login password salah | Password keliru | Pesan generik (tidak membocorkan email terdaftar/tidak) |
| A-07 | Persistensi sesi web | Login, refresh halaman, tutup-buka tab | Tetap login (token di `localStorage`) |
| A-08 | Logout | Klik logout | Kembali ke `/login`, route terproteksi tidak bisa diakses |
| A-09 | Guard halaman | Tanpa login buka `/my-tickets`, `/organizer`, `/admin` | Dialihkan ke `/login` |
| A-10 | Guard role `/admin` | Login sebagai `U-BUY`, buka `/admin` | Ditolak (403/redirect), bukan halaman admin |
| A-11 | Guard role `/agency` | Login `U-BUY`, buka `/agency` | Ditolak |
| A-12 | Escalation via JWT | Ganti `account_type` di token `localStorage` menjadi `platform_admin` lalu buka `/admin` | **Ditolak** — signature JWT tidak valid |
| A-13 | Token kedaluwarsa | Set token acak/rusak di `localStorage`, buka halaman | Kembali ke login, bukan crash |

---

## 6. Event, sesi & pengumuman (E)

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| E-01 | Buat event draft | `/organizer` → buat event tanpa mengubah status | Event tersimpan `status='draft'`, muncul di dashboard organizer |
| E-02 | Buat event published | Buat event dengan status `published` | Tidak error |
| E-03 | Validasi slug | Slug `Test Event` (spasi/huruf besar) | Ditolak; slug harus `kebab-case` |
| E-04 | Validasi waktu | `end_at` lebih awal dari `start_at` | Ditolak |
| E-05 | Event tampil di publik | Buka `/` | Hanya event `published` yang tampil |
| E-06 | Detail event by slug | Buka `/events/test-event-qa` | Judul, venue, tiket, sesi tampil |
| E-07 | Event draft di publik | Buat event draft, buka `/events/<slug-draft>` langsung | **Diketahui:** saat ini tetap tampil (lihat DEV-01) |
| E-08 | Tambah sesi | Tab **Sessions** → isi judul, speaker, waktu, ruang | Sesi tampil di urutan waktu |
| E-09 | Validasi sesi | `end_at` sebelum `start_at` | Ditolak |
| E-10 | Tambah pengumuman | Tab **Posts** → judul + isi | Post tampil di detail event |
| E-11 | Pengumuman + push | Buat post dengan `notify_push` aktif | Request sukses; push terkirim ke pemegang tiket valid (butuh device) |
| E-12 | Edit event | Cari tombol edit/hapus di UI organizer | **Diketahui:** belum ada (DEV-02) |
| E-13 | Hapus sesi/post | Cari aksi hapus | **Diketahui:** belum ada (DEV-02) |

---

## 7. Tiket & checkout (T)

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| T-01 | Buat tipe tiket | Tab **Tickets** → nama, harga, kuota, `sales_end_at` | Tersimpan, tampil di halaman publik |
| T-02 | Validasi kuota | Kuota `0` | Ditolak |
| T-03 | Validasi harga negatif | Harga `-1000` | Ditolak |
| T-04 | Checkout tiket gratis | `/events/test-event-qa`, pilih `Free Pass`, isi nama+email, submit | Order `paid`, tiket `valid`, email tiket masuk Mailpit |
| T-05 | Checkout multi-attendee | Beli 3 tiket sekaligus dengan 3 nama/email berbeda | 3 tiket dibuat, total = harga × 3 |
| T-06 | Attendee tanpa email | Kosongkan email attendee | Ditolak validasi |
| T-07 | Anti-oversell | Set kuota 1, lakukan 2 checkout bersamaan (2 browser) | Hanya 1 berhasil; yang kedua ditolak kuota habis |
| T-08 | Pembeli terikat akun | Checkout dengan email = email akun login | Tiket muncul di `/my-tickets` |
| T-09 | Tiket guest | Checkout dengan email bukan akun mana pun | Tiket tetap dibuat, bisa diklaim lewat claim token |
| T-10 | `requires_accepted_cfp` | Beli `CFP Pass` tanpa submission accepted | Ditolak dengan pesan jelas |
| T-11 | `requires_accepted_cfp` lolos | Setelah CFP diterima (C-06), beli `CFP Pass` | Berhasil |
| T-12 | Halaman tiket saya | Buka `/my-tickets` | Tiket, status, tombol QR/PDF tampil |
| T-13 | Unduh PDF | Klik PDF | File PDF terunduh, berisi QR |
| T-14 | Ambil QR PNG | Buka `/v1/tickets/<kode>/qr.png` | Gambar QR tampil |
| T-15 | Tiket pending | Buat order Duitku, jangan bayar, buka PDF/QR | Ditolak (hanya tiket `valid`) |
| T-16 | Detail order | Cari halaman detail order per ID | **Diketahui:** belum ada endpoint `GET /orders/{id}` (DEV-03) |
| T-17 | Refund/cancel | Cari aksi batal/refund tiket | **Diketahui:** belum ada (DEV-03) |

---

## 8. Pembayaran (P)

### 8.1 Manual transfer

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| P-01 | Order manual | Checkout `Early Bird` → pilih **Manual Transfer** | Order `pending`, halaman instruksi + nomor rekening tampil |
| P-02 | Upload bukti (multipart) | Upload JPG < 5 MB | Status `pending_verification`, `proof_file_url` terisi |
| P-03 | Upload file besar | Upload 6 MB | Ditolak (batas 5 MB) |
| P-04 | Upload tipe salah | Upload `.exe` | Ditolak |
| P-05 | Verifikasi approve | Login `U-ORG` → tab **Orders** → approve | Order `paid`, tiket `valid` + QR, email terkirim, ledger bertambah |
| P-06 | Verifikasi reject | Order manual baru → reject dengan alasan | Order `rejected`, kuota tiket dilepas |
| P-07 | Reject tanpa alasan | Kosongkan alasan | Ditolak |
| P-08 | Akses bukti transfer | Buka `http://localhost:8080/v1/uploads/<nama-file>` tanpa login | **Diketahui:** bisa diakses publik (DEV-04) |
| P-09 | Expiry manual | Buat order manual, tunggu > 30 menit | Order `expired` oleh worker, tiket `cancelled` |

> Catatan: nomor rekening di UI masih **hardcoded** BCA `123-456-7890`.

### 8.2 Duitku sandbox

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| P-10 | Buat invoice | Checkout `Early Bird` → Duitku → submit | HTTP 200 berisi `payment_url` Duitku |
| P-11 | Halaman pembayaran | Klik **Proceed to Duitku payment** | Halaman sandbox Duitku terbuka, pilih BCA VA |
| P-12 | Selesaikan pembayaran | Buka `https://sandbox.duitku.com/payment/demo/demosuccesstransaction.aspx`, masukkan nomor VA, submit | Duitku menandai sukses dan memanggil callback |
| P-13 | Callback masuk | Pantau `docker logs -f beo_api` saat P-12 | Tidak ada log error `duitku webhook ...` |
| P-14 | Tiket aktif | Buka `/my-tickets` setelah P-12 | Dalam beberapa detik tiket `valid`, QR muncul, email masuk |
| P-15 | Idempotensi callback | Kirim callback yang sama 2x | Tetap `paid`, tidak ada entri ledger ganda |
| P-16 | Signature salah | Kirim callback dengan signature ngawur | HTTP 401, order tetap `pending` |
| P-17 | Amount tidak cocok | Kirim callback `amount=1000` untuk order 50.000 | Ditolak, order tetap `pending` |
| P-18 | Signature HMAC baru | Kirim callback dengan `HMAC_SHA256(merchantCode+amount+orderId, apiKey)` | HTTP 200, order `paid` |
| P-19 | Signature MD5 lama | Kirim callback dengan `MD5(merchantCode+amount+orderId+apiKey)` | HTTP 200 (kompatibilitas) |
| P-20 | Callback mati | Matikan `cloudflared`, bayar order baru, nyalakan lagi | Order tetap `pending` → **Diketahui:** tidak ada rekonsiliasi otomatis (DEV-05) |
| P-21 | Rekonsiliasi manual | `POST /webapi/api/merchant/transactionStatus` dengan HMAC | `statusCode: "00"` untuk order yang sudah dibayar |
| P-22 | Halaman return palsu | Buka `/orders/return?resultCode=00&merchantOrderId=<order pending>` | **Diketahui:** UI menampilkan "Payment Successful" meski belum lunas (DEV-06) |

Perintah callback manual (P-15…P-19):

```bash
KEY=f08cbb095385bf327638e3945fa9d95d
MC=DS37924
OID=<order-id>
AMT=50000

# HMAC (format baru)
SIG=$(printf '%s%s%s' "$MC" "$AMT" "$OID" | openssl dgst -sha256 -hmac "$KEY" -r | cut -d' ' -f1)

# MD5 (format lama)
# SIG=$(printf '%s%s%s%s' "$MC" "$AMT" "$OID" "$KEY" | md5sum | cut -d' ' -f1)

curl -sS -X POST http://localhost:8080/v1/webhooks/duitku \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "merchantCode=$MC" \
  --data-urlencode "amount=$AMT" \
  --data-urlencode "merchantOrderId=$OID" \
  --data-urlencode "resultCode=00" \
  --data-urlencode "reference=TEST-REF" \
  --data-urlencode "paymentCode=BC" \
  --data-urlencode "signature=$SIG"
```

### 8.3 Ledger & wallet

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| P-23 | Entri ledger | Setelah P-05/P-14, query `ledger_entries` | `ticket_sale_gross` +50000 dan `platform_commission` −1250 (conference 2.5%) |
| P-24 | Saldo wallet | Buka `/organizer/wallet` | Saldo = jumlah entri ledger organizer |
| P-25 | Request payout melebihi saldo | Ajukan payout > saldo | Ditolak |
| P-26 | Request payout valid | Ajukan payout ≤ saldo | Status `pending`, saldo efektif berkurang (`payout_debit`) |

---

## 9. Email, QR & PDF (M)

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| M-01 | Email tiket gratis | Setelah T-04 | Email masuk Mailpit dalam < 30 detik |
| M-02 | Email tiket berbayar | Setelah P-05/P-14 | Email masuk, subjek menyebut nama event |
| M-03 | QR di body email | Buka email di Mailpit | QR tampil inline (bukan gambar rusak) |
| M-04 | Lampiran PDF | Cek lampiran email | PDF ada dan bisa dibuka |
| M-05 | Isi QR sesuai tiket | Bandingkan QR di email dengan `qr_signature` di DB | Cocok (payload `kode\|eventId\|hmac`) |
| M-06 | Link claim di email | Klik link claim pada email | **Diketahui:** mengarah ke `http://localhost:5173/claim?token=...` hardcoded (DEV-07) |
| M-07 | Email tidak terkirim | Matikan container Mailpit lalu checkout | Order tetap `paid` (email gagal tidak menggagalkan transaksi), error hanya di log |
| M-08 | Header injection | Isi nama attendee dengan `Bcc: x@y.z` | Tidak menambah penerima (validasi header) |

---

## 10. Agency, kuota & claim (G)

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| G-01 | Alokasi kuota | `U-ORG` → tab **Agencies** → pilih `U-AGY` + tipe tiket + kuota | Alokasi tersimpan, kuota tipe tiket berkurang |
| G-02 | Alokasi ke akun non-agency | Alokasi ke `buyer1@test.local` | Ditolak (bukan akun agency) |
| G-03 | Top-up alokasi | Alokasi ulang ke agency yang sama | `quota_limit` bertambah kumulatif |
| G-04 | Issue tiket agency | Login `U-AGY` → `/agency` → isi Event ID + Ticket Type ID + attendee | Tiket dibuat, status `valid` |
| G-05 | Issue melebihi kuota | Issue lebih banyak dari `quota_limit` | Ditolak |
| G-06 | Claim token | Ambil `claim_token` tiket dari DB, login sebagai penerima, `/claim` | Tiket masuk `/my-tickets` |
| G-07 | Claim tanpa login | Buka `/claim?token=...` saat logout | Diarahkan login (**Diketahui:** token hilang setelah login, DEV-08) |
| G-08 | Claim tiket pending | Claim token milik tiket `pending` | **Diketahui:** saat ini tetap berhasil (DEV-09) |
| G-09 | Reclaim kuota | Panggil `POST /v1/events/{eventId}/agencies/{agencyId}/reclaim` | Kuota sisa kembali ke tipe tiket |
| G-10 | Email tiket agency | Setelah G-04 | **Diketahui:** tidak ada email/PDF (DEV-10) |
| G-11 | Ledger tiket agency | Setelah G-04 | **Diketahui:** tidak ada entri ledger (order `total_amount=0`) (DEV-10) |

---

## 11. CFP & review (C)

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| C-01 | Submit paper | Login `U-BUY`, buka `/events/{eventId}/cfp`, isi track/title/abstract/file_url | Submission `submitted`, muncul untuk organizer |
| C-02 | Validasi `file_url` | Isi `bukan-url` | Ditolak |
| C-03 | Assign reviewer | `U-ORG` → assign submission ke `rev1@test.local` | Status `under_review`, baris review dibuat |
| C-04 | Review oleh reviewer | Login `U-REV` → isi skor 1–10, komentar, rekomendasi | Review tersimpan |
| C-05 | Review skor di luar rentang | Skor `11` | Ditolak |
| C-06 | Keputusan accepted | `U-ORG` → decision `accepted` | Status `accepted`; T-11 jadi bisa dijalankan |
| C-07 | Keputusan rejected | Decision `rejected` | Status `rejected` |
| C-08 | Review oleh non-reviewer | Login `U-BUY` → coba isi review | Ditolak (tidak ada assignment) |
| C-09 | Deadline CFP | Cari field deadline di UI | **Diketahui:** belum ada (DEV-11) |
| C-10 | Upload file paper | Cari tombol upload | **Diketahui:** hanya URL teks (DEV-11) |
| C-11 | Notifikasi keputusan | Cek Mailpit setelah C-06 | **Diketahui:** tidak ada email keputusan (DEV-11) |

---

## 12. Check-in (K)

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| K-01 | Akses halaman | Login `U-SCAN` → `/events/{eventId}/checkin` | Halaman scanner tampil |
| K-02 | Scan HID | Fokus input, tempel payload `kode\|eventId\|hmac` (dari QR) + Enter | Hasil `success`, tiket `checked_in_at` terisi |
| K-03 | Scan manual | Mode **Manual**, ketik `BEO-XXXXXXXXXXXX` | Hasil `success` (tanpa signature) |
| K-04 | Scan duplikat | Scan tiket yang sama 2x | Kedua ditolak `duplicate`/`already checked in` |
| K-05 | Scan tiket event lain | Payload tiket event B di halaman event A | Hasil `invalid` dengan alasan `wrong_event`, tercatat di `checkin_logs` |
| K-06 | QR dimodifikasi | Ubah 1 karakter signature | Hasil `invalid`, alasan `invalid_signature` |
| K-07 | Tiket belum valid | Scan tiket `pending` | Hasil `invalid` |
| K-08 | Scan webcam | Mode **Webcam**, izinkan kamera, arahkan QR | Hasil `success`; jika kamera tidak tersedia muncul pesan jelas |
| K-09 | Tanpa role check-in | Login `U-BUY`, buka halaman lalu scan | Ditolak 403 dengan pesan terbaca |
| K-10 | Audit check-in sukses | Setelah K-02, cek `audit_events` | **Diketahui:** hanya kegagalan yang dicatat (DEV-12) |
| K-11 | Konsistensi log | Bandingkan `tickets.checked_in_at` dengan `checkin_logs` | **Diketahui:** update tiket & insert log tidak satu transaksi (DEV-12) |

Payload QR untuk uji manual bisa diambil dari DB:

```bash
docker exec beo_postgres psql -U beo -d beo -c \
  "SELECT ticket_code, qr_signature FROM tickets WHERE status='valid' LIMIT 1;"
```

---

## 13. Wallet, payout & admin (W/AD)

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| W-01 | Wallet kosong | Organizer baru buka `/organizer/wallet` | Saldo 0, tidak error |
| W-02 | Riwayat payout | Setelah P-26 | Payout `pending` tampil di daftar |
| W-03 | Payout tanpa login | `GET /v1/organizer/wallet` tanpa token | 401 |
| AD-01 | Overview admin | Login `U-ADM` → `/admin` | Angka users/events/orders/revenue/komisi tampil |
| AD-02 | Daftar event | Tab **Events** | Maksimal 100 event, read-only |
| AD-03 | Daftar user | Tab **Users** | Maksimal 100 user |
| AD-04 | Ubah komisi | Tab **Commissions** → ubah `conference` ke 5% | Tersimpan, transaksi berikutnya pakai rate baru |
| AD-05 | Validasi komisi | Isi `150` atau `-1` | Ditolak |
| AD-06 | Approve payout | Tab **Payouts** → approve | Status `approved` |
| AD-07 | Reject payout | Reject dengan catatan | Status `rejected`, saldo organizer kembali (`payout_debit` dibalik) |
| AD-08 | Complete payout | Complete payout yang sudah approved | Status `paid` (**catatan:** tidak ada transfer bank nyata, DEV-13) |
| AD-09 | Audit log | Tab **Audit** | 100 event terakhir tampil |
| AD-10 | Akses admin oleh non-admin | `U-ORG` buka `/admin` | Ditolak 403 |
| AD-11 | Pagination/filter/export | Cari kontrol halaman di tab admin | **Diketahui:** belum ada (DEV-14) |

---

## 14. Mobile app (B)

Prasyarat: Expo Go **2.32.x** (SDK 52), HP dan laptop di Wi-Fi yang sama, port 8081 diizinkan ufw.

```bash
sudo ufw allow from 10.198.17.0/24 to any port 8081 proto tcp
cd apps/mobile && EXPO_PUBLIC_API_URL=http://10.198.17.58:8080 npx expo start --port 8081 --lan
```

| ID | Skenario | Langkah | Ekspektasi |
|---|---|---|---|
| B-01 | Buka app | Scan QR di Expo Go | App terbuka tanpa layar merah |
| B-02 | Login | Masuk dengan `buyer1@test.local` | Masuk ke tab tiket |
| B-03 | Sesi tersimpan | Tutup app, buka lagi | Tetap login |
| B-04 | Daftar tiket | Tab tiket | Tiket dari `/my-tickets` tampil |
| B-05 | QR offline | Matikan Wi-Fi, buka detail tiket | QR tetap tampil (dari cache) |
| B-06 | Data event offline | Buka detail event, matikan Wi-Fi, buka lagi | Data cache tampil + penanda waktu cache |
| B-07 | Error bukan offline | Buka event yang tidak ada (404) saat online | **Diketahui:** dilabeli "Offline Mode" (DEV-15) |
| B-08 | Cache kedaluwarsa | Ubah data di server, buka app setelah lama | **Diketahui:** tidak ada TTL, data lama tetap dipakai (DEV-15) |
| B-09 | Claim deep link | Buka `beo://claim?token=<token>` | Tab claim terbuka dengan token terisi |
| B-10 | Claim saat logout | Buka deep link claim saat belum login | **Diketahui:** token hilang setelah login (DEV-08) |
| B-11 | Push notification | Buat post dengan `notify_push` untuk event yang tiketnya dimiliki | Notifikasi muncul; tap membuka detail event |
| B-12 | Push produksi | Cek `app.json` untuk `extra.eas.projectId` | **Diketahui:** belum ada, token bisa gagal senyap (DEV-16) |
| B-13 | Logout | Profil → logout | Kembali ke login, cache tiket tidak bisa diakses |
| B-14 | Tiket cancelled | Batalkan order (expired) lalu buka tiket | **Diketahui:** QR tetap tampil untuk tiket `cancelled` (DEV-17) |

---

## 15. Negatif & keamanan (N)

Kasus di bawah menguji perilaku **yang seharusnya**. Beberapa akan FAIL saat ini — itulah tujuannya, agar terlihat jelas.

| ID | Skenario | Langkah | Ekspektasi benar |
|---|---|---|---|
| N-01 | Akses tiket orang lain | Login `U-BUY`, buka `/v1/tickets/<kode-tiket-user-lain>/qr.png` | Ditolak (**saat ini lolos**, DEV-18) |
| N-02 | Bayar order orang lain | `POST /v1/orders/<order-orang-lain>/pay/duitku` tanpa login | Ditolak (**saat ini lolos**, DEV-19) |
| N-03 | Upload bukti ke order orang lain | `POST /v1/orders/<order-orang-lain>/proof-upload` | Ditolak (**saat ini lolos**, DEV-19) |
| N-04 | Baca event draft | Buka `/events/<slug-draft>` tanpa login | 404/Ditolak (**saat ini tampil**, DEV-01) |
| N-05 | Claim tiket tidak valid | Claim token tiket `pending`/`cancelled` | Ditolak (**saat ini lolos**, DEV-09) |
| N-06 | Assign member oleh non-owner | `U-ORG2` (co-organizer) assign member | Ditolak (hanya owner) |
| N-07 | Verifikasi pembayaran event lain | `U-ORG2` verifikasi order event yang bukan miliknya | Ditolak |
| N-08 | Scan event lain | `U-SCAN` scan tiket event yang bukan penugasannya | Ditolak 403 |
| N-09 | Inject SQL | Isi slug `' OR 1=1--` | Tidak error 500, tersimpan sebagai teks/ditolak validasi |
| N-10 | XSS di judul event | Judul `<script>alert(1)</script>` | Tampil sebagai teks, tidak dieksekusi |
| N-11 | Brute force login | 20 login salah beruntun | **Diketahui:** tidak ada rate limit (DEV-20) |
| N-12 | Endpoint admin tanpa token | `GET /v1/admin/overview` | 401 |
| N-13 | Path traversal upload | Nama file `../../etc/passwd` saat upload bukti | Ditolak/di-sanitasi |
| N-14 | Secret default produksi | Jalankan API dengan `APP_ENV=production` tanpa secret | **Diketahui:** tetap jalan dengan secret default (DEV-21) |

---

## 16. Deviasi yang diketahui (jangan dilaporkan sebagai bug baru)

Rujukan lengkap: `docs/status/feature-status.md`.

| Kode | Deviasi | Dampak |
|---|---|---|
| DEV-01 | Detail event by slug/ID tidak memfilter status | Event draft/cancelled bisa dibaca publik |
| DEV-02 | Tidak ada update/publish/cancel/delete event, sesi, post | Event draft tidak bisa diterbitkan lewat UI |
| DEV-03 | Tidak ada detail order, refund, cancel, transfer tiket | Operasional attendee terbatas |
| DEV-04 | Bukti transfer dapat diakses publik | Data pembayaran sensitif terbuka |
| DEV-05 | Tidak ada rekonsiliasi order `pending` | Callback hilang = order menggantung |
| DEV-06 | Halaman return hanya percaya query string | Status sukses palsu |
| DEV-07 | Link claim di email hardcoded `localhost:5173` | Link salah di produksi |
| DEV-08 | Deep link claim hilang saat redirect login | User kehilangan tiket |
| DEV-09 | Claim tidak memvalidasi status tiket | Tiket pending/cancelled bisa diklaim |
| DEV-10 | Tiket agency tanpa email/PDF & ledger | Tiket tidak terkirim, omzet B2B tidak tercatat |
| DEV-11 | CFP tanpa deadline, upload file, notifikasi | Belum siap produksi |
| DEV-12 | Check-in sukses tidak diaudit; log tidak transaksional | Jejak audit tidak lengkap |
| DEV-13 | Payout tanpa disbursement bank | Hanya perubahan status |
| DEV-14 | Admin tanpa pagination/filter/export | Tidak nyaman di data besar |
| DEV-15 | Cache mobile tanpa TTL; error apa pun dilabeli offline | Data basi / misleading |
| DEV-16 | Belum ada EAS projectId & background push | Push produksi bisa gagal senyap |
| DEV-17 | QR tiket cancelled tetap tampil | Kebingungan di venue |
| DEV-18 | QR/PDF tiket publik | Kebocoran tiket |
| DEV-19 | Endpoint bayar/proof tanpa auth & ownership | Penyalahgunaan order |
| DEV-20 | Tidak ada rate limiting | Brute force/spam |
| DEV-21 | Secret dev hardcoded tanpa validasi produksi | Risiko deploy |

---

## 17. Regression otomatis

Jalankan sebelum dan sesudah perubahan kode:

```bash
# Go
cd apps/api && go vet ./... && go test ./...

# Contracts
npm test --workspace=@beo/contracts

# Web
npm test --workspace=@beo/web
npm run build --workspace=@beo/web

# Mobile
npm test --workspace=@beo/mobile
npm run typecheck --workspace=@beo/mobile
```

> Test integrasi Go hanya berjalan bila `TEST_DATABASE_URL` diset.

---

## 18. Lembar sign-off

| Area | Jumlah kasus | PASS | FAIL | BLOCKED | Catatan |
|---|---|---|---|---|---|
| Smoke (S) | 6 | | | | |
| Auth (A) | 13 | | | | |
| Event (E) | 13 | | | | |
| Tiket (T) | 17 | | | | |
| Pembayaran (P) | 26 | | | | |
| Email/QR/PDF (M) | 8 | | | | |
| Agency (G) | 11 | | | | |
| CFP (C) | 11 | | | | |
| Check-in (K) | 11 | | | | |
| Wallet & Admin (W/AD) | 14 | | | | |
| Mobile (B) | 14 | | | | |
| Negatif (N) | 14 | | | | |
| **Total** | **158** | | | | |

**Keputusan rilis:** [ ] Lulus · [ ] Lulus dengan catatan · [ ] Tidak lulus

| Peran | Nama | Tanggal | Tanda tangan |
|---|---|---|---|
| QA | | | |
| Product Owner | | | |

---

## 19. Lampiran

### 19.1 Helper: ambil ID penting

```bash
docker exec beo_postgres psql -U beo -d beo -c \
  "SELECT id, slug, status FROM events ORDER BY created_at DESC LIMIT 5;"

docker exec beo_postgres psql -U beo -d beo -c \
  "SELECT id, name, price, quota, sold_count FROM ticket_types ORDER BY created_at DESC LIMIT 5;"

docker exec beo_postgres psql -U beo -d beo -c \
  "SELECT id, payment_status, payment_method, total_amount FROM orders ORDER BY created_at DESC LIMIT 5;"
```

### 19.2 Helper: verifikasi transaksi

```bash
docker exec beo_postgres psql -U beo -d beo -c "
SELECT o.id, o.payment_status, t.ticket_code, t.status,
       (t.qr_signature <> '') AS has_qr
FROM orders o LEFT JOIN tickets t ON t.order_id = o.id
ORDER BY o.created_at DESC LIMIT 5;"

docker exec beo_postgres psql -U beo -d beo -c "
SELECT entry_type, amount FROM ledger_entries ORDER BY created_at DESC LIMIT 10;"
```

### 19.3 Helper: cek email terakhir

```bash
curl -s http://localhost:8025/api/v1/messages | \
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);(j.messages||[]).slice(0,5).forEach(m=>console.log(m.Subject,'->',m.To.map(t=>t.Address).join(',')))})"
```

### 19.4 Helper: status transaksi Duitku

```bash
KEY=f08cbb095385bf327638e3945fa9d95d
MC=DS37924
OID=<order-id>
SIG=$(printf '%s%s' "$MC" "$OID" | openssl dgst -sha256 -hmac "$KEY" -r | cut -d' ' -f1)

curl -sS -X POST https://sandbox.duitku.com/webapi/api/merchant/transactionStatus \
  -H 'Content-Type: application/json' \
  -d "{\"merchantCode\":\"$MC\",\"merchantOrderId\":\"$OID\",\"signature\":\"$SIG\"}"
```

### 19.5 Helper: login via API (untuk uji cepat)

```bash
TOKEN=$(curl -sS -X POST http://localhost:8080/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"org1@test.local","password":"rahasia123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -sS http://localhost:8080/v1/organizer/events -H "Authorization: Bearer $TOKEN"
```

---

*Test plan ini mengacu pada implementasi kode commit `2ad322c` beserta perbaikan lokal (payment method Duitku, verifikasi HMAC callback, logging webhook). Perbarui bila ada perubahan alur.*