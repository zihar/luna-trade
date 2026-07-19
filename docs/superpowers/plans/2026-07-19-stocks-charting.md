# Stocks (IDX + US) Charting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambah instrumen saham asing (US) & Indonesia (IDX) ke Luna untuk charting & analisa (delay OK, non-tradeable), lewat sumber Yahoo di balik adapter yang bisa ditukar.

**Architecture:** Ikuti pola DXY (`dxy.go`) — sumber non-OANDA diintersep di `candlesHandler`, dikeluarkan dalam bentuk JSON OANDA (`candles[].mid.o/h/l/c`) sehingga FE memperlakukannya identik. Router tipis `resolveSource` menggantikan cabang DXY hard-coded; adapter `StockSource` (impl `yahooSource`) mengambil dari `query1.finance.yahoo.com/v8/finance/chart`. Flag `tradeable:false` menon-aktifkan tiket order untuk saham & DXY.

**Tech Stack:** Go (net/http, encoding/json), `candlecache.go` (cache generik + singleflight), HTML/JS monolitik (`index.html`).

**Spec:** `docs/superpowers/specs/2026-07-19-stocks-charting-design.md`

## Global Constraints

- Teks UI ke pengguna **bahasa Inggris**; komentar kode & commit boleh Indonesian.
- Frontend tanpa unit test → verifikasi manual via browser (`PORT=8765 ./luna-trade`).
- Commit conventional (Indonesian) + trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Bekerja di branch `zihar/zihar/feat/stocks-charting` (sudah dibuat; spek sudah di-commit di sana).
- Namespace simbol saham: prefix **`STOCK:`** (mis. `STOCK:BBCA.JK`, `STOCK:AAPL`).
- Bentuk candle yang di-emit HARUS `{candles:[{time, mid:{o,h,l,c}, volume, complete}]}` (kompatibel OANDA).
- **Jangan** commit `docs/news-followups.md` (modifikasi sesi lain) atau `index.html` bagian yang bukan milik task ini — commit selektif.

---

### Task 1: Router sumber `resolveSource` (refactor cabang DXY)

Ganti percabangan DXY hard-coded di `candlesHandler` dengan router `resolveSource`, sebagai fondasi dispatch stock. Perilaku DXY & OANDA tidak berubah (regression-safe).

**Files:**
- Create: `stocks.go`
- Create: `stocks_test.go`
- Modify: `main.go:201-205` (cabang DXY di `candlesHandler`)

**Interfaces:**
- Produces: `resolveSource(inst string) string` → `"dxy"` | `"stock"` | `"oanda"`

- [ ] **Step 1: Tulis test yang gagal**

Buat `stocks_test.go`:

```go
package main

import "testing"

func TestResolveSource(t *testing.T) {
	cases := map[string]string{
		"DXY":           "dxy",
		"USD_DXY":       "dxy",
		"STOCK:BBCA.JK": "stock",
		"STOCK:AAPL":    "stock",
		"EUR_USD":       "oanda",
		"XAU_USD":       "oanda",
	}
	for inst, want := range cases {
		if got := resolveSource(inst); got != want {
			t.Errorf("resolveSource(%q) = %q, want %q", inst, got, want)
		}
	}
}
```

- [ ] **Step 2: Jalankan test → pastikan GAGAL (compile error)**

Run: `go test ./... -run TestResolveSource`
Expected: FAIL — `undefined: resolveSource`

- [ ] **Step 3: Implementasi minimal di `stocks.go`**

```go
// Package stocks: sumber candle saham (IDX + US) via Yahoo, untuk charting/analisa
// saja (non-tradeable). Mengikuti pola dxy.go: intersep di candlesHandler, emit
// bentuk JSON OANDA. Sumbu live (Finnhub) sengaja TIDAK diimplementasi — cukup
// bar historis; seam TickSource bisa ditambah kelak tanpa mengubah StockSource.
package main

import "strings"

// resolveSource memilih sumber candle berdasar simbol instrumen.
func resolveSource(inst string) string {
	if inst == "DXY" || inst == "USD_DXY" {
		return "dxy"
	}
	if strings.HasPrefix(inst, "STOCK:") {
		return "stock"
	}
	return "oanda"
}
```

