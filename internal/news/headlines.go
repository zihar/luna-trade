// Package news — bagian headline feed (agregasi berita pasar multi-sumber).
// Model Headline provider-agnostik; tiap Source menormalisasi payload-nya sendiri.
// Std-lib only, senada calendar.go. READ-ONLY.
package news

import (
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
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
