package main

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// get miss lalu hit dalam TTL, lalu expired.
func TestCandleCacheGetSetTTL(t *testing.T) {
	c := newCandleCache(8)
	if _, _, ok := c.get("k"); ok {
		t.Fatalf("empty cache should miss")
	}
	c.set("k", []byte("body"), 200, 50*time.Millisecond)
	body, status, ok := c.get("k")
	if !ok || string(body) != "body" || status != 200 {
		t.Fatalf("hit: body=%q status=%d ok=%v", body, status, ok)
	}
	// tunggu lewat TTL → expired
	time.Sleep(70 * time.Millisecond)
	if _, _, ok := c.get("k"); ok {
		t.Fatalf("entry should expire after TTL")
	}
}

// fetch menggabungkan request identik yang barengan → loader dipanggil sekali.
func TestCandleCacheSingleflight(t *testing.T) {
	c := newCandleCache(8)
	var calls int32
	loader := func() ([]byte, int, error) {
		atomic.AddInt32(&calls, 1)
		time.Sleep(30 * time.Millisecond) // beri waktu goroutine lain menempel
		return []byte("shared"), 200, nil
	}

	const N = 50
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			body, status, err := c.fetch("herd", time.Second, loader)
			if err != nil || string(body) != "shared" || status != 200 {
				t.Errorf("fetch: body=%q status=%d err=%v", body, status, err)
			}
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("loader should run once for concurrent identical keys, ran %d", got)
	}
	// hasil ter-cache → fetch berikut tak panggil loader lagi
	if _, _, err := c.fetch("herd", time.Second, loader); err != nil {
		t.Fatalf("cached fetch: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("cached fetch should not call loader, calls=%d", got)
	}
}

// error dari loader tidak di-cache (tak membekukan kegagalan).
func TestCandleCacheDoesNotCacheError(t *testing.T) {
	c := newCandleCache(8)
	var calls int32
	loader := func() ([]byte, int, error) {
		atomic.AddInt32(&calls, 1)
		return nil, 0, errors.New("boom")
	}
	if _, _, err := c.fetch("bad", time.Second, loader); err == nil {
		t.Fatalf("expected error")
	}
	// panggil lagi → loader jalan lagi (tak di-cache)
	if _, _, err := c.fetch("bad", time.Second, loader); err == nil {
		t.Fatalf("expected error second time")
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("error must not be cached, loader calls=%d want 2", got)
	}
}

// non-200 tidak di-cache (mis. rate limit / error OANDA), meski err nil.
func TestCandleCacheDoesNotCacheNon200(t *testing.T) {
	c := newCandleCache(8)
	var calls int32
	loader := func() ([]byte, int, error) {
		atomic.AddInt32(&calls, 1)
		return []byte("rate limited"), 429, nil
	}
	if _, status, _ := c.fetch("rl", time.Second, loader); status != 429 {
		t.Fatalf("want status 429")
	}
	if _, _, _ = c.fetch("rl", time.Second, loader); atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("non-200 must not be cached, calls=%d want 2", atomic.LoadInt32(&calls))
	}
}

// eviction FIFO: melebihi kapasitas membuang entri terlama.
func TestCandleCacheEvictFIFO(t *testing.T) {
	c := newCandleCache(2)
	c.set("a", []byte("A"), 200, time.Minute)
	c.set("b", []byte("B"), 200, time.Minute)
	c.set("c", []byte("C"), 200, time.Minute) // usir "a"
	if _, _, ok := c.get("a"); ok {
		t.Fatalf("oldest entry 'a' should be evicted")
	}
	if _, _, ok := c.get("b"); !ok {
		t.Fatalf("'b' should still be present")
	}
	if _, _, ok := c.get("c"); !ok {
		t.Fatalf("'c' should be present")
	}
}
