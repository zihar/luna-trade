package news

import "testing"

func TestParseNumber(t *testing.T) {
	cases := []struct {
		in   string
		want float64
		ok   bool
	}{
		{"0.3%", 0.3, true}, {"85K", 85000, true}, {"-92K", -92000, true},
		{"1.4", 1.4, true}, {"<0.1%", 0.1, true}, {"1,234", 1234, true},
		{"", 0, false}, {"n/a", 0, false},
	}
	for _, c := range cases {
		v, ok := ParseNumber(c.in)
		if ok != c.ok || (ok && v != c.want) {
			t.Errorf("ParseNumber(%q) = %v,%v; want %v,%v", c.in, v, ok, c.want, c.ok)
		}
	}
}

func TestClassifySurprise(t *testing.T) {
	above := classifySurprise(Event{Forecast: "0.3%", Actual: "0.4%"})
	if above != SurpriseAbove {
		t.Errorf("want Above, got %v", above)
	}
	below := classifySurprise(Event{Forecast: "180K", Actual: "150K"})
	if below != SurpriseBelow {
		t.Errorf("want Below, got %v", below)
	}
	inline := classifySurprise(Event{Forecast: "0.3%", Actual: "0.3%"})
	if inline != SurpriseInline {
		t.Errorf("want Inline, got %v", inline)
	}
	unk := classifySurprise(Event{Forecast: "0.3%", Actual: ""})
	if unk != SurpriseUnknown {
		t.Errorf("want Unknown, got %v", unk)
	}
}

func TestGroupReleasesAndKind(t *testing.T) {
	ev, _ := ParseCalendar([]byte(sampleFeed))
	rel := GroupReleases(FilterUSDHighImpact(ev), nil)
	if len(rel) != 2 {
		t.Fatalf("want 2 releases (CPI, NFP), got %d", len(rel))
	}
	byName := map[string]Release{}
	for _, r := range rel {
		byName[r.Name] = r
	}
	if byName["CPI"].Kind != KindInflation {
		t.Errorf("CPI should be KindInflation")
	}
	if byName["NFP"].Kind != KindJobs {
		t.Errorf("NFP should be KindJobs")
	}
	if !byName["CPI"].AnyReleased() {
		t.Errorf("CPI should be released in sample")
	}
	if byName["NFP"].AnyReleased() {
		t.Errorf("NFP should not be released in sample")
	}
}

func TestGroupReleasesByCurrencyNoCrossMerge(t *testing.T) {
	name := func(title string) string {
		if n := DefaultName(title); n != "" {
			return n
		}
		return title
	}
	// US CPI & UK CPI: DefaultName keduanya "CPI" → TANPA partisi currency akan tergabung.
	ev := []Event{
		{Title: "CPI m/m", Country: "USD", Impact: "High"},
		{Title: "CPI y/y", Country: "GBP", Impact: "High"},
	}
	rels := GroupReleasesByCurrency(ev, name)
	if len(rels) != 2 {
		t.Fatalf("want 2 releases (US CPI + UK CPI kept separate), got %d", len(rels))
	}
}
