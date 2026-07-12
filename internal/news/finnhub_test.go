package news

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// withFinnhubTestServer mengarahkan finnhubNewsURL ke handler test, backoff dipercepat.
func withFinnhubTestServer(t *testing.T, h http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(h)
	oldURL, oldBackoff := finnhubNewsURL, finnhubBackoffBase
	finnhubNewsURL = srv.URL
	finnhubBackoffBase = time.Millisecond
	t.Cleanup(func() {
		finnhubNewsURL, finnhubBackoffBase = oldURL, oldBackoff
		srv.Close()
	})
	return srv
}

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

// 429 lalu 200 → sukses setelah retry (transient di-retry).
func TestFetchFinnhubCategoryRetriesOn429(t *testing.T) {
	var hits int32
	withFinnhubTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&hits, 1) == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		fmt.Fprint(w, `[{"datetime":1752310800,"headline":"H","source":"S","url":"https://r.com/a"}]`)
	})
	body, err := fetchFinnhubCategory(nil, "tok", "general")
	if err != nil {
		t.Fatalf("want success after retry, got %v", err)
	}
	if got := atomic.LoadInt32(&hits); got != 2 {
		t.Fatalf("want 2 hits (1 fail + 1 retry ok), got %d", got)
	}
	if hs, _ := NormalizeFinnhub(body); len(hs) != 1 {
		t.Fatalf("want 1 headline, got %d", len(hs))
	}
}

// 401 (token salah) → menyerah SEKETIKA tanpa retry.
func TestFetchFinnhubCategoryNoRetryOn401(t *testing.T) {
	var hits int32
	withFinnhubTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusUnauthorized)
	})
	if _, err := fetchFinnhubCategory(nil, "bad", "general"); err == nil {
		t.Fatal("want error on 401")
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("401 must not retry: want 1 hit, got %d", got)
	}
}

// 5xx terus → menyerah setelah finnhubMaxAttempts.
func TestFetchFinnhubCategoryGivesUpAfterMaxAttempts(t *testing.T) {
	var hits int32
	withFinnhubTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusBadGateway)
	})
	if _, err := fetchFinnhubCategory(nil, "tok", "general"); err == nil {
		t.Fatal("want error after exhausting retries")
	}
	if got := atomic.LoadInt32(&hits); got != int32(finnhubMaxAttempts) {
		t.Fatalf("want %d attempts, got %d", finnhubMaxAttempts, got)
	}
}

// Fetch menarik banyak kategori KONKUREN, dedupe lintas-kategori by ID, sort desc.
func TestFinnhubFetchParallelDedupeSort(t *testing.T) {
	withFinnhubTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("category") {
		case "general":
			// item lama + item duplikat (URL sama dgn forex) tanpa summary
			fmt.Fprint(w, `[
				{"datetime":1752310800,"headline":"Old","source":"S","url":"https://r.com/old"},
				{"datetime":1752314400,"headline":"Dup","source":"S","summary":"","url":"https://r.com/dup"}
			]`)
		case "forex":
			// item baru + duplikat (URL sama) yang PUNYA summary → menang saat merge
			fmt.Fprint(w, `[
				{"datetime":1752320000,"headline":"New","source":"S","url":"https://r.com/new"},
				{"datetime":1752314400,"headline":"Dup","source":"S","summary":"has summary","url":"https://r.com/dup"}
			]`)
		default:
			fmt.Fprint(w, `[]`)
		}
	})
	hs, err := (Finnhub{Token: "tok", Categories: []string{"general", "forex", "crypto"}}).Fetch(nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	// 4 mentah − 1 duplikat = 3 unik
	if len(hs) != 3 {
		t.Fatalf("want 3 unique headlines, got %d: %+v", len(hs), hs)
	}
	// sort desc by PublishedAt → New (paling baru) di depan, Old paling belakang
	if hs[0].Title != "New" || hs[len(hs)-1].Title != "Old" {
		t.Fatalf("bad sort order: %+v", hs)
	}
	// merge duplikat: entry ber-summary menang
	for _, h := range hs {
		if h.Title == "Dup" && h.Summary != "has summary" {
			t.Fatalf("dedupe should keep summary: %+v", h)
		}
	}
}

// ≥1 kategori sukses → Fetch tetap sukses (semantik lama dipertahankan).
func TestFinnhubFetchPartialSuccess(t *testing.T) {
	withFinnhubTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("category") == "general" {
			fmt.Fprint(w, `[{"datetime":1752310800,"headline":"OK","source":"S","url":"https://r.com/ok"}]`)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
	})
	hs, err := (Finnhub{Token: "tok"}).Fetch(nil)
	if err != nil {
		t.Fatalf("≥1 kategori sukses harus sukses, got %v", err)
	}
	if len(hs) != 1 || hs[0].Title != "OK" {
		t.Fatalf("want 1 headline OK, got %+v", hs)
	}
}
