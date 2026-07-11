# Price Alerts — Pindah ke Server per-User

## Context
Price alert kini **client-only**: disimpan di `localStorage` (`br_alerts`, `{sym,price}`),
per-browser/device, dievaluasi client-side (`checkAlerts`). Tak sinkron antar-device, hilang
saat clear cache, dan tak jalan kalau browser tutup. Pindahkan ke **server per-user**: satu
sumber kebenaran, dimonitor **server-side terhadap tick live** (meniru SL/TP paper di
`paper_monitor.go`), one-shot. Bar Replay tetap memicu alert **client-side** sebagai simulasi
(non-destruktif — backtest tak boleh mengonsumsi alert live).

Semua per-user via sesi cookie yang sudah ada (`auth.go`: `requireUser` → `userIDFromCtx`).
Backend Go punya test (`*_test.go`) → pakai unit test Go. Frontend `index.html` → manual + syntax.

## Keputusan (disepakati)
- **Storage:** tabel SQLite `price_alerts` per user (`user_id INTEGER`, seperti `paper_accounts`).
- **Monitor:** `alert_monitor.go` — subscribe Hub, cek per-tick **semua instrumen**, fire saat
  harga **melintasi** level, tandai triggered + non-aktif (**one-shot**). Gate via env.
- **Transport notifikasi:** **polling** `GET /api/alerts` (~2s, konsisten pola SL/TP `spSync`).
  Alert triggered → client toast + Web Notification → **ack** (hapus). Tak menyentuh Hub/SSE.
- **Replay:** `checkAlerts` client-side tetap fire (simulasi, intra-bar) **non-destruktif**
  (tak hapus alert server); **live** → server monitor yang fire + one-shot. Client `checkAlerts`
  jadi **replay-only** (di live, server yang tangani → cegah dobel).
- **Directionless:** fire saat tick **melintasi** level (harga sebelumnya vs kini menstraddle).

## Backend

### 1. Schema (`store.go`) — const `alertsSchema`, di-`Exec` dalam `migrate()` (pola `store.go:51-66`)
```sql
CREATE TABLE IF NOT EXISTS price_alerts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  instrument TEXT NOT NULL,
  price REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  triggered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON price_alerts(active);
```
Timestamp = epoch **ms** (`time.Now().UnixMilli()`) — selaras dg client.

### 2. Store CRUD (`store.go`, pola paper `store.go:345-475`)
- `type Alert struct { ID int64; Instrument string; Price float64; Active bool; CreatedAt int64; TriggeredAt *int64 }`
- `type AlertRow struct { UserID, ID int64; Instrument string; Price float64 }` (utk monitor lintas-user)
- `CreateAlert(uid int64, instrument string, price, createdAt int64) (int64, error)` → INSERT, return id.
- `ListAlerts(uid int64) ([]Alert, error)` → SELECT WHERE user_id=? AND (active=1 OR triggered_at IS NOT NULL) ORDER BY created_at.
- `DeleteAlert(uid, id int64) error` → DELETE WHERE id=? AND user_id=? (guard ownership; `RowsAffected==0`→error).
- `AllActiveAlerts() ([]AlertRow, error)` → SELECT user_id,id,instrument,price WHERE active=1 (lintas-user; utk monitor, meniru `AllOpenPaperSLTP` `store.go:411-439`).
- `MarkAlertTriggered(id, triggeredAt int64) error` → UPDATE active=0, triggered_at=? WHERE id=? AND active=1.

### 3. Monitor (`alert_monitor.go` baru, meniru `paper_monitor.go`)
- `startAlertMonitor(store *Store, hub *Hub)`: goroutine tunggal.
  - `ch := hub.Subscribe()` permanen (jaga upstream hidup, seperti paper monitor).
  - `cache []AlertRow` di-refresh `AllActiveAlerts()` tiap 2s (ticker) + setelah ada trigger.
  - `last := map[string]float64{}` — harga (mid) terakhir per instrumen.
  - Per tick `t`: `mid=(t.Bid+t.Ask)/2`; `prev,ok:=last[t.Instrument]`; utk tiap alert cache pd instrumen itu: bila `ok && crossed(prev, mid, a.Price)` → `MarkAlertTriggered(a.ID, now)`, tandai perlu reload. `last[t.Instrument]=mid`.
  - `crossed(a,b,lvl) = (a<lvl && b>=lvl) || (a>lvl && b<=lvl)`. Butuh `prev` (tick sebelumnya per
  instrumen); tick pertama hanya merekam `last` (tak fire). Konsekuensi disengaja: alert yg diset
  **tepat di harga sekarang** baru fire ketika harga bergerak melintasinya (bukan fire instan) —
  hindari fire-langsung yang mengganggu. (Bila kelak mau fire-instan-saat-sudah-di-level, tambah
  cek awal saat create.)
