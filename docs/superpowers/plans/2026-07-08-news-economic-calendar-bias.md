# News — Economic Calendar + Directional Bias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambah fitur News (Fase 1) ke luna-trade: panel economic calendar minggu berjalan + directional bias per-instrumen, tanpa API key.

**Architecture:** Logika kalender+bias di-port dari `xau-ict-engine/internal/news` menjadi subpackage baru `luna-trade/internal/news` (std-lib murni, deterministik). Backend `news.go` (package main) menyediakan `GET /api/news/calendar` dengan cache feed in-memory (fan-out ke semua user). Frontend menambah tombol rail ke-4 + panel `#newspanel` di `index.html`.

**Tech Stack:** Go 1.25 (net/http, encoding/json — std-lib only), SQLite (tak dipakai fitur ini), vanilla JS + klinecharts di `index.html`. Feed: `https://nfs.faireconomy.media/ff_calendar_thisweek.json` (mirror publik Forex Factory, tanpa key).

## Global Constraints

- **Std-lib only** untuk paket `internal/news` — TIDAK boleh menambah dependency di `go.mod` (satu-satunya yang ada: `modernc.org/sqlite`).
- **Deterministik, tanpa LLM** untuk semua logika bias.
- **Semua teks yang tampil ke UI = bahasa Inggris** (label, tombol, chip, empty/error state). Komentar kode = Indonesia (ikut konvensi repo).
- **Module path:** `luna-trade` → import subpackage sebagai `luna-trade/internal/news`.
- **Zero API key di Fase 1.** Headline feed (Marketaux/Alpha Vantage) TIDAK dikerjakan.
- **Feed rate-limit:** maks 2 unduh / 5 menit per file → cache server TTL ≥ 10 menit, fallback last-good saat gagal.
- **Asumsi rezim** (data kuat = hawkish = USD↑) harus terlihat di UI, bukan disembunyikan.
- **Pola handler:** `requireUser(...)` + `writeJSON(w, code, v)` / `writeErr(w, code, msg)` (lihat `api.go:176`).
- Commit tiap task. Test: `go test ./...` dari root.

---

### Task 1: Scaffold `internal/news` — kalender (fetch/parse/filter)

**Files:**
- Create: `internal/news/calendar.go`
- Test: `internal/news/calendar_test.go`

**Interfaces:**
- Produces: `type Event struct{Title,Country,Impact string; Time time.Time; Forecast,Previous,Actual string}`; `(Event).Released() bool`; `ParseCalendar([]byte) ([]Event, error)`; `FetchCalendar(*http.Client) ([]Event, error)`; `FetchCalendarRaw(*http.Client) ([]byte, error)`; `FilterUSDHighImpact([]Event) []Event`; `const CalendarURL`.

- [ ] **Step 1: Write the failing test**

`internal/news/calendar_test.go`:
```go
package news

import "testing"

const sampleFeed = `[
  {"title":"CPI m/m","country":"USD","date":"2026-07-10T12:30:00+00:00","impact":"High","forecast":"0.3%","previous":"0.2%","actual":"0.4%"},
  {"title":"German Factory Orders m/m","country":"EUR","date":"2026-07-06T06:00:00+00:00","impact":"Low","forecast":"1.1%","previous":"-3.8%","actual":""},
  {"title":"Non-Farm Employment Change","country":"USD","date":"2026-07-11T12:30:00+00:00","impact":"High","forecast":"180K","previous":"200K","actual":""}
]`

func TestParseCalendar(t *testing.T) {
	ev, err := ParseCalendar([]byte(sampleFeed))
	if err != nil {
		t.Fatalf("ParseCalendar error: %v", err)
	}
	if len(ev) != 3 {
		t.Fatalf("want 3 events, got %d", len(ev))
	}
	if ev[0].Title != "CPI m/m" || ev[0].Country != "USD" || ev[0].Actual != "0.4%" {
		t.Fatalf("unexpected first event: %+v", ev[0])
	}
	if !ev[0].Released() {
		t.Fatalf("CPI should be released (actual filled)")
	}
	if ev[2].Released() {
		t.Fatalf("NFP should not be released (actual empty)")
	}
}

func TestParseCalendarAllBadDates(t *testing.T) {
	_, err := ParseCalendar([]byte(`[{"title":"x","country":"USD","date":"not-a-date","impact":"High"}]`))
	if err == nil {
		t.Fatalf("expected error when all dates fail to parse")
	}
}

func TestFilterUSDHighImpact(t *testing.T) {
	ev, _ := ParseCalendar([]byte(sampleFeed))
	f := FilterUSDHighImpact(ev)
	if len(f) != 2 {
		t.Fatalf("want 2 USD/High events, got %d", len(f))
	}
	for _, e := range f {
		if e.Country != "USD" || e.Impact != "High" {
			t.Fatalf("filter leaked: %+v", e)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/news/`
Expected: FAIL — build error `package news is not in std / undefined: ParseCalendar` (file belum ada).

- [ ] **Step 3: Write `internal/news/calendar.go`**

Port dari `xau-ict-engine/internal/news/calendar.go`, TANPA `FetchCalendarCached` dan TANPA import `os` (cache dilakukan in-memory di `news.go`):
```go
// Package news menarik kalender ekonomi (Forex Factory weekly JSON feed, gratis
// tanpa API key) lalu mengklasifikasi "surprise" tiap rilis high-impact dan
// memetakannya ke tekanan USD → bias per-instrumen. Std-lib only. READ-ONLY.
//
// Sumber: https://nfs.faireconomy.media/ff_calendar_thisweek.json — mirror
// publik kalender Forex Factory. Karena mirror tak-resmi, FetchCalendar
// mengembalikan error jelas bila feed berubah bentuk/down.
package news

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// CalendarURL = mirror publik kalender mingguan Forex Factory (JSON, tanpa key).
const CalendarURL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

// Event = satu baris kalender. Forecast/Previous/Actual disimpan MENTAH.
type Event struct {
	Title    string
	Country  string
	Impact   string
	Time     time.Time
	Forecast string
	Previous string
	Actual   string // "" = belum rilis
}

// Released = true bila feed sudah mengisi kolom Actual.
func (e Event) Released() bool { return strings.TrimSpace(e.Actual) != "" }

type rawEvent struct {
	Title    string `json:"title"`
	Country  string `json:"country"`
	Date     string `json:"date"`
	Impact   string `json:"impact"`
	Forecast string `json:"forecast"`
	Previous string `json:"previous"`
	Actual   string `json:"actual"`
}

// FetchCalendarRaw menarik body mentah feed mingguan. client nil = default 20s.
func FetchCalendarRaw(client *http.Client) ([]byte, error) {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	req, err := http.NewRequest(http.MethodGet, CalendarURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "luna-trade-news/1.0 (+https://lunatrade.domudame.com)")
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
		return nil, fmt.Errorf("kalender feed HTTP %d: %s", resp.StatusCode, snippet(body))
	}
	return body, nil
}

// FetchCalendar menarik & mem-parse feed mingguan (tanpa cache).
func FetchCalendar(client *http.Client) ([]Event, error) {
	body, err := FetchCalendarRaw(client)
	if err != nil {
		return nil, err
	}
	return ParseCalendar(body)
}

// ParseCalendar mem-parse body JSON feed → []Event (dipisah supaya bisa diuji
// tanpa jaringan). Tanggal gagal-parse → event di-skip; bila SEMUA gagal → error.
func ParseCalendar(body []byte) ([]Event, error) {
	var raw []rawEvent
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse kalender JSON: %w (snippet: %s)", err, snippet(body))
	}
	out := make([]Event, 0, len(raw))
	for _, r := range raw {
		t, err := time.Parse(time.RFC3339, r.Date)
		if err != nil {
			continue
		}
		out = append(out, Event{
			Title:    strings.TrimSpace(r.Title),
			Country:  strings.TrimSpace(r.Country),
			Impact:   strings.TrimSpace(r.Impact),
			Time:     t.UTC(),
			Forecast: strings.TrimSpace(r.Forecast),
			Previous: strings.TrimSpace(r.Previous),
			Actual:   strings.TrimSpace(r.Actual),
		})
	}
	if len(raw) > 0 && len(out) == 0 {
		return nil, fmt.Errorf("kalender: %d event tapi semua tanggalnya gagal di-parse (format feed berubah?)", len(raw))
	}
	return out, nil
}

// FilterUSDHighImpact menyaring event USD ber-impact High (case-insensitive).
func FilterUSDHighImpact(events []Event) []Event {
	var out []Event
	for _, e := range events {
		if strings.EqualFold(e.Country, "USD") && strings.EqualFold(e.Impact, "High") {
			out = append(out, e)
		}
	}
	return out
}

// snippet memotong body untuk pesan error.
func snippet(b []byte) string {
	const n = 180
	s := strings.TrimSpace(string(b))
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/news/`
Expected: PASS (ok luna-trade/internal/news).

