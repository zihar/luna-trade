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
