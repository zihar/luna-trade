package main

import (
	"errors"
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

func TestHeadlineCacheStaleFallback(t *testing.T) {
	now := time.Date(2026, 7, 12, 9, 0, 0, 0, time.UTC)
	calls := 0
	c := &hlCache{fetch: func() ([]news.Headline, bool, error) {
		calls++
		if calls == 1 {
			return []news.Headline{{ID: "1", Title: "Gold up", URL: "https://x/1", PublishedAt: now}}, false, nil
		}
		return nil, false, errors.New("boom")
	}}
	// 1st: live ok
	items, _, _, stale, err := c.get(now)
	if err != nil || stale || len(items) == 0 {
		t.Fatalf("first get should be live ok, err=%v stale=%v n=%d", err, stale, len(items))
	}
	// within TTL: no refetch
	if _, _, _, _, _ = c.get(now.Add(30 * time.Second)); calls != 1 {
		t.Fatalf("within TTL should not refetch, calls=%d", calls)
	}
	// after TTL: refetch fails → serve stale last-good
	items, _, _, stale, err = c.get(now.Add(2 * time.Minute))
	if err != nil || !stale || len(items) == 0 {
		t.Fatalf("after TTL fail should serve stale, err=%v stale=%v", err, stale)
	}
}

func TestHeadlineCacheDisabled(t *testing.T) {
	now := time.Date(2026, 7, 12, 9, 0, 0, 0, time.UTC)
	c := &hlCache{fetch: func() ([]news.Headline, bool, error) {
		return nil, false, news.ErrNoSource
	}}
	if _, _, _, _, err := c.get(now); !errors.Is(err, news.ErrNoSource) {
		t.Fatalf("want ErrNoSource passthrough, got %v", err)
	}
}
