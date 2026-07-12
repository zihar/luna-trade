package main

import (
	"testing"
	"time"
)

func TestNewsSnapshotRoundTrip(t *testing.T) {
	s := mustTestStore(t)
	fetchedAt := time.Date(2026, 7, 12, 9, 30, 0, 0, time.UTC)

	// belum ada → ok=false
	if _, _, ok := s.LoadNewsSnapshot("calendar"); ok {
		t.Fatal("snapshot kosong harus ok=false")
	}

	if err := s.SaveNewsSnapshot("calendar", `[{"Title":"CPI"}]`, fetchedAt); err != nil {
		t.Fatalf("save: %v", err)
	}
	payload, gotAt, ok := s.LoadNewsSnapshot("calendar")
	if !ok || payload != `[{"Title":"CPI"}]` || !gotAt.Equal(fetchedAt) {
		t.Fatalf("load: payload=%q at=%v ok=%v", payload, gotAt, ok)
	}

	// upsert: key sama menimpa
	newAt := fetchedAt.Add(time.Hour)
	if err := s.SaveNewsSnapshot("calendar", `[{"Title":"NFP"}]`, newAt); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	payload, gotAt, _ = s.LoadNewsSnapshot("calendar")
	if payload != `[{"Title":"NFP"}]` || !gotAt.Equal(newAt) {
		t.Fatalf("upsert not applied: payload=%q at=%v", payload, gotAt)
	}

	// key berbeda terpisah
	if _, _, ok := s.LoadNewsSnapshot("headlines"); ok {
		t.Fatal("key 'headlines' harus terpisah dari 'calendar'")
	}
}
