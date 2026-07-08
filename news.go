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
	Released bool       `json:"released"`
	Forecast string     `json:"forecast"`
	Previous string     `json:"previous"`
	Actual   string     `json:"actual"`
	Verdict  calVerdict `json:"verdict"`
}

type nextRel struct {
	Name     string `json:"name"`
	Currency string `json:"currency"`
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
	// Tampilkan event High+Medium untuk mata uang relevan instrumen (kedua sisi pasangan;
	// metal/DXY → USD saja). Bias ARAH hanya dihitung untuk event USD (engine Fase 1);
	// event non-USD tampil informasional (verdict netral). Panel News & marker berbagi ini.
	nameOf := func(title string) string {
		if n := news.DefaultName(title); n != "" {
			return n
		}
		return strings.TrimSpace(title)
	}
	currencies := news.RelevantCurrencies(instrument)
	releases := news.GroupReleasesByCurrency(news.FilterEvents(events, currencies, "High", "Medium"), nameOf)
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
			if h.Impact != "" {
				it.Impact = h.Impact
			}
			if h.Country != "" {
				it.Currency = h.Country
			}
		}
		if it.Released {
			if strings.EqualFold(it.Currency, "USD") {
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
				// Lite: event non-USD tampil tanpa arah.
				it.Verdict = calVerdict{Surprise: "unknown", USDLean: "neutral", Bias: "neutral", Label: "released"}
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
					Currency: it.Currency,
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
