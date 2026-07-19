# Desain: Saham (IDX + US) untuk Charting & Analisa

- **Tanggal:** 2026-07-19
- **Status:** Disetujui (menunggu review spek final)
- **Scope:** Menambah instrumen saham asing (US) & Indonesia (IDX) ke Luna Trade
  **hanya untuk charting & analisa** — bukan trading, delay dapat diterima.

---

## 1. Tujuan & konteks

Luna sekarang hanya punya instrumen dari OANDA (forex, metals, indices CFD, crypto CFD)
plus DXY sintetis. Pengguna ingin menganalisis saham (IDX seperti `BBCA.JK`, `TLKM.JK`;
US seperti `AAPL`, `MSFT`) secara teknikal. Karena tujuannya analisa jangka panjang —
**bukan eksekusi real-time** — data **delayed/EOD sudah cukup**, sehingga kerumitan lisensi
data real-time IDX (mahal) tidak relevan.

### Keputusan sumber data (hasil verifikasi empiris 2026-07-19)

- **Finnhub** — endpoint candle historis sudah **premium** (free key → 403). Gugur untuk
  bar historis.
- **Twelve Data** — IDX (`XIDX`) ada tapi terkunci di tier berbayar **Pro+**; free tier
  hanya US/forex/crypto & delayed.
- **Stooq** — endpoint CSV kini dipasangi **anti-bot proof-of-work (JS SHA-256)**; tidak
  bisa di-fetch headless dari server tanpa menjalankan browser. Gugur untuk backend Go.
- **Yahoo `v8/finance/chart`** — **jalan dari server cukup dengan header User-Agent**
  (tanpa cookie/crumb). Terverifikasi mengembalikan IDX (`BBCA.JK` → currency IDR,
  timezone WIB), US (`AAPL`), dan yield bond (`^TNX`) dari satu endpoint yang sama.

**Pilihan: Yahoo `v8/finance/chart`**, disembunyikan di balik adapter yang bisa ditukar.

**Catatan ketahanan:** Yahoo tak resmi & bisa memperketat kapan saja (rate-limit, crumb).
Risiko diredam dengan (a) caching agresif, (b) daftar simbol terkurasi, dan (c) adapter
interface sehingga sumber bisa ditukar (Stooq/Twelve/EODHD) tanpa menyentuh pipeline chart.

---

## 2. Ringkasan arsitektur

Ikuti pola DXY yang sudah terbukti (`dxy.go`): sumber non-OANDA diintersep di
`candlesHandler`, dikeluarkan dalam **bentuk JSON OANDA** (`candles[].mid.o/h/l/c`) sehingga
frontend memperlakukannya identik dengan instrumen biasa.

### Dua sumbu yang terpisah (penting untuk rencana masa depan)

| Sumbu | Isi | Jalur di kode | Status |
|---|---|---|---|
| **1. Bar historis** | Candle masa lalu (badan chart) | `/api/candles` → `candlesHandler` → `StockSource` | **Dibangun sekarang** (Yahoo) |
| **2. Live tick** | Harga real-time (bar terakhir bergerak) | `/api/prices` SSE → `Hub` → `liveTicks` FE | **Tidak** dibangun; seam disisakan |

Rencana pengguna: kelak real-time saham US via **Finnhub WebSocket** (sumbu 2) dikombinasi
Yahoo untuk historis (sumbu 1). Desain ini **hanya** mengerjakan sumbu 1. Sumbu 2 tidak
disentuh; Hub sudah punya seam injeksi tick non-OANDA (DXY memakainya via `synthDXYTick`,
`hub.go:155`), jadi Finnhub kelak menjadi upstream tick paralel tanpa mengubah `StockSource`.

### Data flow (sumbu 1)

```
FE fetchCandles(inst="STOCK:BBCA.JK", tf="D")
  → GET /api/candles?instrument=STOCK:BBCA.JK&granularity=D&count=...
    → candlesHandler
      → resolveSource(inst) == "stock"            [router tipis baru]
        → handleStockCandles → StockSource.Candles(sym="BBCA.JK", gran="D", count)
          → GET query1.finance.yahoo.com/v8/finance/chart/BBCA.JK?interval=1d&range=...
          → konversi ke oandaCandles (adjusted OHLC)
        → candles cache (TTL ~5 mnt) → writeJSON  → FE render identik
```

---

## 3. Backend

### 3.1 Router sumber (`main.go`)

