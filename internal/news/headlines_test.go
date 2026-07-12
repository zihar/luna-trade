package news

import (
	"testing"
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