- [ ] **Step 5: Commit**

```bash
git add internal/news/calendar.go internal/news/calendar_test.go
git commit -m "feat(news): port economic calendar fetch/parse/filter (no API key)"
```

---

### Task 2: Port classify — ParseNumber, surprise, Release, grouping

**Files:**
- Create: `internal/news/classify.go`
- Test: `internal/news/classify_test.go`

**Interfaces:**
- Consumes: `Event` (Task 1).
- Produces: `ParseNumber(string) (float64,bool)`; `type Kind int` + `KindOther,KindInflation,KindJobs` + `KindOf(string) Kind`; `type Surprise int` + `SurpriseUnknown,SurpriseInline,SurpriseAbove,SurpriseBelow` + `(Surprise).String() string`; `classifySurprise(Event) Surprise` (unexported); `type Release struct{Name string; Kind Kind; Time time.Time; Events []Event}` + `(Release).Released()/AnyReleased()/Headline()/WithActual(map[string]string)/coreMoM()`; `GroupReleases([]Event, func(string)string) []Release`; `DefaultName(string) string`.

- [ ] **Step 1: Write the failing test**

`internal/news/classify_test.go`:
```go
package news

import "testing"

func TestParseNumber(t *testing.T) {
	cases := []struct {
		in   string
		want float64
		ok   bool
	}{
		{"0.3%", 0.3, true}, {"85K", 85000, true}, {"-92K", -92000, true},
		{"1.4", 1.4, true}, {"<0.1%", 0.1, true}, {"1,234", 1234, true},
		{"", 0, false}, {"n/a", 0, false},
	}
	for _, c := range cases {
		v, ok := ParseNumber(c.in)
		if ok != c.ok || (ok && v != c.want) {
			t.Errorf("ParseNumber(%q) = %v,%v; want %v,%v", c.in, v, ok, c.want, c.ok)
		}
	}
}

func TestClassifySurprise(t *testing.T) {
	above := classifySurprise(Event{Forecast: "0.3%", Actual: "0.4%"})
	if above != SurpriseAbove {
		t.Errorf("want Above, got %v", above)
	}
	below := classifySurprise(Event{Forecast: "180K", Actual: "150K"})
	if below != SurpriseBelow {
		t.Errorf("want Below, got %v", below)
	}
	inline := classifySurprise(Event{Forecast: "0.3%", Actual: "0.3%"})
	if inline != SurpriseInline {
		t.Errorf("want Inline, got %v", inline)
	}
	unk := classifySurprise(Event{Forecast: "0.3%", Actual: ""})
	if unk != SurpriseUnknown {
		t.Errorf("want Unknown, got %v", unk)
	}
}

func TestGroupReleasesAndKind(t *testing.T) {
	ev, _ := ParseCalendar([]byte(sampleFeed))
	rel := GroupReleases(FilterUSDHighImpact(ev), nil)
	if len(rel) != 2 {
		t.Fatalf("want 2 releases (CPI, NFP), got %d", len(rel))
	}
	byName := map[string]Release{}
	for _, r := range rel {
		byName[r.Name] = r
	}
	if byName["CPI"].Kind != KindInflation {
		t.Errorf("CPI should be KindInflation")
	}
	if byName["NFP"].Kind != KindJobs {
		t.Errorf("NFP should be KindJobs")
	}
	if !byName["CPI"].AnyReleased() {
		t.Errorf("CPI should be released in sample")
	}
	if byName["NFP"].AnyReleased() {
		t.Errorf("NFP should not be released in sample")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/news/`
Expected: FAIL — `undefined: ParseNumber`, `undefined: GroupReleases`, dst.

- [ ] **Step 3: Write `internal/news/classify.go`**

