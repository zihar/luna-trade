package news

import (
	"testing"
	"time"
)

func rel(kind Kind, ev ...Event) Release {
	return Release{Name: "X", Kind: kind, Time: time.Unix(0, 0).UTC(), Events: ev}
}

func TestClassifyHawkishDovish(t *testing.T) {
	// CPI hot (above) → hawkish
	v := rel(KindInflation, Event{Title: "CPI m/m", Forecast: "0.3%", Actual: "0.5%"}).Classify()
	if v.Lean != LeanHawkish || v.Surprise != SurpriseAbove {
		t.Fatalf("CPI hot: want hawkish/above, got %v/%v", v.Lean, v.Surprise)
	}
	// NFP miss (below) → dovish
	v = rel(KindJobs, Event{Title: "Non-Farm Employment Change", Forecast: "180K", Actual: "120K"}).Classify()
	if v.Lean != LeanDovish {
		t.Fatalf("NFP miss: want dovish, got %v", v.Lean)
	}
}

func TestClassifyCoreTiebreaker(t *testing.T) {
	// headline m/m inline, core m/m above → Tilt hawkish
	v := rel(KindInflation,
		Event{Title: "CPI m/m", Forecast: "0.3%", Actual: "0.3%"},
		Event{Title: "Core CPI m/m", Forecast: "0.2%", Actual: "0.4%"},
	).Classify()
	if v.Lean != LeanNeutral {
		t.Fatalf("headline inline → Lean neutral, got %v", v.Lean)
	}
	if v.Tilt != LeanHawkish || v.Tiebreak == "" {
		t.Fatalf("core above → Tilt hawkish + reason, got %v %q", v.Tilt, v.Tiebreak)
	}
}
