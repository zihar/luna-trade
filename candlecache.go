// Cache in-memory untuk response /api/candles (lihat docs/candle-cache-plan.md).
//
// Tujuan: saat banyak user membuka instrumen+timeframe yang sama berbarengan
// (mis. saat news event), jangan sampai puluhan fetch identik menghantam OANDA
// sekaligus (rate limit ~120 req/s/token + spike bandwidth). Cache menyimpan
// byte JSON mentah apa adanya (handler cuma me-relay), jadi format ke frontend
// tak berubah — nol parsing.
//
// Dua lapis:
//  1. map + RWMutex — simpan body + status + waktu expiry (TTL sebagai CAP).
//  2. singleflight — request key-sama yang datang barengan digabung jadi SATU
//     fetch upstream; sisanya menunggu hasil yang sama (anti thundering-herd).
package main

import (
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

type cacheEntry struct {
	body    []byte
	status  int // status code upstream (relay apa adanya)
	expires time.Time
}

type candleCache struct {
	mu    sync.RWMutex
	m     map[string]cacheEntry
	order []string // FIFO utk eviction saat melebihi max
	sf    singleflight.Group
	max   int // cap jumlah entry
}

func newCandleCache(max int) *candleCache {
	if max < 1 {
		max = 1
	}
	return &candleCache{m: make(map[string]cacheEntry), max: max}
}

// get mengembalikan entry bila ada & belum kedaluwarsa.
func (c *candleCache) get(key string) ([]byte, int, bool) {
	c.mu.RLock()
	e, ok := c.m[key]
	c.mu.RUnlock()
	if !ok || time.Now().After(e.expires) {
		return nil, 0, false
	}
	return e.body, e.status, true
}

// set menyimpan entry + evict terlama (FIFO) bila melebihi kapasitas.
func (c *candleCache) set(key string, body []byte, status int, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.m[key]; !exists {
		c.order = append(c.order, key)
		// usir entri terlama sampai kembali dalam kapasitas
		for len(c.order) > c.max {
			oldest := c.order[0]
			c.order = c.order[1:]
			delete(c.m, oldest)
		}
	}
	c.m[key] = cacheEntry{body: body, status: status, expires: time.Now().Add(ttl)}
}

// fetch mengembalikan hasil ter-cache; bila miss, loader dipanggil SEKALI
// (via singleflight) untuk semua pemanggil konkuren dengan key sama. Hanya
// response sukses (status 200, err nil) yang di-cache — jangan bekukan
// kegagalan (error/rate-limit).
func (c *candleCache) fetch(key string, ttl time.Duration, loader func() ([]byte, int, error)) ([]byte, int, error) {
	if body, status, ok := c.get(key); ok {
		return body, status, nil
	}
	v, err, _ := c.sf.Do(key, func() (interface{}, error) {
		// cek ulang: pemanggil yang menunggu bisa jadi sudah terisi
		if body, status, ok := c.get(key); ok {
			return cacheEntry{body: body, status: status}, nil
		}
		body, status, err := loader()
		if err != nil {
			return nil, err
		}
		if status == 200 {
			c.set(key, body, status, ttl)
		}
		return cacheEntry{body: body, status: status}, nil
	})
	if err != nil {
		return nil, 0, err
	}
	e := v.(cacheEntry)
	return e.body, e.status, nil
}