Port dari `xau-ict-engine/internal/news/classify.go`. **HAPUS** `Bias`/`Bias.String`/`biasFor` (diganti USDLean/InstrumentBias di Task 3-4). **TAMBAH** `(Surprise).String()`:
```go
package news

import (
	"math"
	"strconv"
	"strings"
	"time"
)

// Kind = jenis indikator (menentukan arah pemetaan surprise → tekanan USD).
type Kind int

const (
	KindOther Kind = iota
	KindInflation
	KindJobs
)

// KindOf menebak jenis indikator dari judul event.
func KindOf(title string) Kind {
	t := strings.ToUpper(title)
	switch {
	case strings.Contains(t, "CPI"), strings.Contains(t, "PPI"),
		strings.Contains(t, "PCE"), strings.Contains(t, "PRICE INDEX"):
		return KindInflation
	case strings.Contains(t, "NON-FARM"), strings.Contains(t, "NONFARM"),
		strings.Contains(t, "NFP"), strings.Contains(t, "PAYROLL"):
		return KindJobs
	}
	return KindOther
}

// Surprise = hasil rilis relatif forecast.
type Surprise int

const (
	SurpriseUnknown Surprise = iota
	SurpriseInline
	SurpriseAbove
	SurpriseBelow
)

// String = label ringkas untuk JSON/UI.
func (s Surprise) String() string {
	switch s {
	case SurpriseAbove:
		return "above"
	case SurpriseBelow:
		return "below"
	case SurpriseInline:
		return "inline"
	default:
		return "unknown"
	}
}

// ParseNumber mengubah nilai feed ("0.3%","85K","-92K","<0.1%") jadi float.
func ParseNumber(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	s = strings.TrimLeft(s, "<>~≈ ")
	s = strings.ReplaceAll(s, ",", "")
	mult := 1.0
	switch {
	case strings.HasSuffix(s, "%"):
		s = strings.TrimSuffix(s, "%")
	case strings.HasSuffix(s, "K"), strings.HasSuffix(s, "k"):
		s, mult = s[:len(s)-1], 1e3
	case strings.HasSuffix(s, "M"), strings.HasSuffix(s, "m"):
		s, mult = s[:len(s)-1], 1e6
	case strings.HasSuffix(s, "B"), strings.HasSuffix(s, "b"):
		s, mult = s[:len(s)-1], 1e9
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0, false
	}
	return v * mult, true
}

// classifySurprise membandingkan actual vs forecast satu Event.
func classifySurprise(e Event) Surprise {
	a, okA := ParseNumber(e.Actual)
	f, okF := ParseNumber(e.Forecast)
	if !okA || !okF {
		return SurpriseUnknown
	}
	const eps = 1e-9
	switch {
	case math.Abs(a-f) <= eps:
		return SurpriseInline
	case a > f:
		return SurpriseAbove
	default:
		return SurpriseBelow
	}
}

// Release = sekelompok Event satu indikator pada satu timestamp.
type Release struct {
	Name   string
	Kind   Kind
	Time   time.Time
	Events []Event
}

func (r Release) Released() bool {
	for _, e := range r.Events {
		if !e.Released() {
			return false
		}
	}
	return len(r.Events) > 0
}

func (r Release) AnyReleased() bool {
	for _, e := range r.Events {
		if e.Released() {
			return true
		}
	}
	return false
}

// Headline mengembalikan event utama (bukan "core", utamakan "m/m").
func (r Release) Headline() (Event, bool) {
	var mm, any Event
	var okMM, okAny bool
	for _, e := range r.Events {
		t := strings.ToLower(e.Title)
		if strings.Contains(t, "core") {
			continue
		}
		if !okAny {
			any, okAny = e, true
		}
		if strings.Contains(t, "m/m") {
			mm, okMM = e, true
		}
	}
	if okMM {
		return mm, true
	}
	if okAny {
		return any, true
	}
	if len(r.Events) > 0 {
		return r.Events[0], true
	}
	return Event{}, false
}

// WithActual = salinan Release dengan Actual tiap event diisi dari map (untuk test/preview).
func (r Release) WithActual(actuals map[string]string) Release {
	out := r
	out.Events = make([]Event, len(r.Events))
	copy(out.Events, r.Events)
	for i := range out.Events {
		if a, ok := actuals[out.Events[i].Title]; ok {
			out.Events[i].Actual = a
		}
	}
	return out
}

// GroupReleases mengelompokkan event per indikator + timestamp.
func GroupReleases(events []Event, nameOf func(string) string) []Release {
	if nameOf == nil {
		nameOf = DefaultName
	}
	type key struct {
		name string
		t    time.Time
	}
	idx := map[key]int{}
	var out []Release
	for _, e := range events {
		name := nameOf(e.Title)
		if name == "" {
			continue
		}
		k := key{name, e.Time}
		if i, ok := idx[k]; ok {
			out[i].Events = append(out[i].Events, e)
			continue
		}
		idx[k] = len(out)
		out = append(out, Release{Name: name, Kind: KindOf(e.Title), Time: e.Time, Events: []Event{e}})
	}
	return out
}

// DefaultName memetakan judul → label indikator yang dipantau ("" = diabaikan).
func DefaultName(title string) string {
	t := strings.ToUpper(title)
	switch {
	case strings.Contains(t, "PPI"):
		return "PPI"
	case strings.Contains(t, "CPI"):
		return "CPI"
	case strings.Contains(t, "NON-FARM"), strings.Contains(t, "NONFARM"),
		strings.Contains(t, "NFP"), strings.Contains(t, "PAYROLL"):
		return "NFP"
	}
	return ""
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/news/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/news/classify.go internal/news/classify_test.go
git commit -m "feat(news): port number parsing, surprise & release grouping"
```

---

### Task 3: USD lean + Verdict (Lapis 1)

**Files:**
- Create: `internal/news/verdict.go`
- Test: `internal/news/verdict_test.go`

**Interfaces:**
- Consumes: `Kind`, `Surprise`, `Release`, `classifySurprise` (Task 2).
- Produces: `type USDLean int` + `LeanNeutral,LeanHawkish,LeanDovish` + `(USDLean).String() string`; `const RegimeHawkishOnStrong = true`; `usdLeanFor(Kind,Surprise) (USDLean,string)` (unexported); `type Verdict struct{Surprise Surprise; Lean USDLean; Label string; Tilt USDLean; Tiebreak string}`; `(Release).Classify() Verdict`; `(Release).coreMoM() (Event,bool)`.

- [ ] **Step 1: Write the failing test**

`internal/news/verdict_test.go`:
```go
package news

import (
	"testing"
	"time"
)

func rel(kind Kind, ev ...Event) Release {
	return Release{Name: "X", Kind: kind, Time: time.Unix(0, 0).UTC(), Events: ev}
}

func TestClassifyHawkishDovish(t *testing.T) {
	// CPI hot (above) → hawkish
	v := rel(KindInflation, Event{Title: "CPI m/m", Forecast: "0.3%", Actual: "0.5%"}).Classify()
	if v.Lean != LeanHawkish || v.Surprise != SurpriseAbove {
		t.Fatalf("CPI hot: want hawkish/above, got %v/%v", v.Lean, v.Surprise)
	}
	// NFP miss (below) → dovish
	v = rel(KindJobs, Event{Title: "Non-Farm Employment Change", Forecast: "180K", Actual: "120K"}).Classify()
	if v.Lean != LeanDovish {
		t.Fatalf("NFP miss: want dovish, got %v", v.Lean)
	}
}

func TestClassifyCoreTiebreaker(t *testing.T) {
	// headline m/m inline, core m/m above → Tilt hawkish
	v := rel(KindInflation,
		Event{Title: "CPI m/m", Forecast: "0.3%", Actual: "0.3%"},
		Event{Title: "Core CPI m/m", Forecast: "0.2%", Actual: "0.4%"},
	).Classify()
	if v.Lean != LeanNeutral {
		t.Fatalf("headline inline → Lean neutral, got %v", v.Lean)
	}
	if v.Tilt != LeanHawkish || v.Tiebreak == "" {
		t.Fatalf("core above → Tilt hawkish + reason, got %v %q", v.Tilt, v.Tiebreak)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/news/`
Expected: FAIL — `undefined: LeanHawkish`, `Release.Classify undefined`.

- [ ] **Step 3: Write `internal/news/verdict.go`**

