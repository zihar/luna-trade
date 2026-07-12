# News Headlines Feed — PR-1 (feed + agregator backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend agregator berita multi-sumber + endpoint `GET /api/news/headlines?instrument=` yang mengembalikan headline relevan-instrumen (v1: sumber Finnhub).

**Architecture:** Layer `Aggregate()` di `internal/news` fan-out konkuren ke sumber `Enabled()`, lalu merge → dedupe (URL kanonik) → sort. Model `Headline` provider-agnostik; relevansi per-instrumen via keyword-map murni. Top-level `headlines.go` menyimpan hasil agregat di cache in-memory (TTL 60s, stale-while-last-good) & menyajikannya via endpoint — mencerminkan pola `news.go` (calendar) yang sudah ada.

**Tech Stack:** Go 1.25 (std-lib only), pola paket `internal/news`, HTTP mux std-lib (`net/http` `mux.HandleFunc("GET /path", ...)`).

## Global Constraints

- **Std-lib only** di `internal/news` (tanpa dependency eksternal), senada `calendar.go`/`classify.go`.
- **Teks yang tampil ke user berbahasa Inggris**; komentar kode & pesan commit boleh Indonesian.
- **Commit conventional (Indonesian)** + trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Satu fitur = satu PR** (branch `zihar/zihar/feat/news-headlines-feed` dari `main`).
- **Degradasi anggun:** nol sumber `Enabled()` → endpoint balas `200 {"disabled":true,...}`; app & calendar tak terpengaruh.
- **Endpoint `requireUser`** (senada `/api/news/calendar`).
- Verifikasi: `go build ./...` + `go test ./...` harus hijau tiap akhir task.

**Setup (sekali, sebelum Task 1):**
```bash
git fetch origin && git checkout -b zihar/zihar/feat/news-headlines-feed origin/main
```

---

### Task 1: Relevance matcher + keyword tables

Filter relevansi per-instrumen (jantung fitur). Fungsi murni, teruji tabel, reuse `RelevantCurrencies` yang sudah ada.

**Files:**
- Create: `internal/news/relevance.go`
- Test: `internal/news/relevance_test.go`

**Interfaces:**
- Consumes: `RelevantCurrencies(symbol string) []string` (dari `calendar.go`).
- Produces:
  - `type Matcher struct { include []string }`
  - `func (m Matcher) Matches(h Headline) bool` — **catatan:** `Headline` didefinisikan di Task 2; di Task 1 tulis `Matches` menerima dua string agar independen: `func (m Matcher) matches(title, summary string) bool`, lalu Task 2 menambah wrapper `Matches(h Headline)`. (Lihat langkah.)
  - `func RelevanceFor(instrument string) Matcher`

- [ ] **Step 1: Tulis test yang gagal**

Buat `internal/news/relevance_test.go`:

```go
package news

import "testing"

func TestRelevanceForGold(t *testing.T) {
	m := RelevanceFor("XAU_USD")
	// gold headline → relevan
	if !m.matches("Gold slips as dollar firms ahead of Fed", "") {
		t.Fatal("gold headline should match XAU_USD")
	}
	// berita crypto → TIDAK relevan utk gold
	if m.matches("Bitcoin surges past resistance", "") {
		t.Fatal("bitcoin headline should NOT match XAU_USD")
	}
}

func TestRelevanceForForexBothSides(t *testing.T) {
	m := RelevanceFor("GBP_USD")
	if !m.matches("Sterling rallies on hot UK CPI", "") {
		t.Fatal("GBP headline should match GBP_USD")
	}
	if !m.matches("Dollar firms after FOMC minutes", "") {
		t.Fatal("USD headline should match GBP_USD")
	}
	if m.matches("Euro dips as ECB holds", "") {
		t.Fatal("EUR-only headline should NOT match GBP_USD")
	}
}

func TestRelevanceForCryptoNoMacroUSD(t *testing.T) {
	m := RelevanceFor("BTC_USD")
	if !m.matches("Bitcoin ETF inflows accelerate", "") {
		t.Fatal("bitcoin headline should match BTC_USD")
	}
	// crypto = aset saja, TIDAK ikut makro USD → "dollar firms" bukan berita BTC
	if m.matches("Dollar firms as yields climb", "") {
		t.Fatal("macro USD headline should NOT match crypto")
	}
}

func TestRelevanceNoShortTokenFalsePositive(t *testing.T) {
	// "download" jangan cocok Dow (US30), "Boeing" jangan cocok BoE (GBP)
	if RelevanceFor("US30_USD").matches("Download the new trading app", "") {
		t.Fatal("'download' must not match Dow (US30)")
	}
	if RelevanceFor("GBP_USD").matches("Boeing shares climb on orders", "") {
		t.Fatal("'Boeing' must not match Bank of England (GBP)")
	}
}
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

Run: `go test ./internal/news/ -run TestRelevance -v`
Expected: FAIL (compile error: `RelevanceFor` / `matches` undefined).

- [ ] **Step 3: Implementasi minimal**

Buat `internal/news/relevance.go`:

```go
package news

import "strings"

// Matcher menentukan apakah sebuah berita relevan untuk instrumen tertentu.
// include = daftar substring lowercase; ADA satu yang cocok di judul+ringkasan → relevan.
type Matcher struct {
	include []string
}

// matches (internal) cek judul+ringkasan tanpa bergantung tipe Headline (Task 2).
func (m Matcher) matches(title, summary string) bool {
	hay := strings.ToLower(title + " " + summary)
	for _, kw := range m.include {
		if kw != "" && strings.Contains(hay, kw) {
			return true
		}
	}
	return false
}

