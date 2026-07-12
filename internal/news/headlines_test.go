package news

import (
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestCanonicalURL(t *testing.T) {
	cases := map[string]string{
		"https://Example.com/a?utm_source=x&id=5#frag": "https://example.com/a?id=5",
		"https://example.com/a/":                       "https://example.com/a",
		"https://example.com/a?gclid=1":                "https://example.com/a",
	}
	for in, want := range cases {
		if got := CanonicalURL(in); got != want {
			t.Errorf("CanonicalURL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDedupeMergePrefersSummary(t *testing.T) {
	in := []Headline{
		{URL: "https://ex.com/x?utm_source=a", Title: "T", Summary: ""},
		{URL: "https://ex.com/x", Title: "T", Summary: "detail"},
	}
	out := DedupeMerge(in)
	if len(out) != 1 {
		t.Fatalf("want 1 merged, got %d", len(out))
	}
	if out[0].Summary != "detail" {
		t.Fatalf("merged should keep non-empty summary, got %q", out[0].Summary)
	}
	if out[0].ID == "" {
		t.Fatal("merged headline must have stable ID")
	}
}

func TestMatchesWrapper(t *testing.T) {
	m := RelevanceFor("XAU_USD")
	if !m.Matches(Headline{Title: "Gold hits record", Summary: ""}) {
		t.Fatal("Matches wrapper should delegate to matches()")
	}
}

// fakeSource = Source palsu utk menguji Aggregate tanpa jaringan.
type fakeSource struct {
	name    string
	enabled bool
	items   []Headline
	err     error
}

func (f fakeSource) Name() string { return f.name }
func (f fakeSource) Enabled() bool { return f.enabled }
func (f fakeSource) Fetch(*http.Client) ([]Headline, error) { return f.items, f.err }

func TestAggregateMergesAndSorts(t *testing.T) {
	t0 := time.Date(2026, 7, 12, 9, 0, 0, 0, time.UTC)
	a := fakeSource{name: "a", enabled: true, items: []Headline{
		{URL: "https://x.com/1", Title: "old", PublishedAt: t0},
		{URL: "https://x.com/2", Title: "new", PublishedAt: t0.Add(time.Hour)},
	}}
	// sumber b memuat duplikat /2 (tanpa summary) + gagal? tidak, sukses.
	b := fakeSource{name: "b", enabled: true, items: []Headline{
		{URL: "https://x.com/2?utm_source=b", Title: "new", PublishedAt: t0.Add(time.Hour)},
	}}
	out, partial, err := Aggregate([]Source{a, b}, nil)
	if err != nil || partial {
		t.Fatalf("want ok non-partial, got err=%v partial=%v", err, partial)
	}
	if len(out) != 2 {
		t.Fatalf("want 2 after dedupe, got %d", len(out))
	}
	if out[0].Title != "new" {
		t.Fatalf("want newest first, got %q", out[0].Title)
	}
}

func TestAggregatePartialOnOneFailure(t *testing.T) {
	ok := fakeSource{name: "ok", enabled: true, items: []Headline{{URL: "https://x.com/1", Title: "t"}}}
	bad := fakeSource{name: "bad", enabled: true, err: errors.New("boom")}
	out, partial, err := Aggregate([]Source{ok, bad}, nil)
	if err != nil {
		t.Fatalf("one failure should not error, got %v", err)
	}
	if !partial {
		t.Fatal("want partial=true when a source fails")
	}
	if len(out) != 1 {
		t.Fatalf("want 1 from surviving source, got %d", len(out))
	}
}

func TestAggregateNoSource(t *testing.T) {
	_, _, err := Aggregate([]Source{fakeSource{name: "off", enabled: false}}, nil)
	if !errors.Is(err, ErrNoSource) {
		t.Fatalf("want ErrNoSource, got %v", err)
	}
}

func TestAggregateAllFail(t *testing.T) {
	bad := fakeSource{name: "bad", enabled: true, err: errors.New("boom")}
	_, _, err := Aggregate([]Source{bad}, nil)
	if err == nil || errors.Is(err, ErrNoSource) {
		t.Fatalf("all-fail should error (not ErrNoSource), got %v", err)
	}
}

// panicSource = Source yang Fetch-nya panic — menguji isolasi panic Aggregate.
type panicSource struct{ name string }

func (p panicSource) Name() string                          { return p.name }
func (p panicSource) Enabled() bool                         { return true }
func (p panicSource) Fetch(*http.Client) ([]Headline, error) { panic("boom") }

func TestAggregateIsolatesPanic(t *testing.T) {
	ok := fakeSource{name: "ok", enabled: true, items: []Headline{{URL: "https://x.com/1", Title: "t"}}}
	out, partial, err := Aggregate([]Source{panicSource{name: "boom"}, ok}, nil)
	if err != nil {
		t.Fatalf("panicking source should be isolated, not error: %v", err)
	}
	if !partial {
		t.Fatal("want partial=true when a source panics")
	}
	if len(out) != 1 || out[0].Title != "t" {
		t.Fatalf("surviving source's headline should remain, got %+v", out)
	}
}