```go
package news

import "strings"

// USDLean = arah tekanan ke USD dari sebuah surprise (Lapis 1, instrument-agnostic).
type USDLean int

const (
	LeanNeutral USDLean = iota
	LeanHawkish         // data kuat → Fed hawkish → USD menguat
	LeanDovish          // data lemah → USD melemah
)

// String = label untuk JSON/UI.
func (l USDLean) String() string {
	switch l {
	case LeanHawkish:
		return "hawkish"
	case LeanDovish:
		return "dovish"
	default:
		return "neutral"
	}
}

// RegimeHawkishOnStrong: asumsi rezim (2026) — data kuat = hawkish = USD↑.
// Dibalik bila rezim berubah; ditampilkan terang-terangan di UI.
const RegimeHawkishOnStrong = true

// usdLeanFor memetakan (jenis indikator, surprise) → tekanan USD + label (EN).
func usdLeanFor(kind Kind, s Surprise) (lean USDLean, label string) {
	strong, weak := LeanHawkish, LeanDovish
	if !RegimeHawkishOnStrong {
		strong, weak = LeanDovish, LeanHawkish
	}
	switch kind {
	case KindInflation:
		switch s {
		case SurpriseAbove:
			return strong, "hot (above forecast)"
		case SurpriseBelow:
			return weak, "soft (below forecast)"
		case SurpriseInline:
			return LeanNeutral, "in line with forecast"
		}
	case KindJobs:
		switch s {
		case SurpriseAbove:
			return strong, "beat (above forecast)"
		case SurpriseBelow:
			return weak, "miss (below forecast)"
		case SurpriseInline:
			return LeanNeutral, "in line with forecast"
		}
	}
	return LeanNeutral, "unclassified"
}

// Verdict = ringkasan klasifikasi satu Release (instrument-agnostic).
type Verdict struct {
	Surprise Surprise
	Lean     USDLean
	Label    string
	Tilt     USDLean // condong tipis dari tiebreaker core m/m (LeanNeutral = tak ada)
	Tiebreak string
}

// Classify mengevaluasi Release → Verdict berdasar event headline + tiebreaker core.
func (r Release) Classify() Verdict {
	h, ok := r.Headline()
	if !ok {
		return Verdict{}
	}
	s := classifySurprise(h)
	lean, label := usdLeanFor(r.Kind, s)
	v := Verdict{Surprise: s, Lean: lean, Label: label}
	if r.Kind == KindInflation && s == SurpriseInline {
		if c, ok := r.coreMoM(); ok {
			strong, weak := LeanHawkish, LeanDovish
			if !RegimeHawkishOnStrong {
				strong, weak = LeanDovish, LeanHawkish
			}
			switch classifySurprise(c) {
			case SurpriseAbove:
				v.Tilt, v.Tiebreak = strong, "core m/m above forecast (slightly hot) — Fed's key gauge"
			case SurpriseBelow:
				v.Tilt, v.Tiebreak = weak, "core m/m below forecast (slightly soft) — Fed's key gauge"
			}
		}
	}
	return v
}

// coreMoM mencari event "core … m/m" (gauge inflasi inti).
func (r Release) coreMoM() (Event, bool) {
	for _, e := range r.Events {
		t := strings.ToLower(e.Title)
		if strings.Contains(t, "core") && strings.Contains(t, "m/m") {
			return e, true
		}
	}
	return Event{}, false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/news/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/news/verdict.go internal/news/verdict_test.go
git commit -m "feat(news): USD lean classification + core m/m tiebreaker (verdict)"
```

---

### Task 4: Instrument bias mapping (Lapis 2) + playbook

**Files:**
- Create: `internal/news/bias.go`
- Test: `internal/news/bias_test.go`

**Interfaces:**
- Consumes: `USDLean`, `LeanHawkish/LeanDovish/LeanNeutral` (Task 3).
- Produces: `type Role int` + `RoleUnknown,RoleQuoteUSD,RoleBaseUSD,RoleGold,RoleDXY`; `InstrumentRole(string) Role`; `type Bias int` + `BiasNeutral,BiasBearish,BiasBullish` + `(Bias).String() string`; `InstrumentBias(USDLean,Role) Bias`; `Playbook(USDLean,Role,Bias,string) string`; `PreScenario(Role,string) string`; `PrettySymbol(string) string`.

- [ ] **Step 1: Write the failing test**

`internal/news/bias_test.go`:
```go
package news

import "testing"

func TestInstrumentRole(t *testing.T) {
	cases := map[string]Role{
		"EUR_USD": RoleQuoteUSD, "GBP_USD": RoleQuoteUSD, "AUD_USD": RoleQuoteUSD, "NZD_USD": RoleQuoteUSD,
		"USD_JPY": RoleBaseUSD, "USD_CAD": RoleBaseUSD, "USD_CHF": RoleBaseUSD,
		"XAU_USD": RoleGold, "XAG_USD": RoleGold,
		"DXY":     RoleDXY,
		"EUR_JPY": RoleUnknown, "BTC_USD": RoleUnknown, "": RoleUnknown,
	}
	for sym, want := range cases {
		if got := InstrumentRole(sym); got != want {
			t.Errorf("InstrumentRole(%q) = %v; want %v", sym, got, want)
		}
	}
}

func TestInstrumentBias(t *testing.T) {
	// USD hawkish (data kuat, USD↑)
	if InstrumentBias(LeanHawkish, RoleQuoteUSD) != BiasBearish {
		t.Error("hawkish + EUR/USD → bearish")
	}
	if InstrumentBias(LeanHawkish, RoleBaseUSD) != BiasBullish {
		t.Error("hawkish + USD/JPY → bullish")
	}
	if InstrumentBias(LeanHawkish, RoleGold) != BiasBearish {
		t.Error("hawkish + gold → bearish")
	}
	if InstrumentBias(LeanHawkish, RoleDXY) != BiasBullish {
		t.Error("hawkish + DXY → bullish")
	}
	// USD dovish (data lemah, USD↓) — kebalikan
	if InstrumentBias(LeanDovish, RoleQuoteUSD) != BiasBullish {
		t.Error("dovish + EUR/USD → bullish")
	}
	if InstrumentBias(LeanDovish, RoleGold) != BiasBullish {
		t.Error("dovish + gold → bullish")
	}
	// neutral / unknown → neutral
	if InstrumentBias(LeanNeutral, RoleGold) != BiasNeutral {
		t.Error("neutral lean → neutral")
	}
	if InstrumentBias(LeanHawkish, RoleUnknown) != BiasNeutral {
		t.Error("unknown role → neutral")
	}
}

func TestBiasString(t *testing.T) {
	if BiasBearish.String() != "bearish" || BiasBullish.String() != "bullish" || BiasNeutral.String() != "neutral" {
		t.Error("Bias.String mismatch")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/news/`
Expected: FAIL — `undefined: InstrumentRole`, `undefined: BiasBearish`.

- [ ] **Step 3: Write `internal/news/bias.go`**