- [ ] **Step 4: Jalankan test → PASS**

Run: `go test ./... -run TestResolveSource`
Expected: PASS

- [ ] **Step 5: Pakai `resolveSource` di `main.go`**

Ganti blok `main.go:201-205`:

```go
		// DXY tidak ada di OANDA → dihitung sintetis dari 6 komponen (dxy.go).
		if inst == "DXY" || inst == "USD_DXY" {
			handleDXYCandles(w, token, gran, p)
			return
		}
```

menjadi:

```go
		// Sumber non-OANDA diintersep di sini (lihat stocks.go: resolveSource).
		switch resolveSource(inst) {
		case "dxy":
			handleDXYCandles(w, token, gran, p)
			return
		case "stock":
			handleStockCandles(w, inst, gran, count)
			return
		}
```

Catatan: `handleStockCandles` belum ada → build akan gagal sampai Task 3. Karena itu **Step 5–7 di sini hanya menyiapkan struktur switch dengan cabang `dxy` saja dulu**; tambahkan cabang `stock` di Task 3. Untuk Task 1, tulis switch TANPA cabang `stock`:

```go
		// Sumber non-OANDA diintersep di sini (lihat stocks.go: resolveSource).
		switch resolveSource(inst) {
		case "dxy":
			handleDXYCandles(w, token, gran, p)
			return
		}
```

- [ ] **Step 6: Build & jalankan test penuh → PASS**

Run: `go build ./... && go test ./...`
Expected: build sukses, semua test PASS (DXY masih lewat cabang `dxy`)

- [ ] **Step 7: Commit**

```bash
git add stocks.go stocks_test.go main.go
git commit -m "refactor(candles): router resolveSource menggantikan cabang DXY hard-coded

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Parsing & konversi respons Yahoo (murni, TDD)

Fungsi pure `convertYahoo` + `mapGran` — tanpa jaringan, diuji dengan fixture. Ini seam yang paling penting diuji: harga adjusted, skip bar null, timestamp RFC3339.

**Files:**
- Modify: `stocks.go` (tambah structs + `mapGran` + `convertYahoo`)
- Modify: `stocks_test.go` (tambah test)
- Create: `testdata/yahoo_bbca.json`

**Interfaces:**
- Consumes: `oandaCandles`, `oandaCandle` (dari `dxy.go:75-91`)
- Produces:
  - `mapGran(gran string) (interval, rng string)`
  - `convertYahoo(raw *yahooChartResp, count int) (*oandaCandles, error)`
  - `type yahooChartResp` (struct hasil decode Yahoo)

- [ ] **Step 1: Buat fixture `testdata/yahoo_bbca.json`**

`adjclose` sengaja = ½ `close` (simulasi split) → faktor 0.5. Bar ke-3 `null` (hari non-trading) → harus dilewati.

```json
{"chart":{"result":[{"meta":{"currency":"IDR","symbol":"BBCA.JK"},"timestamp":[1704153600,1704240000,1704326400],"indicators":{"quote":[{"open":[9500,9550,null],"high":[9600,9700,null],"low":[9450,9500,null],"close":[9550,9650,null],"volume":[1000000,1200000,null]}],"adjclose":[{"adjclose":[4775,4825,null]}]}}],"error":null}}
```

- [ ] **Step 2: Tulis test yang gagal**

Tambah ke `stocks_test.go`:

```go
import (
	"encoding/json"
	"os"
	"testing"
)