// currencyKeywords = kata kunci berita per mata uang fiat (lowercase). Token pendek
// yang rawan false-positive (mis. "boe"→Boeing, "franc"→France) sengaja dihindari.
var currencyKeywords = map[string][]string{
	"USD": {"dollar", "greenback", "fed", "fomc", "treasury"},
	"EUR": {"euro", "ecb", "eurozone"},
	"GBP": {"pound", "sterling", "bank of england"},
	"JPY": {"yen", "boj", "bank of japan"},
	"CHF": {"swiss franc", "snb"},
	"CAD": {"canadian dollar", "loonie", "bank of canada"},
	"AUD": {"aussie", "australian dollar", "rba"},
	"NZD": {"kiwi", "new zealand dollar", "rbnz"},
}

// assetKeywords = kata kunci berita per aset non-fiat (kode base ala IPK_META).
// Token pendek rawan (mis. "dow"→download, "eth"→method) dihindari.
var assetKeywords = map[string][]string{
	"XAU":   {"gold", "bullion", "xau"},
	"XAG":   {"silver", "xag"},
	"BTC":   {"bitcoin", "btc"},
	"ETH":   {"ethereum", "ether"},
	"LTC":   {"litecoin", "ltc"},
	"BCH":   {"bitcoin cash", "bch"},
	"SPX":   {"s&p 500", "s&p500", "spx"},
	"NAS":   {"nasdaq", "nas100"},
	"DJI":   {"dow jones"},
	"RUT":   {"russell 2000"},
	"DAX":   {"dax", "germany 40"},
	"FTSE":  {"ftse"},
	"CAC":   {"cac 40"},
	"STOXX": {"euro stoxx", "stoxx 50"},
	"NKY":   {"nikkei"},
	"ASX":   {"asx 200", "australia 200"},
	"HSI":   {"hang seng"},
}

// instrumentAssets memetakan simbol instrumen non-forex → kode aset (utk assetKeywords).
// Forex murni tak ada di sini (ditangani RelevantCurrencies).
var instrumentAssets = map[string][]string{
	"XAU_USD": {"XAU"}, "XAG_USD": {"XAG"}, "DXY": {},
	"SPX500_USD": {"SPX"}, "NAS100_USD": {"NAS"}, "US30_USD": {"DJI"}, "US2000_USD": {"RUT"},
	"DE30_EUR": {"DAX"}, "UK100_GBP": {"FTSE"}, "FR40_EUR": {"CAC"}, "EU50_EUR": {"STOXX"},
	"JP225_USD": {"NKY"}, "AU200_AUD": {"ASX"}, "HK33_HKD": {"HSI"},
	"BTC_USD": {"BTC"}, "ETH_USD": {"ETH"}, "LTC_USD": {"LTC"}, "BCH_USD": {"BCH"},
}

// cryptoInstruments = instrumen crypto (relevansi = aset saja, TIDAK ikut makro USD).
var cryptoInstruments = map[string]bool{
	"BTC_USD": true, "ETH_USD": true, "LTC_USD": true, "BCH_USD": true,
}

// RelevanceFor membangun Matcher untuk instrumen (mis. "XAU_USD"):
//   - aset non-fiat (gold/indeks/crypto) → assetKeywords
//   - mata uang fiat relevan (kedua sisi pasangan; metal/DXY → USD) → currencyKeywords,
//     KECUALI crypto (aset saja).
func RelevanceFor(instrument string) Matcher {
	norm := strings.ReplaceAll(strings.ToUpper(strings.TrimSpace(instrument)), "/", "_")
	seen := map[string]bool{}
	var include []string
	add := func(kws []string) {
		for _, kw := range kws {
			if !seen[kw] {
				seen[kw] = true
				include = append(include, kw)
			}
		}
	}
	for _, code := range instrumentAssets[norm] {
		add(assetKeywords[code])
	}
	if !cryptoInstruments[norm] {
		for _, ccy := range RelevantCurrencies(norm) {
			add(currencyKeywords[ccy])
		}
	}
	return Matcher{include: include}
}
```

- [ ] **Step 4: Jalankan test — pastikan lulus**

Run: `go test ./internal/news/ -run TestRelevance -v`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add internal/news/relevance.go internal/news/relevance_test.go
git commit -m "feat(news): relevance matcher headline per-instrumen (keyword-map)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Model Headline + Source + CanonicalURL/DedupeMerge

Fondasi agregator: model provider-agnostik, interface sumber, kanonikalisasi URL, dan dedupe by stable-ID.

**Files:**
- Create: `internal/news/headlines.go`
- Test: `internal/news/headlines_test.go`
- Modify: `internal/news/relevance.go` (tambah wrapper `Matches(Headline)`)

**Interfaces:**
- Consumes: `Matcher.matches(title, summary string) bool` (Task 1).
- Produces:
  - `type Headline struct { ID, Title, Source, Via, URL, Summary string; PublishedAt time.Time }`
  - `type Source interface { Name() string; Enabled() bool; Fetch(client *http.Client) ([]Headline, error) }`
  - `var ErrNoSource error`
  - `func CanonicalURL(raw string) string`
  - `func HeadlineID(rawURL string) string`
  - `func DedupeMerge(in []Headline) []Headline`
  - `func (m Matcher) Matches(h Headline) bool`

- [ ] **Step 1: Tulis test yang gagal**

Buat `internal/news/headlines_test.go`:

```go
package news