Ganti cabang DXY hard-coded (`main.go:201`) dengan dispatch bersih:

```go
switch resolveSource(inst) {          // "dxy" | "stock" | "oanda"
case "dxy":   handleDXYCandles(w, token, gran, p);          return
case "stock": handleStockCandles(w, inst, gran, count);      return
}
// ...jalur OANDA existing tak berubah (tetap relay byte mentah)
```

- `resolveSource(inst Instrument) string`:
  - `inst == "DXY" || inst == "USD_DXY"` → `"dxy"`
  - `strings.HasPrefix(string(inst), "STOCK:")` → `"stock"`
  - else → `"oanda"`
- **OANDA & DXY tidak diseragamkan** ke interface (menghindari YAGNI: jalur OANDA yang
  me-relay byte mentah tidak dibongkar jadi parse→struct→serialize).

### 3.2 Namespace simbol

Simbol saham memakai **prefix `STOCK:`** (mis. `STOCK:BBCA.JK`, `STOCK:AAPL`).

- Tidak bentrok dengan format OANDA (`EUR_USD`) atau DXY.
- `handleStockCandles` strip prefix `STOCK:` → kirim simbol Yahoo asli (`BBCA.JK`).
- FE dapat mendeteksi saham dari prefix bila perlu.

### 3.3 Adapter Yahoo (`stocks.go`, file baru mirror `dxy.go`)

```go
type StockSource interface {
    Candles(sym, gran string, count int) (*oandaCandles, error)
}

type yahooSource struct{}
func (yahooSource) Candles(sym, gran string, count int) (*oandaCandles, error) { ... }
```

- **Endpoint:** `GET https://query1.finance.yahoo.com/v8/finance/chart/{sym}` dengan header
  `User-Agent: Mozilla/5.0`, timeout wajar. Non-200 / error → `502` (seperti DXY).
- **Mapping granularity** `mapGran(gran) → (interval, range)`:
  | gran (FE) | Yahoo interval | range default |
  |---|---|---|
  | `D` | `1d` | secukupnya untuk `count` |
  | `W` | `1wk` | — |
  | `MN`/`M` | `1mo` | — |
  | `H1` | `60m` | (delayed, batas historis Yahoo) |
  | `M15` | `15m` | — |
  | `M5` | `5m` | — |
  - Fokus v1: **Daily** (analisa jangka panjang). Intraday didukung sejauh batas Yahoo.
- **Konversi respons** → `oandaCandles` (reuse struct `oandaCandle`/`oandaCandles` dari
  `dxy.go`):
  - `timestamp[i]` (epoch UTC detik) → `time` RFC3339 UTC.
  - `indicators.quote[0].{open,high,low,close}` → `mid.{o,h,l,c}`.
  - **Harga adjusted:** skala tiap OHLC dengan rasio `adjclose[i]/close[i]` (bila
    `adjclose` tersedia) untuk menghilangkan loncatan split/dividen. Bila `adjclose`
    tak ada, pakai raw.
  - `indicators.quote[0].volume[i]` → `volume`.
  - Bar dengan nilai `null` (hari non-trading) dilewati.
  - `complete: true` untuk semua bar historis; bar terakhir yang masih berjalan boleh
    `complete:false` bila relevan (v1: perlakukan semua sebagai complete — tanpa live).

### 3.4 Validasi order server (defense-in-depth)

`handlePaperOrder` menolak instrumen non-tradeable (`STOCK:` prefix atau DXY) dengan `400`.
Ini menjaga walau FE gagal — bukan hanya mengandalkan gating FE.

### 3.5 Caching (`candlecache.go`, reuse generik)

- Request "latest" saham (`to == ""`) lewat `candles.fetch(key, ttl, loader)` dengan
  **TTL ~5 menit** (data EOD/delayed toh tak berubah tiap detik) → menekan frekuensi hit
  ke Yahoo & menghindari rate-limit.
- Key ber-prefix `STOCK:` → tak bentrok. Singleflight bawaan meredam thundering-herd.

### 3.6 Live streaming — TIDAK diubah

Simbol saham **tidak** ditambahkan ke `cfg.StreamInstruments`. Chart tetap jalan tanpa
tick (FE fallback ke quote candle harian, `index.html:5288`). Seam `TickSource` untuk
Finnhub dicatat di komentar `stocks.go` tetapi **tidak diimplementasi**.

---

## 4. Frontend (`index.html`)

### 4.1 Metadata instrumen (kurasi manual, v1)

