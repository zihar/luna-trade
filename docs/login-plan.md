# Plan: Multi-user (Auth + Paper Engine) — Luna Trade

## Context
Luna Trade saat ini **single-user** di balik HTTP Basic Auth (satu kredensial bersama).
Tujuan produk: setiap orang bisa **register & login**, lalu otomatis dapat **akun
demo (paper) sendiri** dengan saldo virtual. OANDA **tidak** bisa membuat akun
per-user via API, jadi "demo per user" diwujudkan lewat **paper engine internal**
(simulasi server-side), dengan harga pasar dari **satu token OANDA** milik operator
(read-only, shared). Eksekusi OANDA practice/real per-user (BYO broker) menyusul
sebagai fase berikutnya lewat seam `CredStore` yang sudah ada.

Keputusan terkunci (dari diskusi):
- Auth: **Email+password (bcrypt) DAN Google OAuth** — satu sistem sesi.
- **Tanpa verifikasi email** (v1).
- **Saldo awal paper $10.000** USD per user baru.
- Equity dihitung on-the-fly (balance + Σ unrealized); **write DB hanya saat open/close** (bukan per tick).
- Replay/backtest tetap **client-side ephemeral** (tidak menyentuh saldo paper).

## Fondasi yang sudah ada (dipakai ulang)
- `store.go` — SQLite (modernc, `SetMaxOpenConns(1)`). Skema `journal/fills/account_snapshots/order_audit` **sudah punya kolom `user_id`** (default 'local'). `journal.mode` dukung 'live'/'replay' → tambah 'paper'. `journal` dgn `exit IS NULL` = posisi terbuka.
- `config.go` — `CredStore.For(userID)` seam multi-user (untuk BYO OANDA nanti). `loadConfig()` baca env.
- `main.go` — `basicAuth()` membungkus mux (akan diganti sesi). `store`, `cfg`, `conn`, `hub` global.
- `hub.go` — `hub.last[instrument]` cache tick terakhir per instrumen → dipakai menilai posisi (equity) server-side.
- `api.go` — pola handler, `writeJSON/writeErr`, idempotency `clientTag` (`store.ClaimOrder`/`CompleteOrderAudit`), `validateOrder` (`validate.go`).
- `index.html` — SPA tunggal; `ReplayBroker` (paper client-side saat ini) akan digantikan endpoint server untuk akun live-paper.

## Data model (tabel baru di `store.go` schema)
```sql
users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,          -- NULL untuk user Google-only
  google_sub TEXT UNIQUE,      -- NULL untuk user password-only
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
sessions(
  token TEXT PRIMARY KEY,      -- acak 32-byte hex
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (...),
  expires_at TEXT NOT NULL
);
paper_accounts(
  user_id INTEGER PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'USD',
  balance REAL NOT NULL        -- cash/realized; init 10000 saat register
);
```
- `user_id` di tabel existing dipakai sungguhan (ganti default 'local' → id user terautentikasi, simpan sbg TEXT/INTEGER konsisten).

## Auth — endpoint & alur
File baru `auth.go`:
- `POST /api/auth/register` {email,password,name} → cek email unik, `bcrypt` hash, insert `users` + `paper_accounts(balance=10000)`, buat sesi, set cookie.
- `POST /api/auth/login` {email,password} → verifikasi bcrypt, buat sesi.
- `POST /api/auth/logout` → hapus baris `sessions`, clear cookie.
- `GET /api/auth/me` → {email,name} atau 401.
- Middleware `requireUser(h)` → baca cookie token → lookup `sessions` (cek expiry) → inject `userID` ke `r.Context()`.
- Cookie: `httpOnly; Secure; SameSite=Lax; Path=/`, expiry ~30 hari, token acak (`crypto/rand`).

