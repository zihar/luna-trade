// Fitur News (Fase 1): endpoint kalender ekonomi + directional bias per-instrumen.
// Sumber: feed publik Forex Factory (tanpa API key), logika di internal/news.
// Cache feed in-memory (fan-out satu fetch ke semua user), TTL menghormati
// rate-limit feed (maks 2 unduh / 5 menit). READ-ONLY.
package main

import (
	"net/http"
	"sort"
	"strings"
	"time"

	"luna-trade/internal/news"
)

// calTTL = umur cache feed. ≥ 5 menit untuk menghormati limit feed (2 unduh/5mnt).
const calTTL = 10 * time.Minute

// calCache = cache SWR kalender (serve-stale + refresh async + persist snapshot).
// fetch injectable untuk test via literal swrCache.
var calCache = &swrCache[[]news.Event]{
	ttl:   calTTL,
	key:   "calendar",
	fetch: func() ([]news.Event, error) { return news.FetchCalendar(nil) },
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
	// Tampilkan event High+Medium untuk mata uang relevan instrumen (kedua sisi pasangan;
	// metal/DXY → USD saja). Bias ARAH dihitung untuk SEMUA currency event (USD & non-USD)
	// via SideOf/BiasFrom — currency di sisi base/quote pasangan (atau gold/DXY-USD) beri arah.
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
		// Sisi currency EVENT terhadap instrumen (generalisasi lintas-currency): USD & non-USD
		// (GBP/EUR/JPY/…) sama-sama dapat arah selama currency-nya bagian pasangan / gold-USD / DXY.
		side := news.SideOf(instrument, it.Currency)
		if it.Released {
			v := rel.Classify()
			bias := news.BiasFrom(v.Lean, side)
			it.Verdict = calVerdict{
				Surprise: v.Surprise.String(),
				USDLean:  v.Lean.String(),
				Bias:     bias.String(),
				Label:    v.Label,
				Playbook: news.PlaybookFor(v.Lean, side, bias, it.Currency, instrument),
				Tiebreak: v.Tiebreak,
			}
		} else {
			it.Verdict = calVerdict{
				Surprise: "unknown",
				USDLean:  "neutral",
				Bias:     "neutral",
				Label:    "awaiting release",
				Playbook: news.PreScenarioFor(side, it.Currency, instrument),
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
	events, fetchedAt, stale, err := calCache.get()
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "News feed unavailable")
		return
	}
	writeJSON(w, http.StatusOK, buildCalendarResponse(events, instrument, now, fetchedAt, stale))
}