func TestMapGran(t *testing.T) {
	cases := map[string][2]string{
		"D":   {"1d", "10y"},
		"W":   {"1wk", "max"},
		"MN":  {"1mo", "max"},
		"H1":  {"60m", "730d"},
		"M15": {"15m", "60d"},
		"M5":  {"5m", "60d"},
		"H4":  {"1d", "10y"}, // fallback ke daily
	}
	for gran, want := range cases {
		i, r := mapGran(gran)
		if i != want[0] || r != want[1] {
			t.Errorf("mapGran(%q) = (%q,%q), want (%q,%q)", gran, i, r, want[0], want[1])
		}
	}
}

func TestConvertYahoo_AdjustedSkipNull(t *testing.T) {
	b, err := os.ReadFile("testdata/yahoo_bbca.json")
	if err != nil {
		t.Fatal(err)
	}
	var raw yahooChartResp
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	oc, err := convertYahoo(&raw, 5000)
	if err != nil {
		t.Fatal(err)
	}
	if len(oc.Candles) != 2 { // bar null dilewati
		t.Fatalf("len candles = %d, want 2", len(oc.Candles))
	}
	c0 := oc.Candles[0]
	if c0.Time != "2024-01-02T00:00:00Z" {
		t.Errorf("time = %q, want 2024-01-02T00:00:00Z", c0.Time)
	}
	if c0.Mid.O != "4750" { // 9500 * (4775/9550=0.5)
		t.Errorf("adjusted open = %q, want 4750", c0.Mid.O)
	}
	if c0.Mid.C != "4775" {
		t.Errorf("adjusted close = %q, want 4775", c0.Mid.C)
	}
	if c0.Volume != 1000000 {
		t.Errorf("volume = %d, want 1000000", c0.Volume)
	}
	if !c0.Complete {
		t.Errorf("complete = false, want true")
	}
}
```

- [ ] **Step 3: Jalankan test → GAGAL**

Run: `go test ./... -run 'TestMapGran|TestConvertYahoo'`
Expected: FAIL — `undefined: yahooChartResp` / `mapGran` / `convertYahoo`

- [ ] **Step 4: Implementasi di `stocks.go`**

Tambahkan import & kode (gabungkan import dengan yang sudah ada):

```go
import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// yahooChartResp = subset respons Yahoo v8/finance/chart yang kita pakai.
// Array OHLC/volume/adjclose berisi null pada hari non-trading → pakai pointer
// agar bisa dibedakan dari 0.
type yahooChartResp struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Currency string `json:"currency"`
				Symbol   string `json:"symbol"`
			} `json:"meta"`
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Open   []*float64 `json:"open"`
					High   []*float64 `json:"high"`
					Low    []*float64 `json:"low"`
					Close  []*float64 `json:"close"`
					Volume []*float64 `json:"volume"`
				} `json:"quote"`
				Adjclose []struct {
					Adjclose []*float64 `json:"adjclose"`
				} `json:"adjclose"`
			} `json:"indicators"`
		} `json:"result"`
		Error interface{} `json:"error"`
	} `json:"chart"`
}

// mapGran memetakan granularity FE ke (interval, range) Yahoo. v1 fokus Daily;
// intraday didukung sejauh batas historis Yahoo.
func mapGran(gran string) (interval, rng string) {
	switch gran {
	case "W":
		return "1wk", "max"
	case "M", "MN":
		return "1mo", "max"
	case "H1":
		return "60m", "730d"
	case "M15":
		return "15m", "60d"
	case "M5":
		return "5m", "60d"
	default: // D dan lainnya
		return "1d", "10y"
	}
}

