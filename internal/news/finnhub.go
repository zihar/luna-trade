// Sumber berita Finnhub (market news kategori general/forex/crypto). Gratis,
// rate 60 call/menit. Std-lib only. Impl interface Source.
package news

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// finnhubNewsURL = endpoint market news. Variabel (bukan const) agar test bisa
// mengarahkannya ke httptest.Server.
var finnhubNewsURL = "https://finnhub.io/api/v1/news"

// finnhubMaxAttempts = jumlah percobaan fetch 1 kategori (1 awal + retry).
const finnhubMaxAttempts = 3

// finnhubBackoffBase = jeda awal backoff eksponensial (×2, cap 8s). Variabel (bukan
// const) supaya test bisa mempercepatnya.
var finnhubBackoffBase = 500 * time.Millisecond

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

// httpStatusError = respons non-2xx dari Finnhub, membawa status code agar caller
// bisa memutuskan retry (429/5xx transient) vs menyerah (4xx lain, mis. token salah).
type httpStatusError struct {
	code int
	body string
}

func (e *httpStatusError) Error() string {
	return fmt.Sprintf("finnhub HTTP %d: %s", e.code, e.body)
}

// isRetryable: error transient yang layak retry — error transport/jaringan (bukan
// httpStatusError) atau HTTP 429/5xx. 4xx lain (401/403/404) → tidak.
func isRetryable(err error) bool {
	var se *httpStatusError
	if errors.As(err, &se) {
		return se.code == http.StatusTooManyRequests || se.code >= 500
	}
	return err != nil
}

// doFinnhubRequest menarik 1 kategori (raw body), SATU attempt. client nil = default 20s.
// Non-2xx → *httpStatusError.
func doFinnhubRequest(client *http.Client, token, category string) ([]byte, error) {
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
		return nil, &httpStatusError{code: resp.StatusCode, body: snippet(body)}
	}
	return body, nil
}

// fetchFinnhubCategory = doFinnhubRequest + retry backoff eksponensial (×2, cap 8s)
// pada error transient (jaringan / HTTP 429 / 5xx). 4xx lain → menyerah seketika.
func fetchFinnhubCategory(client *http.Client, token, category string) ([]byte, error) {
	backoff := finnhubBackoffBase
	var lastErr error
	for attempt := 1; attempt <= finnhubMaxAttempts; attempt++ {
		body, err := doFinnhubRequest(client, token, category)
		if err == nil {
			return body, nil
		}
		lastErr = err
		if !isRetryable(err) || attempt == finnhubMaxAttempts {
			break
		}
		time.Sleep(backoff)
		if backoff *= 2; backoff > 8*time.Second {
			backoff = 8 * time.Second
		}
	}
	return nil, lastErr
}

// Fetch menarik semua kategori KONKUREN (fan-out goroutine, ala Aggregate), normalisasi,
// dedup lintas-kategori by ID, sort desc. Sukses bila ≥1 kategori berhasil; panic per
// kategori diisolasi.
func (f Finnhub) Fetch(client *http.Client) ([]Headline, error) {
	cats := f.Categories
	if len(cats) == 0 {
		cats = []string{"general", "forex", "crypto"}
	}
	// Satu client dipakai bersama semua goroutine (reuse koneksi). nil → default 20s.
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}

	type res struct {
		hs  []Headline
		err error
	}
	results := make([]res, len(cats))
	var wg sync.WaitGroup
	for i, c := range cats {
		wg.Add(1)
		go func(i int, c string) {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					results[i] = res{err: fmt.Errorf("panic kategori %s: %v", c, r)}
				}
			}()
			body, err := fetchFinnhubCategory(client, f.Token, c)
			if err != nil {
				results[i] = res{err: err}
				return
			}
			hs, err := NormalizeFinnhub(body)
			results[i] = res{hs: hs, err: err}
		}(i, c)
	}
	wg.Wait()

	var all []Headline
	var lastErr error
	ok := 0
	for _, r := range results {
		if r.err != nil {
			lastErr = r.err
			continue
		}
		ok++
		all = append(all, r.hs...)
	}
	if ok == 0 {
		return nil, fmt.Errorf("finnhub: semua kategori gagal: %w", lastErr)
	}
	all = DedupeMerge(all)
	sort.SliceStable(all, func(i, j int) bool { return all[i].PublishedAt.After(all[j].PublishedAt) })
	return all, nil
}
