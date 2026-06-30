# Plan: Persistensi Server-side per User (cloud sync ala TradingView)

> Status: **DITUNDA / backlog** (dicatat 2026-06-30). Belum dikerjakan — referensi saat siap.

## Latar belakang
Saat ini semua state UI/chart disimpan di **localStorage** (lihat daftar key di bawah).
Konsekuensinya terikat per-browser & **per-origin**: `localhost:8765` ≠ produksi
`lunatrade.domudame.com`, device A ≠ device B, hilang saat clear site data / incognito.

TradingView (user login) menyimpan layout/drawing/watchlist **server-side (cloud)**,
tersinkron antar perangkat. Luna sudah punya pondasinya: **multi-user auth** (sesi cookie,
`requireUser` → `userID`) + **SQLite** (`store.go`). Jadi tinggal pindahkan persistensi
ke server, keyed `user_id`.

## State yang ada sekarang (localStorage)
Keys `br_*` di `index.html`:
- **Per-user worth syncing**: `br_draws_<INSTRUMENT>` (gambar per instrumen — `drawsKey()`/
  `serializeDraws()`/`saveDraws()`), `br_chartcfg` (warna candle/border/bg/grid),
  `br_fibLevels` + `br_fibBg`, `br_layout` + `br_sec` (multi-chart), `br_alerts`,
  `br_riskPct`, `br_theme`, `br_tz`, `br_inst`, `br_tf`, `br_tradeTab`.
- **Boleh tetap lokal (UI device-specific)**: `br_marketsW`, `br_tradesH`,
  `br_bottomHidden`, `br_orderHidden`, `br_watchHidden`, `br_magnet`.
- **Jangan dipindah / sudah server**: `br_journal`, `br_balance`, `br_opPos` — paper engine
  & journal sudah dilayani server (`paper.go`/`store.go`); localStorage-nya legacy/cache.

## Desain

### 1. Skema DB (`store.go migrate()`)
Pendekatan **key-value per user** (fleksibel, tak perlu migrasi tiap nambah pref):
```sql
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id    INTEGER NOT NULL,
  k          TEXT    NOT NULL,          -- mis. 'chartcfg','layout','sec','fibLevels','alerts','theme'
  v          TEXT    NOT NULL,          -- JSON string
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, k)
);
CREATE TABLE IF NOT EXISTS user_drawings (
  user_id    INTEGER NOT NULL,
  instrument TEXT    NOT NULL,          -- gambar per-instrumen (ganti br_draws_<inst>)
  v          TEXT    NOT NULL,          -- JSON serializeDraws()
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, instrument)
);
```
Store methods (pola sama spt `PaperBalance`/`OpenPaperTrade`): `GetPref(userID,k)`,
`SetPref(userID,k,v)`, `AllPrefs(userID)`, `GetDrawings(userID,inst)`,
`SetDrawings(userID,inst,v)`.

### 2. Endpoint API (`api.go`, semua `requireUser`)
- `GET  /api/prefs`                      → semua pref user (map k→v) untuk hydrate saat boot.
- `PUT  /api/prefs/{key}`                → simpan satu pref (body = JSON value).
- `GET  /api/drawings?instrument=EUR_USD`→ gambar instrumen tsb.
- `PUT  /api/drawings?instrument=EUR_USD`→ simpan gambar (body = JSON).

`userID` diambil dari sesi (lihat `SessionUser`/`requireUser`). Validasi ukuran body
(mis. cap 256 KB/key) untuk cegah abuse.

### 3. Perubahan Frontend (`index.html`)
- Buat lapisan `prefStore` yang menggantikan akses `localStorage` langsung:
  - **Saat login (bootApp)**: `GET /api/prefs` + `GET /api/drawings` → hydrate state,
    fallback ke localStorage bila offline / belum ada di server.
  - **Saat berubah**: tulis ke server (debounce ~350ms, sama spt `scheduleSaveDraws`) +
    cache ke localStorage (offline cache).
  - `beforeunload` flush (sudah ada untuk draws).
- localStorage tetap dipakai sebagai **cache offline** & untuk key device-specific.

### 4. Migrasi sekali jalan
Saat pertama login pasca-fitur ini: jika server kosong tapi localStorage ada → upload
localStorage → server (one-time import), tandai `migrated` flag di `user_prefs`.

### 5. Strategi sync & konflik
- v1: **last-write-wins** per key (cukup untuk single-user multi-device sekuensial).
- Multi-tab/-device simultan: terima LWW dulu; tambah `updated_at` untuk audit.
- Tanpa realtime sync antar tab di v1 (opsional via SSE nanti).

## Tahapan
1. DB: tabel `user_prefs` + `user_drawings` + store methods.
2. API: 4 endpoint + size guard.
3. FE: `prefStore` layer, hydrate di `bootApp`, ganti read/write `br_*` yg perlu sync.
4. Migrasi one-time dari localStorage.
5. Tes: dua browser/origin → state tersinkron; offline → fallback cache.

## Estimasi
Sedang (~1–2 sesi). Risiko utama: banyak titik baca/tulis `localStorage` di FE harus
dialihkan hati-hati (regresi). Mulai dari subset (chartcfg, layout, drawings) lalu meluas.

## Risiko / catatan
- Jangan pindahkan `br_journal`/`br_balance` (sudah otoritatif di server paper engine).
- Origin produksi vs lokal akan **tetap beda** kalau belum login user yang sama — sync
  hanya berlaku untuk user yang sama yang login di kedua tempat.
- Pertimbangkan privasi: gambar/alert tersimpan di DB server (sudah ada DB user, konsisten).