// convertYahoo mengubah respons Yahoo → bentuk oandaCandles. Harga di-adjust
// split/dividen via rasio adjclose/close; bar dengan nilai null dilewati.
func convertYahoo(raw *yahooChartResp, count int) (*oandaCandles, error) {
	if raw == nil || len(raw.Chart.Result) == 0 {
		return nil, fmt.Errorf("yahoo: empty result")
	}
	r := raw.Chart.Result[0]
	if len(r.Indicators.Quote) == 0 {
		return nil, fmt.Errorf("yahoo: no quote series")
	}
	q := r.Indicators.Quote[0]
	var adj []*float64
	if len(r.Indicators.Adjclose) > 0 {
		adj = r.Indicators.Adjclose[0].Adjclose
	}
	out := &oandaCandles{Instrument: r.Meta.Symbol, Candles: make([]oandaCandle, 0, len(r.Timestamp))}
	for i, ts := range r.Timestamp {
		if i >= len(q.Open) || i >= len(q.High) || i >= len(q.Low) || i >= len(q.Close) {
			break
		}
		if q.Open[i] == nil || q.High[i] == nil || q.Low[i] == nil || q.Close[i] == nil {
			continue // hari non-trading
		}
		o, h, l, c := *q.Open[i], *q.High[i], *q.Low[i], *q.Close[i]
		if adj != nil && i < len(adj) && adj[i] != nil && c != 0 {
			f := *adj[i] / c
			o, h, l, c = o*f, h*f, l*f, c*f
		}
		var vol int
		if i < len(q.Volume) && q.Volume[i] != nil {
			vol = int(*q.Volume[i])
		}
		var cd oandaCandle
		cd.Time = time.Unix(ts, 0).UTC().Format(time.RFC3339)
		cd.Mid.O = strconv.FormatFloat(o, 'f', -1, 64)
		cd.Mid.H = strconv.FormatFloat(h, 'f', -1, 64)
		cd.Mid.L = strconv.FormatFloat(l, 'f', -1, 64)
		cd.Mid.C = strconv.FormatFloat(c, 'f', -1, 64)
		cd.Volume = vol
		cd.Complete = true
		out.Candles = append(out.Candles, cd)
	}
	if count > 0 && len(out.Candles) > count {
		out.Candles = out.Candles[len(out.Candles)-count:]
	}
	return out, nil
}
```

Catatan: `resolveSource` sudah pakai `strings`; pastikan blok import digabung tanpa duplikat.

- [ ] **Step 5: Jalankan test → PASS**

Run: `go test ./... -run 'TestMapGran|TestConvertYahoo'`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add stocks.go stocks_test.go testdata/yahoo_bbca.json
git commit -m "feat(stocks): parsing & konversi respons Yahoo → candle OANDA (adjusted)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Adapter Yahoo HTTP + `handleStockCandles` + wiring cache/router

Menyatukan konversi dengan fetch HTTP nyata, cache 5 menit, dan cabang `stock` di router.

**Files:**
- Modify: `stocks.go` (tambah `StockSource`, `yahooSource`, `handleStockCandles`, var `stockSrc`)
- Modify: `main.go` (tambah cabang `case "stock"` di switch Task 1)

**Interfaces:**
- Consumes: `convertYahoo`, `mapGran` (Task 2); `candles` (global `*candleCache`, `main.go:64`); `oandaCandles`
- Produces:
  - `type StockSource interface { Candles(sym, gran string, count int) (*oandaCandles, error) }`
  - `var stockSrc StockSource` (default `yahooSource{}`, seam swappable)
  - `handleStockCandles(w http.ResponseWriter, inst, gran, countStr string)`

- [ ] **Step 1: Implementasi adapter & handler di `stocks.go`**

Tambah import `encoding/json`, `net/http`, `net/url` ke blok import `stocks.go`, lalu:

```go
// StockSource = sumber candle saham (swappable). Kini: yahooSource. Kelak bisa
// diganti stooqSource/twelveSource tanpa menyentuh candlesHandler.
type StockSource interface {
	Candles(sym, gran string, count int) (*oandaCandles, error)
}

var stockSrc StockSource = yahooSource{}

type yahooSource struct{}

