// Endpoint headline feed: agregasi berita multi-sumber (lihat internal/news) + cache
// in-memory (TTL 60s, stale-while-last-good) + filter relevansi per-instrumen.
// Pola mencerminkan news.go (calendar). READ-ONLY.
package main

import (
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"luna-trade/internal/news"
)

const hlMaxItems = 30

const hlTTL = 60 * time.Second

// hlSources = registry sumber berita. Tambah sumber baru = tambah satu baris di sini.
func hlSources() []news.Source {
	return []news.Source{
		news.Finnhub{Token: os.Getenv("FINNHUB_TOKEN")},
		// news.RSS{...},        // nanti (zero-key)
		// news.Marketaux{...},  // nanti (butuh key)
	}
}

// hlPayload = payload cache headlines (items + flag partial dari Aggregate).
// Field exported agar aman di-JSON untuk persist snapshot.
type hlPayload struct {
	Items   []news.Headline `json:"items"`
	Partial bool            `json:"partial"`
}

// headlineCache = cache SWR headlines (serve-stale + refresh async + persist snapshot).
var headlineCache = &swrCache[hlPayload]{
	ttl: hlTTL,
	key: "headlines",
	fetch: func() (hlPayload, error) {
		items, partial, err := news.Aggregate(hlSources(), nil)
		return hlPayload{Items: items, Partial: partial}, err
	},
}

// handleNewsHeadlines melayani GET /api/news/headlines?instrument=XAU_USD.
func handleNewsHeadlines(w http.ResponseWriter, r *http.Request) {
	instrument := strings.TrimSpace(r.URL.Query().Get("instrument"))
	if instrument == "" {
		instrument = "XAU_USD"
	}
	p, fetchedAt, stale, err := headlineCache.get()
	if err != nil {
		if errors.Is(err, news.ErrNoSource) {
			writeJSON(w, http.StatusOK, hlResponse{Disabled: true, Instrument: instrument, Headlines: []hlItem{}})
			return
		}
		writeErr(w, http.StatusServiceUnavailable, "Headlines unavailable")
		return
	}
	writeJSON(w, http.StatusOK, buildHeadlinesResponse(p.Items, instrument, p.Partial, fetchedAt, stale))
}

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