```go
package news

import "strings"

// Role = hubungan instrumen dengan USD (menentukan arah bias dari tekanan USD).
type Role int

const (
	RoleUnknown  Role = iota
	RoleQuoteUSD      // USD quote, base fiat asing: EUR_USD, GBP_USD, AUD_USD, NZD_USD
	RoleBaseUSD       // USD base: USD_JPY, USD_CAD, USD_CHF
	RoleGold          // logam mulia (inverse USD/yield): XAU_USD, XAG_USD
	RoleDXY           // indeks USD
)

// fiat = mata uang fiat yang dikenali (untuk membedakan dari kripto).
var fiat = map[string]bool{
	"USD": true, "EUR": true, "GBP": true, "JPY": true, "CHF": true,
	"CAD": true, "AUD": true, "NZD": true,
}

// InstrumentRole memetakan simbol ("BASE_QUOTE" atau "DXY") → Role. Kripto &
// cross tanpa USD → RoleUnknown.
func InstrumentRole(symbol string) Role {
	s := strings.ToUpper(strings.TrimSpace(symbol))
	s = strings.ReplaceAll(s, "/", "_")
	if s == "DXY" {
		return RoleDXY
	}
	parts := strings.SplitN(s, "_", 2)
	if len(parts) != 2 {
		return RoleUnknown
	}
	base, quote := parts[0], parts[1]
	if base == "XAU" || base == "XAG" {
		return RoleGold
	}
	switch {
	case quote == "USD" && fiat[base]:
		return RoleQuoteUSD
	case base == "USD" && fiat[quote]:
		return RoleBaseUSD
	}
	return RoleUnknown
}

// Bias = arah dampak ke instrumen.
type Bias int

const (
	BiasNeutral Bias = iota
	BiasBearish
	BiasBullish
)

func (b Bias) String() string {
	switch b {
	case BiasBearish:
		return "bearish"
	case BiasBullish:
		return "bullish"
	default:
		return "neutral"
	}
}

// InstrumentBias menurunkan bias instrumen dari tekanan USD (Lapis 2).
func InstrumentBias(lean USDLean, role Role) Bias {
	if lean == LeanNeutral || role == RoleUnknown {
		return BiasNeutral
	}
	usdUp := lean == LeanHawkish
	var bullishWhenUSDUp bool
	switch role {
	case RoleBaseUSD, RoleDXY:
		bullishWhenUSDUp = true
	case RoleQuoteUSD, RoleGold:
		bullishWhenUSDUp = false
	default:
		return BiasNeutral
	}
	if usdUp == bullishWhenUSDUp {
		return BiasBullish
	}
	return BiasBearish
}

// PrettySymbol "XAU_USD" → "XAU/USD" (DXY tetap).
func PrettySymbol(symbol string) string {
	s := strings.ToUpper(strings.TrimSpace(symbol))
	return strings.ReplaceAll(s, "_", "/")
}

// Playbook menyusun narasi singkat (EN) pasca-rilis.
func Playbook(lean USDLean, role Role, bias Bias, symbol string) string {
	sym := PrettySymbol(symbol)
	if role == RoleUnknown {
		return "No direct USD linkage for " + sym + "."
	}
	switch lean {
	case LeanHawkish:
		return "Strong data → hawkish Fed → USD up → " + bias.String() + " " + sym + "."
	case LeanDovish:
		return "Soft data → room for cuts → USD down → " + bias.String() + " " + sym + "."
	default:
		return "Small surprise → limited impact; " + sym + " likely technical-driven."
	}
}

// PreScenario menyusun skenario kalau-maka (EN) untuk rilis yang BELUM keluar.
func PreScenario(role Role, symbol string) string {
	sym := PrettySymbol(symbol)
	if role == RoleUnknown {
		return "No direct USD linkage for " + sym + "."
	}
	up := InstrumentBias(LeanHawkish, role)
	down := InstrumentBias(LeanDovish, role)
	return "Above forecast → USD up → " + up.String() + " " + sym +
		"; below → " + down.String() + " " + sym + "."
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/news/`
Expected: PASS (semua test paket news hijau).

- [ ] **Step 5: Commit**

```bash
git add internal/news/bias.go internal/news/bias_test.go
git commit -m "feat(news): instrument role→bias mapping (pairs+DXY+gold) + playbook"
```

---

### Task 5: Backend handler `/api/news/calendar` + cache in-memory

**Files:**
- Create: `news.go` (package main, root)
- Modify: `api.go:24-35` (registerAPI — tambah rute)
- Test: `news_test.go` (package main, root)

**Interfaces:**
- Consumes: seluruh API publik paket `luna-trade/internal/news` (Task 1-4); `writeJSON`/`writeErr` (`api.go:176`); `requireUser` (`auth.go`).
- Produces: `handleNewsCalendar(http.ResponseWriter,*http.Request)`; `buildCalendarResponse([]news.Event,string,time.Time,time.Time,bool) calResponse` (pure, ttestable); `type newsCache` dgn `get(time.Time)`.

- [ ] **Step 1: Write the failing test**

`news_test.go`:
```go
package main

import (
	"testing"
	"time"

	"luna-trade/internal/news"
)

func sampleEvents(now time.Time) []news.Event {
	return []news.Event{
		{Title: "CPI m/m", Country: "USD", Impact: "High", Time: now.Add(-1 * time.Hour), Forecast: "0.3%", Previous: "0.2%", Actual: "0.5%"},
		{Title: "Non-Farm Employment Change", Country: "USD", Impact: "High", Time: now.Add(3 * time.Hour), Forecast: "180K", Previous: "200K", Actual: ""},
		{Title: "German Orders", Country: "EUR", Impact: "Low", Time: now, Forecast: "1%", Previous: "0%", Actual: "2%"},
	}
}

func TestBuildCalendarResponseGold(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	resp := buildCalendarResponse(sampleEvents(now), "XAU_USD", now, now, false)
	if len(resp.Releases) != 2 {
		t.Fatalf("want 2 USD/High releases, got %d", len(resp.Releases))
	}
	var cpi, nfp *calItem
	for i := range resp.Releases {
		switch resp.Releases[i].Name {
		case "CPI":
			cpi = &resp.Releases[i]
		case "NFP":
			nfp = &resp.Releases[i]
		}
	}
	if cpi == nil || nfp == nil {
		t.Fatalf("missing CPI/NFP release")
	}
	// CPI hot + gold → bearish
	if !cpi.Released || cpi.Verdict.Bias != "bearish" || cpi.Verdict.USDLean != "hawkish" {
		t.Fatalf("CPI verdict wrong: %+v", cpi.Verdict)
	}
	// NFP belum rilis → next release + neutral verdict + scenario playbook
	if nfp.Released {
		t.Fatalf("NFP should be pending")
	}
	if resp.NextRelease == nil || resp.NextRelease.Name != "NFP" || resp.NextRelease.MinsToGo != 180 {
		t.Fatalf("nextRelease wrong: %+v", resp.NextRelease)
	}
	if resp.Regime != "strong-data-hawkish" {
		t.Fatalf("regime label wrong: %s", resp.Regime)
	}
}

func TestBuildCalendarResponseBaseUSD(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	resp := buildCalendarResponse(sampleEvents(now), "USD_JPY", now, now, false)
	for _, it := range resp.Releases {
		if it.Name == "CPI" && it.Verdict.Bias != "bullish" {
			t.Fatalf("CPI hot + USD/JPY → bullish, got %s", it.Verdict.Bias)
		}
	}
}

func TestNewsCacheStaleFallback(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	calls := 0
	c := &newsCache{fetch: func() ([]news.Event, error) {
		calls++
		if calls == 1 {
			return sampleEvents(now), nil
		}
		return nil, errFetch
	}}
	// 1st: live ok
	ev, _, stale, err := c.get(now)
	if err != nil || stale || len(ev) == 0 {
		t.Fatalf("first get should be live ok")
	}
	// within TTL: no refetch
	if _, _, _, _ = c.get(now.Add(1 * time.Minute)); calls != 1 {
		t.Fatalf("within TTL should not refetch, calls=%d", calls)
	}
	// after TTL: refetch fails → serve stale last-good
	ev, _, stale, err = c.get(now.Add(11 * time.Minute))
	if err != nil || !stale || len(ev) == 0 {
		t.Fatalf("after TTL fail should serve stale, err=%v stale=%v", err, stale)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test .`
