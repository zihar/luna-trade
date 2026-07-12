package main

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"luna-trade/internal/news"
)

func TestBuildHeadlinesResponseFilters(t *testing.T) {
	now := time.Date(2026, 7, 12, 9, 0, 0, 0, time.UTC)
	items := []news.Headline{
		{ID: "1", Title: "Gold slips as dollar firms", URL: "https://x/1", PublishedAt: now},
		{ID: "2", Title: "Bitcoin surges past resistance", URL: "https://x/2", PublishedAt: now.Add(time.Hour)},
	}
	resp := buildHeadlinesResponse(items, "XAU_USD", false, now, false)
	if resp.Instrument != "XAU_USD" || resp.Disabled {
		t.Fatalf("bad meta: %+v", resp)
	}
	if len(resp.Headlines) != 1 {
		t.Fatalf("want 1 gold-relevant headline, got %d", len(resp.Headlines))
	}
	if resp.Headlines[0].ID != "1" {
		t.Fatalf("want the gold headline, got %+v", resp.Headlines[0])
	}
}

func TestBuildHeadlinesResponseCaps(t *testing.T) {
	now := time.Date(2026, 7, 12, 9, 0, 0, 0, time.UTC)
	var items []news.Headline
	for i := 0; i < hlMaxItems+10; i++ {
		items = append(items, news.Headline{ID: string(rune('a' + i%26)), Title: "Gold up", URL: "https://x", PublishedAt: now})
	}
	resp := buildHeadlinesResponse(items, "XAU_USD", true, now, false)
	if len(resp.Headlines) != hlMaxItems {
		t.Fatalf("want cap %d, got %d", hlMaxItems, len(resp.Headlines))
	}
	if !resp.Partial {
		t.Fatal("partial flag should propagate")
	}
}

// swrCache[hlPayload]: cold sukses fresh; dalam TTL tak refetch; partial diteruskan.
func TestHeadlineCacheColdThenFresh(t *testing.T) {
	base := time.Date(2026, 7, 12, 9, 0, 0, 0, time.UTC)
	clk := newTestClock(base)
	var calls int32
	c := &swrCache[hlPayload]{ttl: hlTTL, now: clk.now, fetch: func() (hlPayload, error) {
		atomic.AddInt32(&calls, 1)
		return hlPayload{Items: []news.Headline{{ID: "1", Title: "Gold up", URL: "https://x/1", PublishedAt: base}}, Partial: true}, nil
	}}
	p, _, stale, err := c.get()
	if err != nil || stale || len(p.Items) == 0 || !p.Partial {
		t.Fatalf("cold get: n=%d partial=%v stale=%v err=%v", len(p.Items), p.Partial, stale, err)
	}
	clk.set(base.Add(30 * time.Second))
	if _, _, s, _ := c.get(); s {
		t.Fatal("dalam TTL harus fresh")
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("dalam TTL tak boleh refetch, calls=%d", got)
	}
}

// ErrNoSource (tak ada sumber aktif) diteruskan pada cold → handler jadikan disabled.
func TestHeadlineCacheDisabled(t *testing.T) {
	c := &swrCache[hlPayload]{ttl: hlTTL, fetch: func() (hlPayload, error) {
		return hlPayload{}, news.ErrNoSource
	}}
	if _, _, _, err := c.get(); !errors.Is(err, news.ErrNoSource) {
		t.Fatalf("want ErrNoSource passthrough, got %v", err)
	}
}