File baru `oauth_google.go` (std-lib `net/http`, tanpa library berat):
- `GET /api/auth/google` → redirect ke Google (scope `openid email profile`, `state` acak di cookie singkat anti-CSRF).
- `GET /api/auth/google/callback?code=&state=` → verifikasi state → tukar `code`→token di `oauth2.googleapis.com/token` → panggil `https://www.googleapis.com/oauth2/v3/userinfo` → dapat email/name/sub → find-or-create user (by `google_sub` lalu `email`) → buat sesi → redirect ke `/`.
- Env (di `/etc/bar-replay.env`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URL`.

`main.go`:
- Daftar route auth; bungkus `/api/*` (termasuk `/api/candles`, `/api/prices`, `/api/account|positions|order|close|journal`) dengan `requireUser`; **hapus `basicAuth`**.
- Static (`index.html`, `assets/`) tetap publik (shell); data di-gate sesi.
- Hapus syarat basic-auth pada `LiveEnabled` (diganti konteks user).

`config.go`: tambah field Google creds + parse di `loadConfig()`.
`go.mod`: tambah `golang.org/x/crypto` (bcrypt), lalu `go mod vendor`.

## Paper engine per-user (server-side)
File baru `paper.go` (atau perluas `api.go`):
- `GET /api/account` → `balance` dari `paper_accounts` + **equity = balance + Σ unrealized** (posisi terbuka dinilai pakai `hub.last[inst]`; fallback candle bila tick belum ada) + margin used.
- `GET /api/positions` → baris `journal` user `exit IS NULL` (mode='paper') + unrealized live tiap posisi.
- `POST /api/order` → buka paper trade: `validateOrder`, entry = harga Hub (bid utk sell / ask utk buy), tahan margin, insert `journal`(exit NULL) + `fills`; idempotency `clientTag`.
- `POST /api/close` (atau `/api/positions/close`) → realize P&L di harga Hub, **update `paper_accounts.balance` sekali**, set `journal` exit/pnl_ccy/balance_after/exit_time.
- `GET /api/journal` → trade tertutup user.
- Semua keyed `userID` dari context; valuasi & eksekusi server-side (anti-tamper).

## Frontend (`index.html`)
- Saat load → `GET /api/auth/me`; bila 401 tampilkan **overlay Login/Register** (form email+password + tombol "Sign in with Google"). Sukses → init app.
- Badge akun: tampilkan **email + saldo**; tambah tombol **Logout** (`POST /api/auth/logout`).
- Order panel → `POST /api/order` (server paper, dgn UUID `clientTag` per klik + disable tombol saat in-flight); account/positions/journal dari endpoint server (gantikan `ReplayBroker`/localStorage untuk akun live-paper).
- Bar Replay tetap client-side, terpisah dari akun paper.

## Keamanan
- bcrypt (cost ~12) · cookie `httpOnly/Secure/SameSite=Lax` · sesi revocable (tabel `sessions`, cek `expires_at`) · `state` cookie anti-CSRF utk OAuth · **CSRF token** untuk POST order/close (header custom, defense-in-depth di atas SameSite) · rate-limit sederhana login/register per IP (in-memory) · validasi server semua order · jangan kirim `password_hash`/token broker ke klien.

## Prasyarat dari user — setup Google OAuth (langkah rinci)
Dilakukan di **Google Cloud Console** (https://console.cloud.google.com). Agen tak bisa lakukan ini.

1. **Buat / pilih Project**: bar atas → "Select a project" → New Project → nama mis. "Luna Trade" → Create.
2. **OAuth consent screen** (menu: APIs & Services → OAuth consent screen):
   - User Type: **External** → Create.
   - App name: `Luna Trade`; User support email: email-mu; Developer contact: email-mu.
   - **Scopes**: Add → pilih `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (ketiganya **non-sensitive** → TIDAK perlu proses verifikasi Google).
   - Save.
   - **Publishing status**: saat "Testing" hanya **Test users** yang boleh login (tambahkan emailmu di Test users). Untuk buka ke publik → tombol **Publish app** (karena scope non-sensitive, tanpa review).
3. **Credentials** (APIs & Services → Credentials → Create Credentials → **OAuth client ID**):
   - Application type: **Web application**. Name: `Luna Trade Web`.
   - **Authorized redirect URIs** (WAJIB cocok PERSIS dgn `GOOGLE_REDIRECT_URL`, termasuk skema/host/path, tanpa trailing slash):
     - `https://lunatrade.domudame.com/api/auth/google/callback`
     - `http://localhost:8765/api/auth/google/callback` (dev)
   - *Authorized JavaScript origins*: tidak perlu (kita pakai server-side Authorization Code flow, bukan JS SDK).
   - Create → muncul **Client ID** & **Client Secret** → simpan.
4. **Isikan kredensial** (jangan commit):
   - Lokal `.env`:
     ```
     GOOGLE_CLIENT_ID=...apps.googleusercontent.com
     GOOGLE_CLIENT_SECRET=...
     GOOGLE_REDIRECT_URL=http://localhost:8765/api/auth/google/callback
     ```
   - Server `/etc/bar-replay.env` (sama, tapi `GOOGLE_REDIRECT_URL=https://lunatrade.domudame.com/api/auth/google/callback`) lalu `systemctl restart bar-replay`.

Catatan: Client Secret = rahasia (hanya di server, tak pernah ke browser). Email+password tak butuh setup eksternal apa pun.

## Tahapan implementasi
- **2a-i — Email+password** (tanpa dependensi eksternal): tabel users/sessions/paper_accounts, register/login/logout/me, middleware `requireUser`, ganti basic-auth, overlay FE. Bisa dikerjakan & diuji segera.
- **2a-ii — Google OAuth**: setelah Client ID/Secret tersedia.
- **2b — Paper engine server**: paper_accounts + order/close/account/positions/journal pakai harga Hub; wire FE order panel.
- **2c — lanjutan**: equity-curve snapshots (`account_snapshots`, sampling bukan per-tick), connect-OANDA per-user (jalur B via `CredStore`) untuk eksekusi practice → real.

## Verifikasi (end-to-end)
- Build: `go build ./. && go vet ./.`. Server lokal: `PORT=8765 go run .` (dengan `OANDA_TOKEN`/`OANDA_ACCOUNT_ID` di `.env`).
- Auth (CDP/headless Chrome, pola `scratchpad/cdp-*.mjs` yang sudah dipakai sesi ini):
  - register email baru → cek cookie sesi terset, `/api/auth/me` balas user, `paper_accounts.balance=10000` di `luna.db` (`sqlite3`).
  - logout → `/api/auth/me` 401; endpoint data 401.
  - login ulang → akses pulih.
  - Google: klik tombol → consent → callback → user dibuat → sesi aktif (uji setelah creds siap).
- Paper engine: `POST /api/order` (clientTag) → posisi muncul di `/api/positions`, equity di `/api/account` berubah saat harga Hub gerak (tanpa write DB); `POST /api/close` → balance ter-update sekali, journal terisi exit/pnl. Order kembar (clientTag sama) → 409 (idempotency).
- Isolasi multi-user: dua user berbeda → saldo/posisi terpisah (keyed `user_id`).

## Catatan deploy
- Ganti basic-auth → situs jadi publik (gated login); pastikan gate solid sebelum deploy.
- nginx SSE `/api/prices` sudah disiapkan. `luna.db` persist di `/opt/bar-replay/luna.db`.
- go.mod naik versi/`x/crypto` ter-vendor → auto-deploy tetap offline (Go EC2 1.26.3 ≥ go.mod).
