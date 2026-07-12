// Endpoint headline feed: agregasi berita multi-sumber (lihat internal/news) + cache
// in-memory (TTL 60s, stale-while-last-good) + filter relevansi per-instrumen.
// Pola mencerminkan news.go (calendar). READ-ONLY.
package main

import (
	"os"
	"sync"
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