func (yahooSource) Candles(sym, gran string, count int) (*oandaCandles, error) {
	interval, rng := mapGran(gran)
	u := "https://query1.finance.yahoo.com/v8/finance/chart/" + url.PathEscape(sym) +
		"?interval=" + interval + "&range=" + rng
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0") // endpoint v8 butuh UA; tanpa cookie/crumb
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo %s → HTTP %d", sym, resp.StatusCode)
	}
	var raw yahooChartResp
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}
	if raw.Chart.Error != nil {
		return nil, fmt.Errorf("yahoo %s: %v", sym, raw.Chart.Error)
	}
	oc, err := convertYahoo(&raw, count)
	if err != nil {
		return nil, err
	}
	oc.Granularity = gran
	return oc, nil
}

// handleStockCandles melayani /api/candles untuk simbol STOCK:*. Hasil di-cache
// 5 menit (data EOD/delayed) → menekan hit ke Yahoo & menghindari rate-limit.
func handleStockCandles(w http.ResponseWriter, inst, gran, countStr string) {
	sym := strings.TrimPrefix(inst, "STOCK:")
	count, _ := strconv.Atoi(countStr)
	if count <= 0 {
		count = 5000
	}
	key := "STOCK:" + sym + "|" + gran + "|" + strconv.Itoa(count)
	loader := func() ([]byte, int, error) {
		oc, err := stockSrc.Candles(sym, gran, count)
		if err != nil {
			return nil, 0, err
		}
		b, err := json.Marshal(oc)
		if err != nil {
			return nil, 0, err
		}
		return b, http.StatusOK, nil
	}
	body, status, err := candles.fetch(key, 5*time.Minute, loader)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}
```

- [ ] **Step 2: Tambah cabang `stock` di router `main.go`**

Ubah switch (dari Task 1) menjadi menyertakan cabang stock:

```go
		// Sumber non-OANDA diintersep di sini (lihat stocks.go: resolveSource).
		switch resolveSource(inst) {
		case "dxy":
			handleDXYCandles(w, token, gran, p)
			return
		case "stock":
			handleStockCandles(w, inst, gran, count)
			return
		}
