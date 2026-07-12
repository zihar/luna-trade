package main

import (
	"errors"
	"sync"
	"sync/atomic"
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

func TestBuildCalendarIncludesMedium(t *testing.T) {
	now := time.Date(2026, 7, 8, 10, 0, 0, 0, time.UTC)
	events := []news.Event{
		{Title: "CPI m/m", Country: "USD", Impact: "High", Time: now.Add(48 * time.Hour), Forecast: "0.3%", Previous: "0.2%"},
		{Title: "ISM Services PMI", Country: "USD", Impact: "Medium", Time: now.Add(2 * time.Hour), Forecast: "53.1", Previous: "52.8"},
		{Title: "German Factory Orders", Country: "EUR", Impact: "Medium", Time: now.Add(time.Hour)},
	}
	resp := buildCalendarResponse(events, "XAU_USD", now, now, false)

	var sawMedium bool
	for _, it := range resp.Releases {
		if it.Currency != "USD" {
			t.Fatalf("non-USD leaked into releases: %+v", it)
		}
		if it.Impact == "Medium" {
			sawMedium = true
		}
	}
	if !sawMedium {
		t.Fatalf("expected a Medium USD release in response, got %d releases", len(resp.Releases))
	}
}

func TestBuildCalendarMultiCurrency(t *testing.T) {
	now := time.Date(2026, 7, 8, 10, 0, 0, 0, time.UTC)
	events := []news.Event{
		// USD CPI rilis, surprise di atas → seharusnya berarah (non-neutral) utk GBP_USD
		{Title: "CPI m/m", Country: "USD", Impact: "High", Time: now.Add(-2 * time.Hour), Forecast: "0.3%", Previous: "0.2%", Actual: "0.5%"},
		// UK CPI rilis panas (3.4% > 3.1%) → GBP menguat → GBP_USD (GBP=base) → bullish
		{Title: "CPI y/y", Country: "GBP", Impact: "High", Time: now.Add(-time.Hour), Forecast: "3.1%", Previous: "3.0%", Actual: "3.4%"},
		// EUR event: TIDAK relevan utk GBP_USD → tak muncul
		{Title: "German Factory Orders", Country: "EUR", Impact: "Medium", Time: now.Add(-3 * time.Hour), Actual: "1.0%"},
	}
	resp := buildCalendarResponse(events, "GBP_USD", now, now, false)

	var sawUSD, sawGBP bool
	for _, it := range resp.Releases {
		if it.Currency == "EUR" {
			t.Fatalf("EUR event leaked into GBP_USD response")
		}
		if it.Currency == "USD" {
			sawUSD = true
			if it.Verdict.Bias == "neutral" {
				t.Fatalf("USD directional release should have non-neutral bias, got neutral")
			}
		}
		if it.Currency == "GBP" {
			sawGBP = true
			// non-USD kini berarah: UK CPI panas → GBP menguat → GBP_USD bullish
			if it.Verdict.Bias != "bullish" {
				t.Fatalf("hot UK CPI → GBP up → GBP_USD bullish, got %q", it.Verdict.Bias)
			}
		}
	}
	if !sawUSD || !sawGBP {
		t.Fatalf("want both USD and GBP releases; sawUSD=%v sawGBP=%v (n=%d)", sawUSD, sawGBP, len(resp.Releases))
	}
}

// testClock = clock atomik (unix-nano) yang aman dibaca dari goroutine refresh.
type testClock struct{ ns atomic.Int64 }

func newTestClock(t time.Time) *testClock { c := &testClock{}; c.ns.Store(t.UnixNano()); return c }
func (c *testClock) now() time.Time       { return time.Unix(0, c.ns.Load()).UTC() }
func (c *testClock) set(t time.Time)      { c.ns.Store(t.UnixNano()) }

// cold fetch sinkron sukses → serve fresh; dalam TTL tak refetch.
func TestSWRColdThenFresh(t *testing.T) {
	base := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	clk := newTestClock(base)
	var calls int32
	c := &swrCache[[]news.Event]{ttl: calTTL, now: clk.now, fetch: func() ([]news.Event, error) {
		atomic.AddInt32(&calls, 1)
		return sampleEvents(base), nil
	}}
	ev, _, stale, err := c.get()
	if err != nil || stale || len(ev) == 0 {
		t.Fatalf("cold get: ev=%d stale=%v err=%v", len(ev), stale, err)
	}
	clk.set(base.Add(time.Minute))
	if _, _, s, _ := c.get(); s {
		t.Fatal("dalam TTL harus fresh (stale=false)")
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("dalam TTL tak boleh refetch, calls=%d", got)
	}
}

// cold fetch gagal (belum pernah sukses) → error (perilaku 503 lama).
func TestSWRColdFailErr(t *testing.T) {
	c := &swrCache[[]news.Event]{ttl: calTTL, fetch: func() ([]news.Event, error) {
		return nil, errors.New("boom")
	}}
	if _, _, _, err := c.get(); err == nil {
		t.Fatal("cold fetch gagal harus return err")
	}
}

// setelah TTL: serve last-good SEKETIKA (stale=true) + refresh async.
func TestSWRServeStaleThenRefreshAsync(t *testing.T) {
	base := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	clk := newTestClock(base)
	release := make(chan struct{})
	called := make(chan struct{}, 8)
	c := &swrCache[[]news.Event]{ttl: calTTL, now: clk.now, fetch: func() ([]news.Event, error) {
		called <- struct{}{}
		<-release // fetch diblok sampai test mengizinkan
		return sampleEvents(base), nil
	}}
	// warm last-good (ok=true) di base → get pertama fresh, tanpa fetch sinkron
	c.loadSnapshot(sampleEvents(base), base)

	clk.set(base.Add(calTTL + time.Minute)) // majukan clock → basi

	// stale get harus KEMBALI SEKETIKA meski refresh diblok
	done := make(chan struct{})
	go func() {
		ev, _, stale, err := c.get()
		if err != nil || !stale || len(ev) == 0 {
			t.Errorf("stale get harus serve last-good seketika: stale=%v err=%v n=%d", stale, err, len(ev))
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("get() memblok menunggu refresh — SWR harus serve seketika")
	}
	// refresh async harus terpicu
	select {
	case <-called:
	case <-time.After(2 * time.Second):
		t.Fatal("refresh async tak terpicu")
	}
	close(release) // lepaskan refresh
}

// banyak get konkuren yang basi → cuma SATU refresh berjalan (anti-herd).
func TestSWRAntiHerd(t *testing.T) {
	base := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	clk := newTestClock(base)
	var fetches int32
	started := make(chan struct{}, 64)
	gate := make(chan struct{})
	c := &swrCache[[]news.Event]{ttl: calTTL, now: clk.now, fetch: func() ([]news.Event, error) {
		atomic.AddInt32(&fetches, 1)
		started <- struct{}{}
		<-gate // tahan refresh selama batch berjalan
		return sampleEvents(base), nil
	}}
	// warm (ok=true) dengan fetchedAt lama → semua get langsung basi
	c.loadSnapshot(sampleEvents(base), base.Add(-time.Hour))

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); c.get() }()
	}
	wg.Wait() // semua get kembali seketika (stale served), tak menunggu refresh
	<-started // tepat satu refresh dimulai
	if got := atomic.LoadInt32(&fetches); got != 1 {
		t.Fatalf("anti-herd: want 1 refresh, got %d", got)
	}
	close(gate)
}
