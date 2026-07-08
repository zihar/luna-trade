package main

import (
	"testing"
	"time"

	"luna-trade/internal/news"
)

func sampleEvents(now time.Time) []news.Event {
	return []news.Event{
		{Title: "CPI m/m", Country: "USD", Impact: "High", Time: now.Add(-1 * time.Hour), Forecast: "0.3%", Previous: "0.2%", Actual: "0.5%"},
		{Title: "Non-Farm Employment Change", Country: "USD", Impact: "High", Time: now.Add(3 * time.Hour), Forecast: "180K", Previous: "200K", Actual: ""},
		{Title: "German Orders", Country: "EUR", Impact: "Low", Time: now, Forecast: "1%", Previous: "0%", Actual: "2%"},
	}
}

func TestBuildCalendarResponseGold(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	resp := buildCalendarResponse(sampleEvents(now), "XAU_USD", now, now, false)
	if len(resp.Releases) != 2 {
		t.Fatalf("want 2 USD/High releases, got %d", len(resp.Releases))
	}
	var cpi, nfp *calItem
	for i := range resp.Releases {
		switch resp.Releases[i].Name {
		case "CPI":
			cpi = &resp.Releases[i]
		case "NFP":
			nfp = &resp.Releases[i]
		}
	}
	if cpi == nil || nfp == nil {
		t.Fatalf("missing CPI/NFP release")
	}
	// CPI hot + gold → bearish
	if !cpi.Released || cpi.Verdict.Bias != "bearish" || cpi.Verdict.USDLean != "hawkish" {
		t.Fatalf("CPI verdict wrong: %+v", cpi.Verdict)
	}
	// NFP belum rilis → next release + neutral verdict + scenario playbook
	if nfp.Released {
		t.Fatalf("NFP should be pending")
	}
	if resp.NextRelease == nil || resp.NextRelease.Name != "NFP" || resp.NextRelease.MinsToGo != 180 {
		t.Fatalf("nextRelease wrong: %+v", resp.NextRelease)
	}
	if resp.Regime != "strong-data-hawkish" {
		t.Fatalf("regime label wrong: %s", resp.Regime)
	}
}

func TestBuildCalendarResponseBaseUSD(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	resp := buildCalendarResponse(sampleEvents(now), "USD_JPY", now, now, false)
	for _, it := range resp.Releases {
		if it.Name == "CPI" && it.Verdict.Bias != "bullish" {
			t.Fatalf("CPI hot + USD/JPY → bullish, got %s", it.Verdict.Bias)
		}
	}
}

func TestBuildCalendarResponseIncludesAllUSDHigh(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	events := []news.Event{
		{Title: "CPI m/m", Country: "USD", Impact: "High", Time: now.Add(-2 * time.Hour), Forecast: "0.3%", Previous: "0.2%", Actual: "0.5%"},
		{Title: "ISM Services PMI", Country: "USD", Impact: "High", Time: now.Add(-1 * time.Hour), Forecast: "54.2", Previous: "54.5", Actual: "55.0"},
		{Title: "FOMC Meeting Minutes", Country: "USD", Impact: "High", Time: now.Add(90 * time.Minute), Forecast: "", Previous: "", Actual: ""},
		{Title: "German Orders", Country: "EUR", Impact: "High", Time: now, Forecast: "1%", Previous: "0%", Actual: "2%"},
	}
	resp := buildCalendarResponse(events, "XAU_USD", now, now, false)
	// EUR event filtered out; all 3 USD/High events kept (2 released + 1 pending).
	if len(resp.Releases) != 3 {
		t.Fatalf("want 3 USD/High releases (incl. ISM, FOMC), got %d", len(resp.Releases))
	}
	byName := map[string]*calItem{}
	for i := range resp.Releases {
		byName[resp.Releases[i].Name] = &resp.Releases[i]
	}
	// CPI still produces a directional bias.
	if cpi := byName["CPI"]; cpi == nil || cpi.Verdict.Bias != "bearish" {
		t.Fatalf("CPI should be bearish for gold, got %+v", cpi)
	}
	// Non-indicator USD/High event kept, labeled by its title, neutral bias.
	ism := byName["ISM Services PMI"]
	if ism == nil {
		t.Fatalf("ISM Services PMI should be included as a calendar row")
	}
	if ism.Verdict.Bias != "neutral" {
		t.Fatalf("ISM bias should be neutral, got %s", ism.Verdict.Bias)
	}
	// Next release = nearest FUTURE high-impact event = FOMC (not a distant CPI/NFP).
	if resp.NextRelease == nil || resp.NextRelease.Name != "FOMC Meeting Minutes" || resp.NextRelease.MinsToGo != 90 {
		t.Fatalf("nextRelease should be FOMC in 90m, got %+v", resp.NextRelease)
	}
}

func TestNewsCacheStaleFallback(t *testing.T) {
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	calls := 0
	c := &newsCache{fetch: func() ([]news.Event, error) {
		calls++
		if calls == 1 {
			return sampleEvents(now), nil
		}
		return nil, errFetch
	}}
	// 1st: live ok
	ev, _, stale, err := c.get(now)
	if err != nil || stale || len(ev) == 0 {
		t.Fatalf("first get should be live ok")
	}
	// within TTL: no refetch
	if _, _, _, _ = c.get(now.Add(1 * time.Minute)); calls != 1 {
		t.Fatalf("within TTL should not refetch, calls=%d", calls)
	}
	// after TTL: refetch fails → serve stale last-good
	ev, _, stale, err = c.get(now.Add(11 * time.Minute))
	if err != nil || !stale || len(ev) == 0 {
		t.Fatalf("after TTL fail should serve stale, err=%v stale=%v", err, stale)
	}
}