import (
	"testing"
)

func TestCanonicalURL(t *testing.T) {
	cases := map[string]string{
		"https://Example.com/a?utm_source=x&id=5#frag": "https://example.com/a?id=5",
		"https://example.com/a/":                       "https://example.com/a",
		"https://example.com/a?gclid=1":                "https://example.com/a",
	}
	for in, want := range cases {
		if got := CanonicalURL(in); got != want {
			t.Errorf("CanonicalURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDedupeMergePrefersSummary(t *testing.T) {
	in := []Headline{
		{URL: "https://ex.com/x?utm_source=a", Title: "T", Summary: ""},
		{URL: "https://ex.com/x", Title: "T", Summary: "detail"},
	}
	out := DedupeMerge(in)
	if len(out) != 1 {
		t.Fatalf("want 1 merged, got %d", len(out))
	}
	if out[0].Summary != "detail" {
		t.Fatalf("merged should keep non-empty summary, got %q", out[0].Summary)
	}
	if out[0].ID == "" {
		t.Fatal("merged headline must have stable ID")
	}
}

func TestMatchesWrapper(t *testing.T) {
	m := RelevanceFor("XAU_USD")
	if !m.Matches(Headline{Title: "Gold hits record", Summary: ""}) {
		t.Fatal("Matches wrapper should delegate to matches()")
	}
}
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

Run: `go test ./internal/news/ -run 'TestCanonicalURL|TestDedupeMerge|TestMatches' -v`
Expected: FAIL (`CanonicalURL`/`DedupeMerge`/`Headline`/`Matches` undefined).

- [ ] **Step 3: Implementasi minimal**

Buat `internal/news/headlines.go`:

```go
// Package news — bagian headline feed (agregasi berita pasar multi-sumber).
// Model Headline provider-agnostik; tiap Source menormalisasi payload-nya sendiri.
// Std-lib only, senada calendar.go. READ-ONLY.
package news

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Headline = satu artikel berita, hasil normalisasi tiap Source.
type Headline struct {
	ID          string    // stable = hash(URL kanonik), konsisten lintas-sumber & poll
	Title       string    // judul
	Source      string    // publisher, mis. "Reuters"
	Via         string    // sumber agregator asal, mis. "finnhub"
	URL         string    // tautan artikel
	Summary     string    // ringkasan (opsional)
	PublishedAt time.Time // waktu terbit (UTC)
}

// Source = satu penyedia berita. Implementasi baru cukup penuhi interface ini
// lalu daftar di registry (headlines.go top-level) — tanpa sentuh Aggregate/relevansi/UI.
type Source interface {
	Name() string                                  // "finnhub" — label log/Via
	Enabled() bool                                 // config/token tersedia?
	Fetch(client *http.Client) ([]Headline, error) // ID & Via sudah terisi
}

// ErrNoSource = tak ada sumber Enabled() → fitur dianggap disabled.
var ErrNoSource = errors.New("news: tak ada sumber aktif")

// CanonicalURL menormalkan URL utk key dedupe & stable ID: skema+host lowercase,
// buang query tracking (utm_*/fbclid/gclid) & fragment, buang trailing slash.
func CanonicalURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return strings.ToLower(strings.TrimSpace(raw))
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	u.Fragment = ""
	q := u.Query()
	for k := range q {
		lk := strings.ToLower(k)
		if strings.HasPrefix(lk, "utm_") || lk == "fbclid" || lk == "gclid" {
			q.Del(k)
		}
	}
	u.RawQuery = q.Encode()
	return strings.TrimSuffix(u.String(), "/")
}

// HeadlineID = hash stabil (16 hex) dari CanonicalURL(raw).
func HeadlineID(rawURL string) string {
	sum := sha1.Sum([]byte(CanonicalURL(rawURL)))
	return hex.EncodeToString(sum[:])[:16]
}

// DedupeMerge menggabung headline ber-ID sama (cerita sama lintas sumber). Menang entry
// ber-Summary non-kosong; bila seri, yang pertama. Urutan input dipertahankan.
func DedupeMerge(in []Headline) []Headline {
	idx := map[string]int{}
	out := make([]Headline, 0, len(in))
	for _, h := range in {
		if h.ID == "" {
			h.ID = HeadlineID(h.URL)
		}
		if i, ok := idx[h.ID]; ok {
			if strings.TrimSpace(out[i].Summary) == "" && strings.TrimSpace(h.Summary) != "" {
				out[i].Summary = h.Summary
			}
			continue
		}
		idx[h.ID] = len(out)
		out = append(out, h)
	}
	return out
}
```

Tambah wrapper di akhir `internal/news/relevance.go`:

```go

// Matches = wrapper publik: relevan bila salah satu keyword muncul di Title+Summary.
func (m Matcher) Matches(h Headline) bool { return m.matches(h.Title, h.Summary) }
```

- [ ] **Step 4: Jalankan test — pastikan lulus**

Run: `go test ./internal/news/ -run 'TestCanonicalURL|TestDedupeMerge|TestMatches' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/news/headlines.go internal/news/headlines_test.go internal/news/relevance.go
git commit -m "feat(news): model Headline + Source + CanonicalURL/DedupeMerge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Aggregate — fan-out konkuren + isolasi kegagalan

Gabung banyak sumber jadi satu feed. Isolasi kegagalan per-sumber, dedupe, sort desc.

**Files:**
- Modify: `internal/news/headlines.go` (tambah `Aggregate`)
- Modify: `internal/news/headlines_test.go` (tambah test + fake source)

**Interfaces:**
- Consumes: `Source`, `Headline`, `DedupeMerge`, `ErrNoSource` (Task 2).
- Produces: `func Aggregate(sources []Source, client *http.Client) (out []Headline, partial bool, err error)`

- [ ] **Step 1: Tulis test yang gagal**

Di `internal/news/headlines_test.go`, **ganti blok import** menjadi (gabungkan dgn `"testing"` yang sudah ada — jangan biarkan dua blok import):

```go
import (
	"errors"
	"net/http"
	"testing"
	"time"
)
```

Lalu tambah fake source + test di akhir file:

```go
// fakeSource = Source palsu utk menguji Aggregate tanpa jaringan.
type fakeSource struct {
	name    string
	enabled bool
	items   []Headline
	err     error
}

func (f fakeSource) Name() string { return f.name }
func (f fakeSource) Enabled() bool { return f.enabled }
func (f fakeSource) Fetch(*http.Client) ([]Headline, error) { return f.items, f.err }

func TestAggregateMergesAndSorts(t *testing.T) {
	t0 := time.Date(2026, 7, 12, 9, 0, 0, 0, time.UTC)
	a := fakeSource{name: "a", enabled: true, items: []Headline{
		{URL: "https://x.com/1", Title: "old", PublishedAt: t0},
		{URL: "https://x.com/2", Title: "new", PublishedAt: t0.Add(time.Hour)},
	}}
	// sumber b memuat duplikat /2 (tanpa summary) + gagal? tidak, sukses.
	b := fakeSource{name: "b", enabled: true, items: []Headline{
		{URL: "https://x.com/2?utm_source=b", Title: "new", PublishedAt: t0.Add(time.Hour)},
	}}
	out, partial, err := Aggregate([]Source{a, b}, nil)
	if err != nil || partial {
		t.Fatalf("want ok non-partial, got err=%v partial=%v", err, partial)
	}
	if len(out) != 2 {
		t.Fatalf("want 2 after dedupe, got %d", len(out))
	}
	if out[0].Title != "new" {
		t.Fatalf("want newest first, got %q", out[0].Title)
	}
}

func TestAggregatePartialOnOneFailure(t *testing.T) {
	ok := fakeSource{name: "ok", enabled: true, items: []Headline{{URL: "https://x.com/1", Title: "t"}}}
	bad := fakeSource{name: "bad", enabled: true, err: errors.New("boom")}
	out, partial, err := Aggregate([]Source{ok, bad}, nil)
	if err != nil {
		t.Fatalf("one failure should not error, got %v", err)
	}
	if !partial {
		t.Fatal("want partial=true when a source fails")
	}
	if len(out) != 1 {
		t.Fatalf("want 1 from surviving source, got %d", len(out))
	}
}

func TestAggregateNoSource(t *testing.T) {
	_, _, err := Aggregate([]Source{fakeSource{name: "off", enabled: false}}, nil)
	if !errors.Is(err, ErrNoSource) {
		t.Fatalf("want ErrNoSource, got %v", err)
	}
}

func TestAggregateAllFail(t *testing.T) {
	bad := fakeSource{name: "bad", enabled: true, err: errors.New("boom")}
	_, _, err := Aggregate([]Source{bad}, nil)
	if err == nil || errors.Is(err, ErrNoSource) {
		t.Fatalf("all-fail should error (not ErrNoSource), got %v", err)
	}
}
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

Run: `go test ./internal/news/ -run TestAggregate -v`
Expected: FAIL (`Aggregate` undefined).

- [ ] **Step 3: Implementasi minimal**

Tambah ke `internal/news/headlines.go` (dan tambah `"fmt"`, `"sort"`, `"sync"` ke import):

```go
// Aggregate fan-out KONKUREN ke semua sumber Enabled(), lalu merge+dedupe+sort desc.
// partial=true bila ≥1 sumber gagal tapi ada yang sukses. err=ErrNoSource bila nol
// Enabled; err lain hanya bila SEMUA sumber Enabled gagal. Panic per-sumber diisolasi.
func Aggregate(sources []Source, client *http.Client) (out []Headline, partial bool, err error) {
	var enabled []Source
	for _, s := range sources {
		if s != nil && s.Enabled() {
			enabled = append(enabled, s)
		}
	}
	if len(enabled) == 0 {
		return nil, false, ErrNoSource
	}

	type res struct {
		hs  []Headline
		err error
	}
	results := make([]res, len(enabled))
	var wg sync.WaitGroup
	for i, s := range enabled {
		wg.Add(1)
		go func(i int, s Source) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					results[i] = res{err: fmt.Errorf("panic sumber %s: %v", s.Name(), r)}
				}
			}()
			hs, e := s.Fetch(client)
			results[i] = res{hs: hs, err: e}
		}(i, s)
	}
	wg.Wait()

	var merged []Headline
	okCount, failCount := 0, 0
	for _, r := range results {
		if r.err != nil {
			failCount++
			continue
		}
		okCount++
		merged = append(merged, r.hs...)
	}
	if okCount == 0 {
		return nil, false, fmt.Errorf("news: semua %d sumber gagal", failCount)
	}
	merged = DedupeMerge(merged)
	sort.SliceStable(merged, func(i, j int) bool {
		return merged[i].PublishedAt.After(merged[j].PublishedAt)
	})
	return merged, failCount > 0, nil
}
```

- [ ] **Step 4: Jalankan test — pastikan lulus**

Run: `go test ./internal/news/ -run TestAggregate -race -v`
Expected: PASS (4 test, tanpa race).

- [ ] **Step 5: Commit**

```bash
git add internal/news/headlines.go internal/news/headlines_test.go
git commit -m "feat(news): Aggregate fan-out konkuren + isolasi kegagalan + dedupe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Sumber Finnhub (Normalize + Enabled + Fetch)

Implementasi `Source` #1. `NormalizeFinnhub` murni (teruji tanpa jaringan); `Fetch` menarik 3 kategori.

**Files:**
- Create: `internal/news/finnhub.go`
- Test: `internal/news/finnhub_test.go`

**Interfaces:**
- Consumes: `Headline`, `HeadlineID`, `DedupeMerge`, `snippet` (dari `calendar.go`).
- Produces:
  - `type Finnhub struct { Token string; Categories []string }`
  - `func (Finnhub) Name() string`, `func (f Finnhub) Enabled() bool`, `func (f Finnhub) Fetch(*http.Client) ([]Headline, error)`
  - `func NormalizeFinnhub(body []byte) ([]Headline, error)`

- [ ] **Step 1: Tulis test yang gagal**

Buat `internal/news/finnhub_test.go`:

```go
package news

import "testing"

func TestNormalizeFinnhub(t *testing.T) {
	body := []byte(`[
		{"category":"general","datetime":1752310800,"headline":"Gold slips as dollar firms","id":1,"source":"Reuters","summary":"s","url":"https://r.com/a"},
		{"category":"forex","datetime":1752314400,"headline":"","id":2,"source":"X","summary":"","url":"https://r.com/b"},
		{"category":"forex","datetime":1752314400,"headline":"No URL","id":3,"source":"X","summary":"","url":""}
	]`)
	hs, err := NormalizeFinnhub(body)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	// item ke-2 (headline kosong) & ke-3 (url kosong) di-skip → sisa 1
	if len(hs) != 1 {
		t.Fatalf("want 1 valid headline, got %d", len(hs))
	}
	h := hs[0]
	if h.Title != "Gold slips as dollar firms" || h.Source != "Reuters" || h.Via != "finnhub" {
		t.Fatalf("bad normalize: %+v", h)
	}
	if h.ID == "" || h.PublishedAt.IsZero() {
		t.Fatalf("ID & PublishedAt must be set: %+v", h)
	}
}

func TestNormalizeFinnhubBadJSON(t *testing.T) {
	if _, err := NormalizeFinnhub([]byte("{not json")); err == nil {
		t.Fatal("want error on invalid JSON")
	}
}

func TestFinnhubEnabled(t *testing.T) {
	if (Finnhub{Token: ""}).Enabled() {
		t.Fatal("empty token → disabled")
	}
	if !(Finnhub{Token: "x"}).Enabled() {
		t.Fatal("non-empty token → enabled")
	}
	if (Finnhub{Token: "x"}).Name() != "finnhub" {
		t.Fatal("name should be finnhub")
	}
}
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

Run: `go test ./internal/news/ -run 'TestNormalizeFinnhub|TestFinnhubEnabled' -v`
Expected: FAIL (`NormalizeFinnhub`/`Finnhub` undefined).

- [ ] **Step 3: Implementasi minimal**

Buat `internal/news/finnhub.go`:

```go
// Sumber berita Finnhub (market news kategori general/forex/crypto). Gratis,
// rate 60 call/menit. Std-lib only. Impl interface Source.
package news

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

const finnhubNewsURL = "https://finnhub.io/api/v1/news"

// Finnhub = Source berbasis Finnhub market news.
type Finnhub struct {
	Token      string
	Categories []string // kosong → default {"general","forex","crypto"}
}

func (Finnhub) Name() string    { return "finnhub" }
func (f Finnhub) Enabled() bool { return strings.TrimSpace(f.Token) != "" }

type finnhubRaw struct {
	Datetime int64  `json:"datetime"`
	Headline string `json:"headline"`
	Source   string `json:"source"`
	Summary  string `json:"summary"`
	URL      string `json:"url"`
}

// NormalizeFinnhub mem-parse body JSON 1 kategori → []Headline (ID hash-URL, Via="finnhub").
// Item tanpa judul/URL di-skip. Error hanya bila JSON tak valid.
func NormalizeFinnhub(body []byte) ([]Headline, error) {
	var raw []finnhubRaw
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse finnhub JSON: %w (snippet: %s)", err, snippet(body))
	}
	out := make([]Headline, 0, len(raw))
	for _, r := range raw {
		title := strings.TrimSpace(r.Headline)
		u := strings.TrimSpace(r.URL)
		if title == "" || u == "" {
			continue
		}
		out = append(out, Headline{
			ID:          HeadlineID(u),
			Title:       title,
			Source:      strings.TrimSpace(r.Source),
			Via:         "finnhub",
			URL:         u,
			Summary:     strings.TrimSpace(r.Summary),
			PublishedAt: time.Unix(r.Datetime, 0).UTC(),
		})
	}
	return out, nil
}

// fetchFinnhubCategory menarik 1 kategori (raw body). client nil = default 20s.
func fetchFinnhubCategory(client *http.Client, token, category string) ([]byte, error) {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	req, err := http.NewRequest(http.MethodGet, finnhubNewsURL, nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("category", category)
	q.Set("token", token)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("finnhub HTTP %d: %s", resp.StatusCode, snippet(body))
	}
	return body, nil
}

// Fetch menarik semua kategori, normalisasi, dedup lintas-kategori by ID, sort desc.
// Sukses bila ≥1 kategori berhasil.
func (f Finnhub) Fetch(client *http.Client) ([]Headline, error) {
	cats := f.Categories
	if len(cats) == 0 {
		cats = []string{"general", "forex", "crypto"}
	}
	var all []Headline
	var lastErr error
	ok := 0
	for _, c := range cats {
		body, err := fetchFinnhubCategory(client, f.Token, c)
		if err != nil {
			lastErr = err
			continue
		}
		hs, err := NormalizeFinnhub(body)
		if err != nil {
			lastErr = err
			continue
		}
		ok++
		all = append(all, hs...)
	}
	if ok == 0 {
		return nil, fmt.Errorf("finnhub: semua kategori gagal: %w", lastErr)
	}
	all = DedupeMerge(all)
	sort.SliceStable(all, func(i, j int) bool { return all[i].PublishedAt.After(all[j].PublishedAt) })
	return all, nil
}
```

- [ ] **Step 4: Jalankan test — pastikan lulus**

Run: `go test ./internal/news/ -v`
Expected: PASS (semua test paket news, termasuk Task 1–3).

- [ ] **Step 5: Commit**

```bash
git add internal/news/finnhub.go internal/news/finnhub_test.go
git commit -m "feat(news): sumber Finnhub (normalize + fetch 3 kategori)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: buildHeadlinesResponse (filter relevansi + cap, fungsi murni)

Bentuk respons JSON: filter headline agregat ke instrumen, urut desc, cap 30. Murni → teruji tanpa jaringan.

**Files:**
- Create: `headlines.go` (top-level, package `main`) — bagian tipe response + `buildHeadlinesResponse`
- Test: `headlines_test.go` (top-level)

**Interfaces:**
- Consumes: `news.Headline`, `news.RelevanceFor` (paket internal/news).
- Produces:
  - `type hlItem struct {...}` / `type hlResponse struct {...}` (lihat kode)
  - `func buildHeadlinesResponse(items []news.Headline, instrument string, partial bool, fetchedAt time.Time, stale bool) hlResponse`
  - `const hlMaxItems = 30`

- [ ] **Step 1: Tulis test yang gagal**

Buat `headlines_test.go`:

```go
package main

import (
	"testing"
	"time"

	"luna-trade/internal/news"
)

func TestBuildHeadlinesResponseFilters(t *testing.T) {
	now := time.Date(2026, 7, 12, 9, 0, 0, 0, time.UTC)
	items := []news.Headline{
		{ID: "1", Title: "Gold slips as dollar firms", URL: "https://x/1", PublishedAt: now},
		{ID: "2", Title: "Bitcoin surges past resistance", URL: "https://x/2", PublishedAt: now.Add(time.Hour)},
	}
	resp := buildHeadlinesResponse(items, "XAU_USD", false, now, false)
	if resp.Instrument != "XAU_USD" || resp.Disabled {
		t.Fatalf("bad meta: %+v", resp)
	}
	if len(resp.Headlines) != 1 {
		t.Fatalf("want 1 gold-relevant headline, got %d", len(resp.Headlines))
	}
	if resp.Headlines[0].ID != "1" {
		t.Fatalf("want the gold headline, got %+v", resp.Headlines[0])
	}
}

func TestBuildHeadlinesResponseCaps(t *testing.T) {
	now := time.Date(2026, 7, 12, 9, 0, 0, 0, time.UTC)
	var items []news.Headline
	for i := 0; i < hlMaxItems+10; i++ {
		items = append(items, news.Headline{ID: string(rune('a' + i%26)), Title: "Gold up", URL: "https://x", PublishedAt: now})
	}
	resp := buildHeadlinesResponse(items, "XAU_USD", true, now, false)
	if len(resp.Headlines) != hlMaxItems {
		t.Fatalf("want cap %d, got %d", hlMaxItems, len(resp.Headlines))
	}
	if !resp.Partial {
		t.Fatal("partial flag should propagate")
	}
}
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

Run: `go test . -run TestBuildHeadlines -v`
Expected: FAIL (`buildHeadlinesResponse`/`hlMaxItems` undefined).

- [ ] **Step 3: Implementasi minimal**

Buat `headlines.go` (top-level):

```go
// Endpoint headline feed: agregasi berita multi-sumber (lihat internal/news) + cache
// in-memory (TTL 60s, stale-while-last-good) + filter relevansi per-instrumen.
// Pola mencerminkan news.go (calendar). READ-ONLY.
package main

import (
	"time"

	"luna-trade/internal/news"
)

const hlMaxItems = 30

// ---- bentuk response JSON ----

type hlItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Source      string `json:"source"`
	URL         string `json:"url"`
	Summary     string `json:"summary"`
	PublishedAt string `json:"publishedAt"`
}

type hlResponse struct {
	Disabled   bool     `json:"disabled"`
	Stale      bool     `json:"stale"`
	Partial    bool     `json:"partial"`
	FetchedAt  string   `json:"fetchedAt"`
	Instrument string   `json:"instrument"`
	Headlines  []hlItem `json:"headlines"`
}

// buildHeadlinesResponse = fungsi murni: filter relevansi instrumen + cap. items
// diasumsikan sudah terurut desc oleh Aggregate.
func buildHeadlinesResponse(items []news.Headline, instrument string, partial bool, fetchedAt time.Time, stale bool) hlResponse {
	m := news.RelevanceFor(instrument)
	out := make([]hlItem, 0, hlMaxItems)
	for _, h := range items {
		if !m.Matches(h) {
			continue
		}
		out = append(out, hlItem{
			ID:          h.ID,
			Title:       h.Title,
			Source:      h.Source,
			URL:         h.URL,
			Summary:     h.Summary,
			PublishedAt: h.PublishedAt.Format(time.RFC3339),
		})
		if len(out) >= hlMaxItems {
			break
		}
	}
	return hlResponse{
		Stale:      stale,
		Partial:    partial,
		FetchedAt:  fetchedAt.Format(time.RFC3339),
		Instrument: instrument,
		Headlines:  out,
	}
}
```

- [ ] **Step 4: Jalankan test — pastikan lulus**

Run: `go test . -run TestBuildHeadlines -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add headlines.go headlines_test.go
git commit -m "feat(news): buildHeadlinesResponse filter relevansi + cap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: hlCache + registry sumber (cache TTL, stale, disabled)

Cache agregat in-memory (TTL 60s, stale-while-last-good) + registry sumber. Fetch injectable → teruji tanpa jaringan (cermin `TestNewsCacheStaleFallback`).

**Files:**
- Modify: `headlines.go` (tambah `hlTTL`, `hlSources`, `hlCache`, `headlineCache`, `(*hlCache).get`)
- Modify: `headlines_test.go` (tambah test cache)

**Interfaces:**
- Consumes: `news.Aggregate`, `news.ErrNoSource`, `news.Headline`.
- Produces:
  - `const hlTTL = 60 * time.Second`
  - `func hlSources() []news.Source`
  - `type hlCache struct {...}` + `var headlineCache *hlCache`
  - `func (c *hlCache) get(now time.Time) (items []news.Headline, partial bool, fetchedAt time.Time, stale bool, err error)`

- [ ] **Step 1: Tulis test yang gagal**

Tambah ke `headlines_test.go` (dan tambah `"errors"` ke import):

```go
func TestHeadlineCacheStaleFallback(t *testing.T) {
	now := time.Date(2026, 7, 12, 9, 0, 0, 0, time.UTC)
	calls := 0
	c := &hlCache{fetch: func() ([]news.Headline, bool, error) {
		calls++
		if calls == 1 {
			return []news.Headline{{ID: "1", Title: "Gold up", URL: "https://x/1", PublishedAt: now}}, false, nil
		}
		return nil, false, errors.New("boom")
	}}
	// 1st: live ok
	items, _, _, stale, err := c.get(now)
	if err != nil || stale || len(items) == 0 {
		t.Fatalf("first get should be live ok, err=%v stale=%v n=%d", err, stale, len(items))
	}
	// within TTL: no refetch
	if _, _, _, _, _ = c.get(now.Add(30 * time.Second)); calls != 1 {
		t.Fatalf("within TTL should not refetch, calls=%d", calls)
	}
	// after TTL: refetch fails → serve stale last-good
	items, _, _, stale, err = c.get(now.Add(2 * time.Minute))
	if err != nil || !stale || len(items) == 0 {
		t.Fatalf("after TTL fail should serve stale, err=%v stale=%v", err, stale)
	}
}

func TestHeadlineCacheDisabled(t *testing.T) {
	now := time.Date(2026, 7, 12, 9, 0, 0, 0, time.UTC)
	c := &hlCache{fetch: func() ([]news.Headline, bool, error) {
		return nil, false, news.ErrNoSource
	}}
	if _, _, _, _, err := c.get(now); !errors.Is(err, news.ErrNoSource) {
		t.Fatalf("want ErrNoSource passthrough, got %v", err)
	}
}
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

Run: `go test . -run TestHeadlineCache -v`
Expected: FAIL (`hlCache` undefined).

- [ ] **Step 3: Implementasi minimal**

Tambah ke `headlines.go` (tambah `"os"`, `"sync"` ke import — `net/http` belum diperlukan di sini, baru di Task 7):

```go
const hlTTL = 60 * time.Second

// hlSources = registry sumber berita. Tambah sumber baru = tambah satu baris di sini.
func hlSources() []news.Source {
	return []news.Source{
		news.Finnhub{Token: os.Getenv("FINNHUB_TOKEN")},
		// news.RSS{...},        // nanti (zero-key)
		// news.Marketaux{...},  // nanti (butuh key)
	}
}

// hlCache = cache in-memory hasil agregat. fetch injectable utk test.
type hlCache struct {
	mu        sync.Mutex
	items     []news.Headline
	partial   bool
	fetchedAt time.Time
	ok        bool
	fetch     func() ([]news.Headline, bool, error)
}

var headlineCache = &hlCache{fetch: func() ([]news.Headline, bool, error) {
	return news.Aggregate(hlSources(), nil)
}}

// get mengembalikan headline agregat; refetch bila TTL lewat. stale=true bila menyajikan
// last-good karena refetch gagal. err (mis. ErrNoSource) hanya bila belum pernah sukses.
func (c *hlCache) get(now time.Time) (items []news.Headline, partial bool, fetchedAt time.Time, stale bool, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ok && now.Sub(c.fetchedAt) < hlTTL {
		return c.items, c.partial, c.fetchedAt, false, nil
	}
	fresh, freshPartial, ferr := c.fetch()
	if ferr != nil {
		if c.ok {
			return c.items, c.partial, c.fetchedAt, true, nil // last-good (basi)
		}
		return nil, false, time.Time{}, false, ferr
	}
	c.items, c.partial, c.fetchedAt, c.ok = fresh, freshPartial, now, true
	return c.items, c.partial, c.fetchedAt, false, nil
}
```

- [ ] **Step 4: Jalankan test — pastikan lulus**

Run: `go test . -run TestHeadlineCache -race -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add headlines.go headlines_test.go
git commit -m "feat(news): hlCache agregat (TTL 60s, stale-while-last-good) + registry sumber

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Handler + route + env + README + verifikasi end-to-end

Sambungkan endpoint ke mux, dokumentasikan env, verifikasi build + curl (disabled tanpa token; jika token tersedia, cek relevansi nyata).

**Files:**
- Modify: `headlines.go` (tambah `handleNewsHeadlines`)
- Modify: `api.go:32` (daftar route, setelah baris calendar)
- Modify: `.env.example` (tambah `FINNHUB_TOKEN=`)
- Modify: `README.md` (dokumentasi env)

**Interfaces:**
- Consumes: `headlineCache.get`, `buildHeadlinesResponse`, `writeJSON`, `writeErr`, `requireUser`, `news.ErrNoSource`.
- Produces: `func handleNewsHeadlines(w http.ResponseWriter, r *http.Request)`

- [ ] **Step 1: Tambah handler**

Tambah ke `headlines.go` (import `"errors"` sudah ada? tambah bila belum; butuh juga `"strings"`):

```go
// handleNewsHeadlines melayani GET /api/news/headlines?instrument=XAU_USD.
func handleNewsHeadlines(w http.ResponseWriter, r *http.Request) {
	instrument := strings.TrimSpace(r.URL.Query().Get("instrument"))
	if instrument == "" {
		instrument = "XAU_USD"
	}
	now := time.Now().UTC()
	items, partial, fetchedAt, stale, err := headlineCache.get(now)
	if err != nil {
		if errors.Is(err, news.ErrNoSource) {
			writeJSON(w, http.StatusOK, hlResponse{Disabled: true, Instrument: instrument, Headlines: []hlItem{}})
			return
		}
		writeErr(w, http.StatusServiceUnavailable, "Headlines unavailable")
		return
	}
	writeJSON(w, http.StatusOK, buildHeadlinesResponse(items, instrument, partial, fetchedAt, stale))
}
```

Pastikan blok import `headlines.go` mencakup: `errors`, `net/http`, `os`, `strings`, `sync`, `time`, `luna-trade/internal/news`.

- [ ] **Step 2: Daftar route**

Di `api.go`, tepat setelah baris 32 (route calendar), tambah:

```go
	mux.HandleFunc("GET /api/news/headlines", requireUser(handleNewsHeadlines)) // headline feed (agregasi multi-sumber)
```

- [ ] **Step 3: Tambah env + dokumentasi**

Tambah ke `.env.example`:

```
# Opsional: news headline feed (Finnhub, gratis 60 call/mnt). Kosong = fitur News headlines mati.
FINNHUB_TOKEN=
```

Tambah baris di `README.md` pada blok env (di bawah `export OANDA_TOKEN=...`):

```
export FINNHUB_TOKEN=<finnhub-api-key>   # opsional: news headline feed; kosong = fitur mati
```

- [ ] **Step 4: Build + test seluruh repo**

Run: `go build ./... && go test ./...`
Expected: build sukses, semua test PASS.

- [ ] **Step 5: Verifikasi endpoint (disabled path, tanpa token)**

Jalankan server tanpa `FINNHUB_TOKEN` (butuh `.env` OANDA + login utk `requireUser`).
Alternatif tercepat tanpa login: verifikasi via unit sudah menutup logika; untuk cek HTTP, jalankan server lalu (dengan sesi login) :

Run:
```bash
PORT=8765 ./luna-trade &   # butuh .env; hentikan setelah cek
# dengan cookie sesi login yang valid:
curl -s 'http://localhost:8765/api/news/headlines?instrument=XAU_USD' | head -c 300
```
Expected (tanpa `FINNHUB_TOKEN`): JSON `{"disabled":true,...,"instrument":"XAU_USD","headlines":[]}`.
Jika `FINNHUB_TOKEN` di-set: `disabled:false` + `headlines` berisi item relevan gold/USD.

> Catatan: `requireUser` men-gate endpoint → tanpa sesi login akan 401. Itu perilaku benar; verifikasi HTTP penuh dilakukan saat sesi login tersedia (senada verifikasi calendar). Logika inti sudah tertutup unit test Task 1–6.

- [ ] **Step 6: Commit + push + buka PR**

```bash
git add headlines.go api.go .env.example README.md
git commit -m "feat(news): endpoint /api/news/headlines + env FINNHUB_TOKEN + docs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push -u origin zihar/zihar/feat/news-headlines-feed
gh pr create --base main --title "feat(news): headline feed + agregator (backend, PR-1)" \
  --body "Fondasi feed berita: agregator multi-sumber (v1 Finnhub) + endpoint /api/news/headlines. Spec: docs/superpowers/specs/2026-07-12-news-headlines-feed-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Catatan lanjutan (di luar PR-1)

- **PR-2 (tab News di panel)** & **PR-3 (kartu notif on-chart)** = frontend; dapat plan sendiri saat implementasi, dengan pass `frontend-design` + iterasi screenshot browser (§8 spec). Endpoint dari PR-1 ini adalah kontrak yang dikonsumsi keduanya.
- **Deploy:** tambah `FINNHUB_TOKEN` ke `/etc/bar-replay.env` di EC2 + `systemctl restart` (lihat memory bar-replay-deploy) saat siap mengaktifkan di produksi.