Expected: FAIL — `undefined: buildCalendarResponse`, `undefined: newsCache`, `undefined: errFetch`.

- [ ] **Step 3: Write `news.go`**

```go
// Fitur News (Fase 1): endpoint kalender ekonomi + directional bias per-instrumen.
// Sumber: feed publik Forex Factory (tanpa API key), logika di internal/news.
// Cache feed in-memory (fan-out satu fetch ke semua user), TTL menghormati
// rate-limit feed (maks 2 unduh / 5 menit). READ-ONLY.
package main

import (
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"luna-trade/internal/news"
)

// calTTL = umur cache feed. ≥ 5 menit untuk menghormati limit feed (2 unduh/5mnt).
const calTTL = 10 * time.Minute

var errFetch = errors.New("fetch gagal")

// newsCache = cache in-memory feed kalender. fetch injectable untuk test.
type newsCache struct {
	mu        sync.Mutex
	events    []news.Event
	fetchedAt time.Time
	ok        bool // pernah sukses minimal sekali
	fetch     func() ([]news.Event, error)
}

var calCache = &newsCache{fetch: func() ([]news.Event, error) { return news.FetchCalendar(nil) }}

// get mengembalikan event kalender; refetch bila TTL lewat. stale=true bila
// menyajikan last-good karena refetch gagal. err hanya bila belum pernah sukses.
func (c *newsCache) get(now time.Time) (events []news.Event, fetchedAt time.Time, stale bool, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ok && now.Sub(c.fetchedAt) < calTTL {
		return c.events, c.fetchedAt, false, nil
	}
	ev, ferr := c.fetch()
	if ferr != nil {
		if c.ok {
			return c.events, c.fetchedAt, true, nil // last-good (basi)
		}
		return nil, time.Time{}, false, ferr
	}
	c.events, c.fetchedAt, c.ok = ev, now, true
	return c.events, c.fetchedAt, false, nil
}

// ---- bentuk response JSON ----

type calVerdict struct {
	Surprise string `json:"surprise"`
	USDLean  string `json:"usdLean"`
	Bias     string `json:"bias"`
	Label    string `json:"label"`
	Playbook string `json:"playbook"`
	Tiebreak string `json:"tiebreak,omitempty"`
}

type calItem struct {
	Name     string     `json:"name"`
	Time     string     `json:"time"`
	Currency string     `json:"currency"`
	Impact   string     `json:"impact"`
	Released bool        `json:"released"`
	Forecast string     `json:"forecast"`
	Previous string     `json:"previous"`
	Actual   string     `json:"actual"`
	Verdict  calVerdict `json:"verdict"`
}

type nextRel struct {
	Name     string `json:"name"`
	Time     string `json:"time"`
	MinsToGo int    `json:"minsToGo"`
}

type calResponse struct {
	Stale       bool      `json:"stale"`
	FetchedAt   string    `json:"fetchedAt"`
	Instrument  string    `json:"instrument"`
	Regime      string    `json:"regime"`
	NextRelease *nextRel  `json:"nextRelease"`
	Releases    []calItem `json:"releases"`
}

// buildCalendarResponse = fungsi murni (tanpa jaringan) → mudah di-test.
func buildCalendarResponse(events []news.Event, instrument string, now, fetchedAt time.Time, stale bool) calResponse {
	role := news.InstrumentRole(instrument)
	releases := news.GroupReleases(news.FilterUSDHighImpact(events), nil)
	sort.Slice(releases, func(i, j int) bool { return releases[i].Time.Before(releases[j].Time) })

	items := make([]calItem, 0, len(releases))
	var next *nextRel
	for _, rel := range releases {
		it := calItem{
			Name:     rel.Name,
			Time:     rel.Time.Format(time.RFC3339),
			Currency: "USD",
			Impact:   "High",
			Released: rel.AnyReleased(),
		}
		if h, ok := rel.Headline(); ok {
			it.Forecast, it.Previous, it.Actual = h.Forecast, h.Previous, h.Actual
		}
		if it.Released {
			v := rel.Classify()
			bias := news.InstrumentBias(v.Lean, role)
			it.Verdict = calVerdict{
				Surprise: v.Surprise.String(),
				USDLean:  v.Lean.String(),
				Bias:     bias.String(),
				Label:    v.Label,
				Playbook: news.Playbook(v.Lean, role, bias, instrument),
				Tiebreak: v.Tiebreak,
			}
		} else {
			it.Verdict = calVerdict{
				Surprise: "unknown",
				USDLean:  "neutral",
				Bias:     "neutral",
				Label:    "awaiting release",
				Playbook: news.PreScenario(role, instrument),
			}
			if next == nil && rel.Time.After(now) {
				next = &nextRel{
					Name:     rel.Name,
					Time:     rel.Time.Format(time.RFC3339),
					MinsToGo: int(rel.Time.Sub(now).Round(time.Minute).Minutes()),
				}
			}
		}
		items = append(items, it)
	}

	regime := "strong-data-hawkish"
	if !news.RegimeHawkishOnStrong {
		regime = "strong-data-dovish"
	}
	return calResponse{
		Stale:       stale,
		FetchedAt:   fetchedAt.Format(time.RFC3339),
		Instrument:  instrument,
		Regime:      regime,
		NextRelease: next,
		Releases:    items,
	}
}

// handleNewsCalendar melayani GET /api/news/calendar?instrument=XAU_USD.
func handleNewsCalendar(w http.ResponseWriter, r *http.Request) {
	instrument := strings.TrimSpace(r.URL.Query().Get("instrument"))
	if instrument == "" {
		instrument = "XAU_USD"
	}
	now := time.Now().UTC()
	events, fetchedAt, stale, err := calCache.get(now)
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "News feed unavailable")
		return
	}
	writeJSON(w, http.StatusOK, buildCalendarResponse(events, instrument, now, fetchedAt, stale))
}
```

- [ ] **Step 4: Register route in `api.go`**

Di `registerAPI` (`api.go:24`), tambah setelah baris `/api/journal`:
```go
	mux.HandleFunc("GET /api/news/calendar", requireUser(handleNewsCalendar)) // Fase 1: economic calendar + bias
```

- [ ] **Step 5: Run test + build to verify**

Run: `go test . && go build ./...`
Expected: PASS + build sukses.

- [ ] **Step 6: Smoke-test endpoint manual (opsional tapi disarankan)**

Jalankan server lokal, login, lalu:
Run: `curl -s -b <cookie> "http://localhost:8080/api/news/calendar?instrument=XAU_USD" | head -c 400`
Expected: JSON dengan field `stale,fetchedAt,instrument,regime,nextRelease,releases`. (Bila feed hidup, `releases` berisi rilis USD/High minggu ini.)

- [ ] **Step 7: Commit**

```bash
git add news.go api.go news_test.go
git commit -m "feat(news): GET /api/news/calendar with in-memory feed cache + stale fallback"
```

---

### Task 6: Frontend — tombol rail + panel scaffold + toggle/persist

**Files:**
- Modify: `index.html` (rail `#rail` ~1105; grid `.app` CSS ~691; panel area dekat `#watchlist` ~1142; fungsi toggle dekat `toggleMarkets` ~4303)