```

(`count` di sini adalah string dari `main.go:181-184` — cocok dengan signature `handleStockCandles`.)

- [ ] **Step 3: Build & test → PASS**

Run: `go build ./... && go test ./...`
Expected: build sukses, semua test PASS

- [ ] **Step 4: Smoke test adapter terhadap Yahoo live (tanpa server)**

Verifikasi `yahooSource` benar-benar menarik & mengonversi dari Yahoo, lewat satu test manual yang di-skip di CI (butuh jaringan). Tambah sementara ke `stocks_test.go`:

```go
func TestYahooLive_Smoke(t *testing.T) {
	if os.Getenv("YAHOO_LIVE") == "" {
		t.Skip("set YAHOO_LIVE=1 untuk smoke test jaringan")
	}
	oc, err := yahooSource{}.Candles("AAPL", "D", 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(oc.Candles) == 0 {
		t.Fatal("no candles from yahoo")
	}
	t.Logf("AAPL: %d candles, last=%+v", len(oc.Candles), oc.Candles[len(oc.Candles)-1])
}
```

Run: `YAHOO_LIVE=1 go test ./... -run TestYahooLive_Smoke -v`
Expected: PASS, log menampilkan jumlah candle > 0 dengan `Mid.C` numerik.

Setelah lolos, **hapus** `TestYahooLive_Smoke` (agar suite tetap offline/deterministik). Verifikasi end-to-end lewat browser dilakukan di Task 5.

- [ ] **Step 5: Commit**

```bash
git add stocks.go main.go
git commit -m "feat(stocks): adapter Yahoo + handleStockCandles (cache 5mnt) + wiring router

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Validasi server — tolak order instrumen non-tradeable

Defense-in-depth: server menolak `POST /api/order` untuk saham/DXY, walau FE gagal menjaga.

**Files:**
- Modify: `stocks.go` (tambah `isNonTradeable`)
- Modify: `paper.go` (tambah cek di `handlePaperOrder`, setelah `validateOrder`)
- Modify: `stocks_test.go` (test `isNonTradeable`)

**Interfaces:**
- Produces: `isNonTradeable(inst string) bool`

- [ ] **Step 1: Tulis test yang gagal**

Tambah ke `stocks_test.go`:

```go
func TestIsNonTradeable(t *testing.T) {
	cases := map[string]bool{
		"STOCK:AAPL":    true,
		"STOCK:BBCA.JK": true,
		"DXY":           true,
		"USD_DXY":       true,
		"EUR_USD":       false,
		"XAU_USD":       false,
	}
	for inst, want := range cases {
		if got := isNonTradeable(inst); got != want {
			t.Errorf("isNonTradeable(%q) = %v, want %v", inst, got, want)
		}
	}
}
```

- [ ] **Step 2: Jalankan → GAGAL**

Run: `go test ./... -run TestIsNonTradeable`
Expected: FAIL — `undefined: isNonTradeable`

- [ ] **Step 3: Implementasi di `stocks.go`**

```go
// isNonTradeable: instrumen chart-only (saham & DXY sintetis) yang tak boleh
// dieksekusi sebagai order. Dipakai handlePaperOrder (defense-in-depth).
func isNonTradeable(inst string) bool {
	return inst == "DXY" || inst == "USD_DXY" || strings.HasPrefix(inst, "STOCK:")
}
```

- [ ] **Step 4: Pasang cek di `paper.go` `handlePaperOrder`**

Setelah blok `validateOrder` (tepat setelah `req, err := validateOrder(cfg, raw)` + error-check-nya), sebelum cek `req.Type != Market`, sisipkan:

```go
	if isNonTradeable(string(req.Instrument)) {
		writeErr(w, http.StatusBadRequest, "instrument is chart-only and not tradeable")
		return
	}
```

- [ ] **Step 5: Build & test → PASS**

Run: `go build ./... && go test ./...`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add stocks.go paper.go stocks_test.go
git commit -m "feat(stocks): tolak order server-side utk instrumen non-tradeable (saham/DXY)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Frontend — metadata instrumen & grup "Stocks"

Daftarkan simbol saham contoh (1 IDX + 1 US) sebagai template kurasi manual, grup "Stocks" di picker, desimal per-simbol.

**Files:**
- Modify: `index.html:1499` (opsi `<select id="instrument">`)
- Modify: `index.html:5386` (`IPK_GROUPS`)
- Modify: `index.html:5422` (`IPK_META` — tambah 2 simbol)
- Modify: `index.html:5261` (`symDecimals` — override dari `IPK_META.decimals`)

**Interfaces:**
- Consumes: `WATCH_SYMS` (derivасi dari `<option>`), `IPK_META`, `ipkMeta()`, `renderIpick()` (sudah ada)

- [ ] **Step 1: Tambah opsi simbol saham**

Di `index.html`, setelah baris Crypto (`<option>BTC_USD</option>...<option>BCH_USD</option>`), sebelum `</select>` (sekitar `index.html:1499`), tambahkan:

```html
    <!-- Stocks (charting only, non-tradeable) -->
    <option>STOCK:BBCA.JK</option><option>STOCK:AAPL</option>
```

- [ ] **Step 2: Tambah grup "Stocks" ke `IPK_GROUPS`**

Ubah `index.html:5386`:

```js
const IPK_GROUPS = ['Forex','Metals','Energy','Indices','Crypto'];
```

menjadi:

```js
const IPK_GROUPS = ['Forex','Metals','Energy','Indices','Crypto','Stocks'];
```

- [ ] **Step 3: Tambah entri `IPK_META` untuk saham**

Di `index.html`, sebelum baris penutup `};` `IPK_META` (setelah `BCH_USD:...` di `index.html:5421`), tambahkan:

```js
  'STOCK:BBCA.JK':{grp:'Stocks', name:'Bank Central Asia (IDX)', base:'BBCA', quote:'IDR', decimals:0, tradeable:false},
  'STOCK:AAPL':   {grp:'Stocks', name:'Apple Inc. (NASDAQ)',     base:'AAPL', quote:'USD', decimals:2, tradeable:false},
```

- [ ] **Step 4: `symDecimals` — hormati `IPK_META.decimals`**

Ubah `index.html:5261`:

```js
function symDecimals(s){ if(SYM_DECIMALS[s]!=null) return SYM_DECIMALS[s];
```

menjadi (tambah cek `IPK_META` di depan; aman karena hanya dipanggil saat runtime setelah `IPK_META` terdefinisi):

```js
function symDecimals(s){ const im=IPK_META[s]; if(im&&im.decimals!=null) return im.decimals; if(SYM_DECIMALS[s]!=null) return SYM_DECIMALS[s];
```

- [ ] **Step 5: Verifikasi manual di browser**

Jalankan `PORT=8765 ./luna-trade` (build ulang bila perlu: `go build -o luna-trade .`), login, lalu:
- Buka Luna symbol picker → ada grup header **"Stocks"** dengan `BBCA.JK` & `AAPL`.
- Klik `AAPL` → chart memuat candle (Network: `GET /api/candles?instrument=STOCK:AAPL&granularity=D` → `200`, `candles[]` terisi).
- Klik `BBCA.JK` → chart memuat; harga tampil tanpa desimal (IDR, mis. `6475`).
- Console tanpa error JS.

Catat hasil verifikasi (PASS/gagal + gejala) di step ini.

- [ ] **Step 6: Commit (selektif — hanya index.html)**

```bash
git add index.html
git commit -m "feat(stocks): metadata FE — grup Stocks + simbol contoh (BBCA.JK, AAPL)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend — tradeable gating (order panel disable + label) & fix DXY

Non-aktifkan tiket order untuk instrumen non-tradeable (saham + DXY) dengan disable + badge "Chart only". Panel trades bawah (`#bottompanel`) TETAP terlihat (Opsi X).

**Files:**
- Modify: `index.html:5406` (DXY → `tradeable:false`)
- Modify: `index.html:5424` (tambah `isTradeable` + `applyTradeGating` setelah `ipkMeta`)
- Modify: `index.html:5367` (`selectSymbol` → panggil `applyTradeGating()`)
- Modify: `index.html:6534` (boot restore → panggil `applyTradeGating()`)
- Modify: `index.html:1304` (CSS `.orderpanel.notrade`)

**Interfaces:**
- Consumes: `ipkMeta()`, `inst` (global), `$('#orderpanel')`
- Produces: `isTradeable(s)`, `applyTradeGating()`

- [ ] **Step 1: Tandai DXY non-tradeable**

Ubah `index.html:5406`:

```js
  DXY:       {grp:'Indices', name:'US Dollar Index',    base:'DXY'},
```

menjadi:

```js
  DXY:       {grp:'Indices', name:'US Dollar Index',    base:'DXY', tradeable:false},
```

- [ ] **Step 2: Tambah `isTradeable` + `applyTradeGating`**

Setelah fungsi `ipkMeta` (`index.html:5424`, baris yang berakhir `...base:p[0], quote:p[1] }; }`), tambahkan:

```js
// Instrumen non-tradeable (saham, DXY): tiket order dinon-aktifkan (chart-only).
// Panel positions/trades TETAP terlihat (lintas-instrumen).
function isTradeable(s){ return ipkMeta(s).tradeable !== false; }
function applyTradeGating(){ const op=$('#orderpanel'); if(op) op.classList.toggle('notrade', !isTradeable(inst)); }
```

Catatan: gating utama = class `.notrade` di container (CSS `pointer-events:none`) → tahan terhadap re-render `renderOrderPanel()` karena tak bergantung `disabled` per-elemen.

- [ ] **Step 3: Panggil dari `selectSymbol`**

Ubah `index.html:5367` — sisipkan `applyTradeGating();` sebelum `loadInit(true);`:

```js
function selectSymbol(s){ if(s===inst) return; track('symbol',{sym:s}); $('#instrument').value=s; inst=s; guessPip(); renderWatch(); syncIpickTrigger(); updateChartWM(); renderHeaderPrice(); try{drawPaperLines();}catch(e){} applyTradeGating(); loadInit(true);
```

(Jika ada jalur lama `$('#instrument').onchange`, tambahkan `applyTradeGating();` serupa di sana bila perlu — cari `#instrument').onchange`.)

- [ ] **Step 4: Panggil saat boot**

Setelah blok restore order panel (`index.html:6533-6534`, baris `$('#orderpanel').style.display=...; $('#toggleOrder')...`), tambahkan pada baris berikutnya:

```js
  applyTradeGating();
```

- [ ] **Step 5: CSS `.orderpanel.notrade` (disable + badge)**

Setelah `index.html:1304` (`.orderpanel{ border-top:...; }`), tambahkan:

```css
  .orderpanel.notrade{ position:relative; opacity:.55; pointer-events:none; }
  .orderpanel.notrade::before{ content:'Chart only · not tradeable'; position:absolute; top:6px; left:50%; transform:translateX(-50%); z-index:6;
    font:600 11px var(--font-sans, sans-serif); letter-spacing:.03em; white-space:nowrap; pointer-events:none;
    color:var(--muted, #8a94a6); background:var(--panel, #141822); border:1px solid var(--border); border-radius:999px; padding:3px 10px; }
```

- [ ] **Step 6: Verifikasi manual di browser**

Rebuild bila perlu (`go build -o luna-trade .`), `PORT=8765 ./luna-trade`, login:
- Buka order panel (rail toggle order bila tersembunyi).
- Pilih `AAPL` (STOCK) → tiket order **redup + non-klik**, badge **"Chart only · not tradeable"** muncul; tombol Buy/Sell tak bisa diklik.
- Pilih `DXY` → sama (tiket dinon-aktifkan).
- Pilih `EUR_USD` → tiket **kembali normal & bisa diklik**.
- Selama di `AAPL`, panel bawah `#bottompanel` (positions/trades) **tetap terlihat**.
- Console tanpa error JS.

Catat hasil verifikasi di step ini.

- [ ] **Step 7: Commit (selektif)**

```bash
git add index.html
git commit -m "feat(stocks): tradeable-gating tiket order (disable+badge) + DXY chart-only

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verifikasi akhir (end-to-end)

- [ ] `go build ./... && go test ./...` → semua PASS.
- [ ] Browser: grup "Stocks" muncul; `AAPL` & `BBCA.JK` memuat chart (candle Yahoo, adjusted, desimal benar).
- [ ] Tiket order dinon-aktifkan + badge untuk saham & DXY; normal untuk forex; `#bottompanel` tetap terlihat.
- [ ] `POST /api/order` dengan `STOCK:*`/`DXY` ditolak `400` (cek via DevTools bila memungkinkan).
- [ ] Tidak ada error JS di console.

## Cara menambah simbol saham baru (dokumentasi untuk pengguna)

Untuk tiap simbol saham (kurasi manual):
1. Tambah `<option>STOCK:<yahooSymbol></option>` di `<select id="instrument">` (IDX pakai suffix `.JK`, mis. `STOCK:TLKM.JK`; US polos, mis. `STOCK:MSFT`).
2. Tambah entri `IPK_META['STOCK:<yahooSymbol>'] = {grp:'Stocks', name, base, quote, decimals, tradeable:false}` (decimals: `0` untuk IDR, `2` untuk US).

Tak perlu perubahan backend — adapter Yahoo generik untuk simbol apa pun.

---

## Catatan out-of-scope (dari spek)

- Live tick saham (Finnhub / sumbu-2) — seam `TickSource` disisakan, tak diimplementasi.
- Trading/paper untuk saham — ditolak FE (gating) & server (Task 4).
- Pencarian simbol bebas — v1 kurasi manual.
- Historical scroll (`to`/`from`) untuk saham — v1 pakai range Yahoo; scroll jauh di luar scope.
- Obligasi US — sudah dikerjakan di sesi lain (di luar plan ini).