Untuk tiap simbol saham yang ditambahkan manual, isi:

- `#instrument` `<option>` — daftar simbol (`index.html:1483`), nilai = `STOCK:BBCA.JK`.
- `IPK_META` (`index.html:5387`) — `{ grp:'Stocks', name, base, quote, decimals, tradeable:false }`.
- `IPK_GROUPS` (`index.html:5386`) — tambah `'Stocks'` (dan bisa `'Bonds'` bila perlu kelak).
- Desimal harga: IDR → `0`, US → `2` (disimpan di `IPK_META.decimals`, dipakai
  `symDecimals()` sebagai override sebelum fallback substring).
- **`INSTRUMENT` (pip/quote) tidak wajib** untuk saham karena tak ada konversi P&L
  (non-tradeable). Isi placeholder aman bila diperlukan oleh kode lain.

### 4.2 Tradeable vs non-tradeable

**Konsep baru.** Saat ini belum ada gating; bahkan DXY sintetis bisa "di-Buy/Sell"
(bug laten). Flag `tradeable` memperbaiki keduanya.

- Flag `tradeable:false` di `IPK_META` untuk **tiap saham dan DXY**.
- `ipkMeta()` (fallback, `index.html:5424`) default `tradeable:true`.
- Helper `isTradeable(inst) → ipkMeta(inst).tradeable !== false`.
- `applyTradeGating()` dipanggil dari `selectSymbol()` (`index.html:5367`) **dan saat boot**.

**Perlakuan panel (keputusan final):**

- **Tiket order (`#orderpanel`) — DISABLE + label**, bukan disembunyikan:
  - `pointer-events:none` + opacity redup pada body tiket; tombol Buy/Sell/`execBtn` &
    input `disabled`.
  - Badge kecil di header tiket: **`"Chart only · not tradeable"`**.
  - Alasan: menyembunyikan bikin layout meloncat & user bingung; disable+label menjaga
    konteks dan menjelaskan *kenapa*.
- **Panel positions/trades (`#bottompanel`) — TETAP TERLIHAT (Opsi X).**
  - Panel ini lintas-instrumen (semua posisi terbuka). Menyembunyikannya saat melihat
    chart saham akan menyembunyikan posisi forex yang sedang terbuka — tidak diinginkan.

---

## 5. Testing & verifikasi

- **Go unit test (tanpa jaringan, pakai fixture JSON Yahoo tersimpan):**
  - `yahooSource.Candles` mem-parse fixture → assert bentuk `oandaCandles`, harga adjusted
    benar (rasio `adjclose/close`), timestamp RFC3339, bar `null` terlewati.
  - `mapGran` — mapping granularity benar.
  - `resolveSource` — routing `dxy`/`stock`/`oanda` benar.
- **Manual (browser), sesuai konvensi repo:**
  - `PORT=8765 ./luna-trade`, tambah satu simbol saham kurasi.
  - Buka chart → candle render; grup "Stocks" muncul di picker.
  - Tiket order jadi disabled + badge saat instrumen saham & DXY.
  - `#bottompanel` tetap terlihat (Opsi X).
  - Tak ada error JS di console.

---

## 6. Rencana PR

Satu PR fokus: **"Saham untuk charting (IDX + US) via Yahoo"**
(`zihar/zihar/feat/stocks-charting`).

- Backend: `stocks.go` (adapter Yahoo + `StockSource`), router `resolveSource` di `main.go`,
  validasi order server.
- Frontend: metadata saham, grup `'Stocks'`, tradeable-gating.
- Perbaikan **DXY non-tradeable** menumpang (commit terpisah di PR yang sama).

Sesuai konvensi repo: satu fitur = satu PR, kecil, merge cepat.

---

## 7. Yang sengaja TIDAK dikerjakan (out of scope / YAGNI)

- **Live tick saham (Finnhub / sumbu 2)** — seam `TickSource` disisakan, tak diimplementasi.
- **Trading/paper untuk saham** — tak masuk whitelist; ditolak FE & server.
- **Pencarian simbol bebas** — v1 pakai daftar terkurasi manual.
- **Penyeragaman OANDA/DXY ke interface `CandleSource` + registry** — melanggar YAGNI;
  hanya sumber saham yang di-interface-kan (`StockSource`).
- **Obligasi US (US10Y dst)** — sudah dikerjakan di sesi lain (via OANDA bond CFD native);
  di luar PR ini.