**Interfaces:**
- Consumes: pola `toggleMarkets`/`setMarketsHidden` (`index.html:4303`), helper `$` (querySelector), `localStorage` prefix `br_`.
- Produces: elemen `#newspanel`, tombol `#toggleNews`, fungsi global `toggleNews()`, state `localStorage['br_newsOpen']`.

> **Catatan:** `index.html` monolitik tanpa build/test → task frontend diverifikasi manual di browser (bukan unit test). Gunakan skill `run`/Playwright untuk observasi.

- [ ] **Step 1: Baca konteks wiring**

Run: `grep -n "toggleMarkets\|setMarketsHidden\|id=\"rail\"\|id=\"toggleTrades\"\|grid-area:markets\|wl-head" index.html`
Baca fungsi `toggleMarkets`/`setMarketsHidden` selengkapnya untuk meniru cara panel kanan disembunyikan/ditampilkan & lebar kolom `--markets-w` diatur.

- [ ] **Step 2: Tambah tombol rail**

Di `#rail`, setelah tombol `#toggleTrades`, sisipkan (ikon news, gaya samakan tombol rail lain):
```html
<button id="toggleNews" class="railbtn" title="News" aria-label="News">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
    <path d="M4 5h13v14H4z"/><path d="M17 8h3v9a2 2 0 0 1-2 2h-1"/><path d="M7 8h7M7 11h7M7 14h5"/>
  </svg>
</button>
```
(Samakan `class` dengan tombol rail lain hasil Step 1 bila bukan `railbtn`.)

- [ ] **Step 3: Tambah markup panel `#newspanel`**

Tepat setelah elemen `#watchlist` (grid-area markets), sisipkan panel yang share area yang sama, default tersembunyi:
```html
<aside id="newspanel" class="watchlist" style="display:none">
  <div class="wl-head">News <button class="wl-x" id="newsClose" aria-label="Close">✕</button></div>
  <div id="newsBody" class="news-body">
    <div class="news-empty">Loading…</div>
  </div>
</aside>
```

- [ ] **Step 4: Tambah CSS panel**

Di blok `<style>`, dekat aturan `.watchlist`, tambahkan:
```css
#newspanel{ grid-area:markets; overflow:auto; background:var(--panel); border-left:1px solid var(--border); }
.news-body{ display:flex; flex-direction:column; gap:10px; padding:10px; }
.news-empty{ color:var(--muted); font-size:13px; text-align:center; padding:24px 8px; }
.news-bias{ border:1px solid var(--border); border-radius:8px; padding:10px 12px; background:var(--panel-2); }
.news-bias .sym{ font:600 13px Inter,sans-serif; color:var(--txt); }
.news-bias .dir{ font:700 15px 'Space Grotesk',sans-serif; }
.news-bias.bullish .dir{ color:var(--green); } .news-bias.bearish .dir{ color:var(--red); }
.news-bias.neutral .dir{ color:var(--muted); }
.news-regime{ font-size:10px; color:var(--hdr); border:1px solid var(--border); border-radius:10px; padding:1px 7px; display:inline-block; margin-top:6px; }
.news-next{ border:1px solid var(--accent); border-radius:8px; padding:8px 12px; }
.news-next .cd{ font:600 13px var(--mono,monospace); color:var(--accent); }
.cal-item{ border-bottom:1px solid var(--border); padding:8px 4px; font-size:12px; }
.cal-item .row1{ display:flex; justify-content:space-between; align-items:center; }
.cal-item .nm{ color:var(--txt); font-weight:600; }
.cal-item .tm{ color:var(--muted); font:11px var(--mono,monospace); }
.impact-dot{ width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:5px; }
.impact-High{ background:var(--red); } .impact-Medium{ background:#e0a63a; } .impact-Low{ background:var(--muted); }
.cal-fig{ color:var(--muted); } .cal-fig b{ color:var(--txt); }
.cal-item.released{ background:color-mix(in srgb, var(--accent) 6%, transparent); }
```

- [ ] **Step 5: Tambah fungsi `toggleNews()` + wiring**

Dekat `toggleMarkets` (`index.html:4303`), tambahkan (SESUAIKAN pemanggilan `setMarketsHidden` dengan signature aslinya dari Step 1):
```js
function setNewsOpen(open){
  const np=$('#newspanel'), wl=$('#watchlist');
  if(open){
    // News & Markets berbagi kolom kanan (radio): tampilkan News, sembunyikan Markets.
    setMarketsHidden(false);         // pastikan kolom kanan tampil (lihat impl asli)
    if(wl) wl.style.display='none';
    np.style.display='';
    loadNews();                       // didefinisikan di Task 7
  }else{
    np.style.display='none';
    if(wl) wl.style.display='';       // kembalikan Markets
  }
  localStorage.setItem('br_newsOpen', open?'1':'0');
}
function toggleNews(){ setNewsOpen($('#newspanel').style.display==='none'); }
$('#toggleNews').onclick=toggleNews;
$('#newsClose').onclick=()=>setNewsOpen(false);
// Restore state saat load:
if(localStorage.getItem('br_newsOpen')==='1') setNewsOpen(true);
```
Bila `toggleMarkets` dipanggil saat News terbuka, News harus ikut tertutup. Di awal `toggleMarkets`, tambahkan guard:
```js
if($('#newspanel') && $('#newspanel').style.display!=='none'){ $('#newspanel').style.display='none'; localStorage.setItem('br_newsOpen','0'); }
```

- [ ] **Step 6: Verifikasi manual di browser**

Jalankan app (skill `run`). Amati:
- Tombol News muncul di rail; klik → panel News tampil di kolom kanan, Markets tersembunyi, isi "Loading…".
- Klik ✕ atau tombol News lagi → panel tutup, Markets kembali.
- Klik tombol Markets saat News terbuka → News tertutup, Markets tampil.
- Reload halaman dengan News terbuka → News tetap terbuka (persist).
Ambil screenshot untuk konfirmasi.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(news): rail button + News panel scaffold (radio with Markets, persisted)"
```

---

### Task 7: Frontend — fetch & render (bias card, next release, calendar)

**Files:**
- Modify: `index.html` (JS: `loadNews`, render helpers; hook ganti instrumen; poll)

**Interfaces:**
- Consumes: `#newsBody`, `setNewsOpen`/`toggleNews` (Task 6); endpoint `GET /api/news/calendar?instrument=` (Task 5); pola `fetch(...).then(r=>r.json())` (`spSync`, `index.html:3112`); variabel/fungsi instrumen aktif (ditemukan di Step 1).
- Produces: `loadNews()`, `renderNews(data)`, `newsCurrentInstrument()`, poll interval saat panel terlihat.

- [ ] **Step 1: Temukan instrumen aktif & hook pergantiannya**

Run: `grep -n "instrument\|currentInstr\|activeSymbol\|setInstrument\|ipick\|changeInstrument" index.html | head -40`
Identifikasi: (a) variabel/cara membaca simbol instrumen chart aktif, (b) fungsi yang dipanggil saat user ganti instrumen. Catat namanya untuk dipakai di Step 3 & 4.

- [ ] **Step 2: Tulis `loadNews` + `renderNews`**