- Gate: `main.go` panggil `startAlertMonitor` bila `cfg.Creds.AccountID != "" && os.Getenv("ALERT_MONITOR") != "0"` (pola `main.go:105-107`).

### 4. API (`api.go` `registerAPI` + handler, semua `requireUser`; pola `paper.go:129-167`)
- `GET  /api/alerts` → `handleAlertsList`: `uid`, `store.ListAlerts(uid)`, `writeJSON(view[])`.
- `POST /api/alerts` → `handleAlertCreate`: `uid`, decode `{instrument string, price float64}` (limit 64KB), validasi (instrument non-kosong, price>0), `CreateAlert(uid,inst,price,now)`, `writeJSON(view)`.
- `POST /api/alerts/delete` → `handleAlertDelete`: `uid`, decode `{id int64}`, `DeleteAlert(uid,id)`, `writeJSON({ok:true})`.
- view JSON: `{id, instrument, price, active, createdAt, triggeredAt}`.

### 5. Test (`alert_monitor_test.go` / `store_test`-style)
- `crossed()` unit: naik-melintas, turun-melintas, tak melintas, sentuh-tepat.
- `checkAlertCross` end-to-end dg store in-memory/temp: create alert, feed ticks straddle → `MarkAlertTriggered` dipanggil sekali (one-shot; tick berikut tak re-fire karena active=0/keluar cache).
- Store CRUD: Create→List→Delete ownership guard (user lain tak bisa hapus).

## Frontend (`index.html`)
- **State**: `alerts=[{id, sym, price, oid}]` (`id`=server id, `oid`=overlay id). Buang `br_alerts`/`saveAlerts`.
- `loadAlerts()` → `await fetch('/api/alerts')` → isi `alerts` (map server→{id,sym:instrument,price}), `renderAlertList()`, `drawAlertLines()`.
- `addAlert()`/`createAlertAt(price)` → `POST /api/alerts {instrument:inst, price}` → sukses: push {id:resp.id,...}, render. (Ganti localStorage.)
- `removeAlert(i)` → `POST /api/alerts/delete {id}` → sukses: splice + hapus overlay + render.
- **Poll** `alertPoll()` interval ~2s, **selalu saat login** (bukan hanya live-paper): `GET /api/alerts`.
  - Sinkron list (tambah/hapus perubahan server).
  - Utk tiap alert dg `triggeredAt` yang **belum ditampilkan** (Set `shownTriggered`): `toast` + Web Notification (`index.html:4950` pola) → lalu `POST /api/alerts/delete {id}` (ack one-shot) + buang dari list.
  - Mulai poll di boot setelah auth (dekat `connectPriceStream`/`spStartPolling`); stop saat logout.
- `checkAlerts(c)` (client-side): **jadikan replay-only** → `if(!replayMode) return;` di awal (live ditangani server, cegah dobel). Di replay: fire **non-destruktif** — toast/Notification tapi **jangan** hapus alert server; dedup via Set `replayFiredAlerts` (id yg sudah bunyi di run ini), dibersihkan saat pick/exit replay. (Pertahankan guard `a.time` intra-bar bila masih relevan; server alert `time=null`.)
- `renderAlertList`/`drawAlertLines`/overlay `alertLine` **dipertahankan** (murni render, sumber data server).
- Alert hanya untuk user login: bila belum login, panel alert kosong (server 401 → skip). (Selaras: fitur trade juga butuh login.)

## Yang TIDAK diubah
Auth/sesi, Hub/SSE harga, SL/TP paper (`paper_monitor.go`), logika replay lain. `checkTrade`/`checkPending` tak disentuh.

## Verifikasi
1. **Go test** (`go test ./...`): `crossed()`, monitor one-shot, store CRUD + ownership.
2. **Manual browser (2 device/2 browser login user sama, butuh OANDA + akun test):**
   - Buat alert di browser A → muncul di browser B (poll).
   - Harga live melintasi level → dalam ~2s: toast+Notification di semua browser online, alert hilang (one-shot), konsisten di DB.
   - Hapus alert di A → hilang di B.
   - Reload → alert tetap ada (server), bukan localStorage.
   - **Replay:** alert bunyi intra-bar (simulasi) TANPA menghapus alert server; keluar replay → alert live masih ada & termonitor.
   - Belum login → panel alert kosong, tak error.
3. Server jalan tanpa browser (monitor tetap men-trigger; terlihat saat browser buka lagi: alert triggered → toast + terhapus).
4. Console bebas error JS.
