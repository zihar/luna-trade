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