Tambahkan di area script (dekat `setNewsOpen`):
```js
function newsCurrentInstrument(){
  // GANTI dengan cara baca instrumen aktif hasil Step 1 (fallback XAU_USD):
  return (window.currentInstrument || 'XAU_USD');
}
let _newsTimer=null, _newsCountdown=null;
function loadNews(){
  const body=$('#newsBody');
  const inst=newsCurrentInstrument();
  fetch('/api/news/calendar?instrument='+encodeURIComponent(inst))
    .then(r=>{ if(!r.ok) throw new Error('http'); return r.json(); })
    .then(renderNews)
    .catch(()=>{ body.innerHTML='<div class="news-empty">News feed unavailable.'
      +' <button id="newsRetry" class="wl-x">Retry</button></div>';
      const b=$('#newsRetry'); if(b) b.onclick=loadNews; });
}
function fmtLocal(iso){ const d=new Date(iso);
  return d.toLocaleString([], {weekday:'short', hour:'2-digit', minute:'2-digit'}); }
function biasArrow(b){ return b==='bullish'?'▲':b==='bearish'?'▼':'—'; }
function renderNews(d){
  const body=$('#newsBody');
  const pretty=(d.instrument||'').replace('_','/');
  // Bias card dari rilis terbaru yang sudah keluar (kalau ada), else netral.
  let latest=null;
  for(const r of (d.releases||[])) if(r.released) latest=r;
  const bias = latest ? latest.verdict.bias : 'neutral';
  const line = latest ? latest.verdict.playbook
    : 'Awaiting the next high-impact release.';
  let html='';
  html+=`<div class="news-bias ${bias}">
    <div class="sym">${pretty}</div>
    <div class="dir">${biasArrow(bias)} ${bias.toUpperCase()}</div>
    <div>${line}</div>
    <span class="news-regime">Regime: ${d.regime==='strong-data-hawkish'?'strong data → USD↑':'strong data → USD↓'}</span>
    ${d.stale?'<span class="news-regime">Delayed data</span>':''}
  </div>`;
  // Next release + countdown
  if(d.nextRelease){
    html+=`<div class="news-next"><div class="nm">Next: ${d.nextRelease.name}</div>
      <div class="cd" data-t="${d.nextRelease.time}">—</div></div>`;
  }
  // Calendar list
  if(!(d.releases||[]).length){
    html+='<div class="news-empty">No high-impact USD events this week.</div>';
  }else{
    for(const r of d.releases){
      const sur = r.released ? (r.verdict.surprise==='above'?'📈':r.verdict.surprise==='below'?'📉':'➖') : '';
      html+=`<div class="cal-item ${r.released?'released':''}">
        <div class="row1"><span class="nm"><span class="impact-dot impact-${r.impact}"></span>${r.currency} ${r.name}</span>
          <span class="tm">${fmtLocal(r.time)}</span></div>
        <div class="cal-fig">F: <b>${r.forecast||'—'}</b> · P: ${r.previous||'—'}${r.released?` · A: <b>${r.actual||'—'}</b> ${sur}`:''}</div>
      </div>`;
    }
  }
  body.innerHTML=html;
  tickNewsCountdown();
}
function tickNewsCountdown(){
  const el=$('#newsBody .news-next .cd'); if(!el) return;
  const t=new Date(el.dataset.t).getTime(); const diff=t-Date.now();
  if(diff<=0){ el.textContent='now'; return; }
  const h=Math.floor(diff/3600000), m=Math.floor((diff%3600000)/60000);
  el.textContent=(h>0?h+'h ':'')+m+'m';
}
```

- [ ] **Step 3: Poll saat panel terlihat + countdown tiap detik**

Perbarui `setNewsOpen(open)` (Task 6) untuk mengelola timer:
```js
// di cabang if(open) setelah loadNews():
clearInterval(_newsTimer); _newsTimer=setInterval(loadNews, 60000);      // refresh data 60s
clearInterval(_newsCountdown); _newsCountdown=setInterval(tickNewsCountdown, 1000);
// di cabang else (tutup):
clearInterval(_newsTimer); _newsTimer=null;
clearInterval(_newsCountdown); _newsCountdown=null;
```

- [ ] **Step 4: Sinkron ganti instrumen**

Di fungsi pergantian instrumen (hasil Step 1), tambahkan di akhir:
```js
if($('#newspanel') && $('#newspanel').style.display!=='none') loadNews();
```

- [ ] **Step 5: Verifikasi manual di browser**

Jalankan app (skill `run`), login, buka panel News. Amati:
- **Bias card**: menampilkan instrumen aktif + arah (▲/▼/—) berwarna hijau/merah/abu + kalimat playbook + chip "Regime: strong data → USD↑".
- **Next release**: nama rilis high-impact berikut + countdown mundur (mm/hh) yang berjalan tiap detik.
- **Calendar**: daftar rilis USD/High minggu ini; yang sudah rilis ter-highlight + emoji surprise + nilai Actual.
- Ganti instrumen chart ke `EUR_USD` lalu `USD_JPY` → bias card & playbook ikut berubah arah sesuai peran USD.
- Simulasikan feed gagal (mis. matikan jaringan / blokir domain) → empty state "News feed unavailable." + tombol Retry; bila ada cache → badge "Delayed data".
Ambil screenshot bias card untuk XAU_USD dan USD_JPY sebagai bukti arah berbeda.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(news): render bias card, next-release countdown & weekly calendar + instrument sync"
```

---

## Self-Review

**Spec coverage:**
- Economic calendar (fetch/parse/filter) → Task 1 ✅
- Number parsing + surprise + release grouping → Task 2 ✅
- USD lean (Lapis 1) + core tiebreaker → Task 3 ✅
- Instrument bias generalization pairs+DXY+gold (Lapis 2) + playbook + pre-scenario → Task 4 ✅
- Backend endpoint + in-memory cache + stale fallback + JSON shape + nextRelease + regime → Task 5 ✅
- Rail button + panel + toggle radio-with-Markets + persist → Task 6 ✅
- Bias card + next release + calendar list + instrument sync + poll + error/empty states (English) → Task 7 ✅
- Testing (ported classify, bias mapping, calendar parse, handler/cache) → Tasks 1-5 ✅

**Non-goals** (headline feed, BLS, alerts, AI summary, digest) — tidak ada task, sesuai. ✅

**Placeholder scan:** Tidak ada TBD/TODO. Frontend Step yang bergantung pada nama fungsi lokal (`setMarketsHidden`, instrumen aktif) diberi langkah discovery grep eksplisit + fallback konkret — bukan placeholder logika.

**Type consistency:** `Event`, `Release`, `Surprise`, `USDLean`, `Role`, `Bias`, `Verdict` konsisten lintas task. `InstrumentBias(USDLean,Role) Bias`, `Playbook(USDLean,Role,Bias,string)`, `PreScenario(Role,string)`, `buildCalendarResponse(...) calResponse`, `newsCache.get(time.Time)` dipakai sama di definisi & pemanggil. `(Surprise).String()`/`(USDLean).String()`/`(Bias).String()` dipakai di Task 5. `calVerdict`/`calItem`/`calResponse`/`nextRel` konsisten dengan test Task 5.

**Catatan risiko:** feed FaireEconomy hanya minggu berjalan & tak resmi — sudah ditangani cache + stale fallback + parsing defensif. Bias = asumsi rezim (ditampilkan sebagai chip). Frontend `newsCurrentInstrument()`/hook instrumen WAJIB disesuaikan dengan kode nyata di Step 1 Task 7.
