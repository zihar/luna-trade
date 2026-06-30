# Copy-Trading Engine: OANDA (master) → FTUK TradeLocker + MT5 Finex (followers)

## Context

User ingin membangun copy-trading: trade dari akun **OANDA pribadi (master)** otomatis di-mirror ke
dua akun follower — **akun prop firm FTUK di TradeLocker** dan **akun MT5 Finex pribadi**. Project
`luna-trade` (Go, monolith stdlib `net/http`, SQLite pure-Go) sudah memiliki interface `Connector`
broker-agnostic, connector OANDA lengkap, `PlaceOrder` + idempotency, dan audit trail — fondasi yang
pas. Yang belum ada: connector follower (TradeLocker, MT5), dan **engine copy** itu sendiri.

### Keputusan yang sudah difinalisasi
- **Master** = OANDA (sudah connect). **Followers** = FTUK TradeLocker + MT5 Finex (fan-out).
- **Sizing = risk-based**: `units_follower = (riskPct × balance_follower) ÷ jarak_SL`, dihitung ulang
  di sisi follower; SL/TP juga di-recompute follower-side (hindari divergensi slippage).
- **FTUK = Instant Funding**: drawdown harian 5% / trailing 6%, **bebas news** (tak perlu news guard).
- **Kunci 1 akun FTUK** (copy ke >1 akun FTUK = pelanggaran/terminasi). Invariant divalidasi saat start.

### Compliance & risiko FTUK (sudah diteliti)
- EA/copy diizinkan FTUK; copy eksternal→FTUK sah. Dilarang keras: HFT, tick-scalp, latency/reverse
  arbitrage, Martingale-via-bot → engine hanya mirror, aman selama strategi master bukan itu.
- Drawdown adalah risiko terbesar → **guard pre-trade wajib** (lihat di bawah). Finex = akun sendiri,
  tanpa rule prop firm.

## Prinsip desain kunci
1. **Sumber kebenaran = `master.Trades()` (per-trade ID), BUKAN `Positions()` (net).** Delta engine
   selalu key pada master trade ID. `Positions()` hanya untuk cross-check rekonsiliasi.
2. **State per-follower** (bukan satu `prev` global): simpan `last_action_seq` per (master_trade, follower)
   agar kegagalan transient satu follower tidak hilang (lost-update).
3. **Idempotency deterministik**: reuse `store.ClaimOrder` (UNIQUE client_tag). Tag =
   `cp:<action>:<masterTradeID>:<follower>:<seq>` → retry/restart menghasilkan tag sama → tak dobel.
4. **Poll master tiap 1–2s** (no-CGO, sederhana). Latency ~1s diserap oleh re-sizing follower-side.
   Upgrade opsional ke OANDA transactions-stream nanti (Phase E).
5. **Fan-out konkuren** per follower (goroutine + ctx timeout sendiri) — follower lambat tak blokir lainnya.

## File baru
- `copyengine.go` — engine struct, poll loop (`time.Ticker`, busy-guard anti-overlap), fungsi diff murni
  (open/decrease/close/modify), orkestrasi fan-out, rekonsiliasi, lifecycle + kill-switch.
- `sizing.go` — `RiskSize(balance, riskPct, slDistance, pipValue)` + rounding ke lot-step follower (pure, unit-tested).
- `instrumentmap.go` — mapping simbol lintas broker (OANDA `EUR_USD` ↔ MT5 `EURUSD` ↔ TL tradableInstrumentId+routeId),
  loader dari `INSTRUMENT_MAP_JSON`/file, `Resolve(canon, follower)`. TL ID di-resolve runtime via TL API saat start.
- `guard.go` — `DrawdownGuard` (daily 5% / trailing 6% + safetyMargin), scheduler baseline 22:00 UTC, pre-trade check + clamp.
- `followers.go` — `FollowerRegistry` + `buildFollower(FollowerConfig)` (switch `tradelocker`/`mt5`); invariant max 1 FTUK prop.
- `tradelocker.go` — `TradeLockerConnector` implement `Connector` (JWT auth+refresh, instrument resolve,
  PlaceOrder/ClosePosition/CloseTrade/Positions/Trades; `PriceStream` boleh "unsupported").
- `mt5.go` — `MT5Connector` sebagai HTTP client ke sidecar Python `MetaTrader5` (definisikan kontrak REST sidecar).
- `copyapi.go` (opsional) — `GET /api/copy/status`, `/api/copy/decisions`, `POST /api/copy/killswitch` (gated).

## Perubahan file existing
- `config.go` — tambah `CopyEnabled`, `CopyKillSwitch`, `CopyDryRun`, `CopyBackfill`, `CopyPollInterval`,
  `Followers []FollowerConfig` (kind, creds, riskPct, drawdown limits, netting, propFirm, enabled).
- `connector.go` — tambah `buildFollower(FollowerConfig)`; `buildConnector` (master OANDA) tetap.
- `store.go` — tambah skema (idempotent `IF NOT EXISTS`) + method, reuse `ClaimOrder`/`CompleteOrderAudit`:
  - `copy_master_state` (snapshot master per trade utk recovery)
  - `copy_map` (master_trade_id+follower → follower order/trade, actual filled units, status, `last_action_seq`; UNIQUE(master_trade_id,follower))
  - `copy_decisions` (audit tiap keputusan: DONE/SKIPPED_*/REJECTED/ERROR/DEDUP)
  - `follower_baseline` (baseline + peak_equity per follower per hari UTC)
  - Method: `UpsertMasterState`, `DeleteMasterState`, `UpsertCopyMap`, `GetCopyMap`, `ListOpenCopyMaps`, `LogDecision`, `Get/SetBaseline`.
- `main.go` — bila `CopyEnabled` (+ `LIVE_TRADING_ENABLED`): build registry → rekonsiliasi → start engine goroutine;
  fail-fast invariant 1-FTUK & instrumen enabled yang tak ter-resolve; register endpoint copy.

## Edge case yang ditangani
- **Restart/RECONCILING**: rebuild state dari broker (bukan cuma DB). Master trade tanpa map row = opened
  saat engine mati → default **tidak open telat** (`SKIPPED_LATE_OPEN`, kecuali `COPY_BACKFILL=1`). Follower
  posisi tanpa master = master sudah close → close sekarang. Seed `prev=current` agar poll pertama tak spurious.
- **Partial close master** → `ActionDecrease`: `follower.CloseTrade(followerTradeID, followerUnits × closedFraction)`.
- **Partial fill follower** → simpan actual `FilledUnits` di `copy_map`; close berikutnya pakai fraksi atas unit aktual.
- **Reject follower** (margin/DD): log `REJECTED`, jangan auto-retry open; untuk **close** reject → retry backoff lalu alert/HALT.
- **Trade baru = trade baru** (OANDA tak menambah unit ke trade lama) → mapping 1:1, hindari scale-in semu.
- **Instrumen tak ter-map** di follower → `SKIPPED_NO_MAPPING`, follower lain jalan.
- **Netting vs hedging**: flag per-follower (`Netting bool`) — asumsi MT5 hedging, TradeLocker netting.
- **Balance berubah**: ambil `AccountSummary().Balance` follower segar tiap open (tak di-cache).

## Guard FTUK (risk-based pre-trade)
Sebelum tiap open/increase ke FTUK: ambil equity → cek `dailyDD = (baseline−equity)/baseline` & trailing;
bila ≥ limit−safetyMargin → `SKIPPED_DD_*`. Proyeksikan worst-case loss trade (units×SL-dist) → clamp risk%
bila perlu. **Close tak pernah diblok.** Baseline equity di-snapshot saat lewat 22:00 UTC (persist; recover saat restart).

## Security gates
- `LIVE_TRADING_ENABLED=1` (existing) tetap menggovern semua eksekusi nyata.
- `COPY_ENGINE_ENABLED=1` master gate engine. `COPY_KILL_SWITCH=1` / `POST /api/copy/killswitch` → HALTED.
- `COPY_DRY_RUN=1` → hitung delta+sizing+guard & log keputusan, **tanpa** call `PlaceOrder`/`Close*` (mode rollout aman).
- Per-follower `enabled` (bawa TradeLocker dulu, MT5 belakangan). Semua endpoint copy di balik basicAuth + requireLive.

## Catatan MT5 (infra tambahan)
MT5 tak punya REST resmi → butuh **sidecar Python (`MetaTrader5`) + terminal MT5 hidup 24/5** (Windows VPS atau
Linux+Wine). `mt5.go` cuma HTTP client ke sidecar. Finex mengizinkan EA/automation tanpa batasan. Ini menambah
satu komponen ops yang harus selalu nyala (di luar binary Go arm64 existing).

## Urutan implementasi (tiap fase shippable)
- **A — Fondasi read-only**: skema+Store; `instrumentmap.go`+config; `sizing.go`+unit test; fungsi diff murni + table-test. Tanpa I/O eksekusi.
- **B — Dry-run engine**: poll loop + rekonsiliasi, fan-out di balik `COPY_DRY_RUN`; log ke `copy_decisions`; jalankan
  vs OANDA master beberapa hari, verifikasi delta cocok dgn trading manual.
- **C — Follower #1 (FTUK)**: `tradelocker.go` read-only dulu (auth, account, resolve instrumen) → verifikasi sizing+guard
  vs balance FTUK riil di dry-run → implement PlaceOrder/Close + `guard.go` → matikan dry-run utk ftuk, risk% kecil, kill-switch siap.
- **D — Follower #2 (MT5)**: kontrak REST sidecar Python + terminal → `mt5.go` → dry-run → enable.
- **E — Hardening (opsional)**: status UI, alert pada close-reject, hybrid OANDA transactions-stream.

## Verifikasi
- **Unit test** (Go): `sizing.go` (risk→units, rounding lot-step) & fungsi diff (`prev`/`cur` table-driven: open/partial-close/full-close/modify/late-open).
- **Dry-run end-to-end**: set `COPY_DRY_RUN=1`, buka/tutup trade kecil di OANDA practice, pastikan baris `copy_decisions`
  muncul dgn action+sizing+guard benar, tanpa eksekusi follower. Periksa `GET /api/copy/decisions`.
- **Follower bertahap**: aktifkan FTUK risk% minimal di akun Instant Funding, lakukan 1 trade, cek posisi muncul di
  TradeLocker dgn ukuran sesuai guard & `copy_map` terisi; uji partial close & full close. Ulangi untuk MT5 setelah sidecar siap.
- **Idempotency**: restart engine saat ada posisi master terbuka → pastikan tak ada order dobel (tag dedup) & rekonsiliasi benar.
- **Build**: cross-compile arm64 no-CGO tetap sukses (semua dependensi pure-Go).

## Critical files (referensi)
- `connector.go` (interface + `buildFollower`), `oanda.go` (master `Trades()` + pola connector),
  `store.go` (skema + `ClaimOrder`), `config.go` (follower config + gates), `main.go` (bootstrap engine), `validate.go` (reuse validasi order).
