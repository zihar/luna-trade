// Cache in-memory stale-while-revalidate + persist snapshot (SQLite) untuk feed
// News (kalender & headlines). Generik atas tipe payload T (mis. []news.Event /
// []news.Headline) supaya kedua feed berbagi satu implementasi konkuren yang teruji.
//
// Perilaku get():
//   - terisi & fresh (umur < ttl)   → serve, stale=false.
//   - terisi & basi  (umur ≥ ttl)   → serve last-good SEKETIKA (stale=true) +
//     refresh async di background (anti-herd: flag `refreshing` + singleflight).
//   - kosong (cold, belum sukses)   → fetch sinkron SEKALI (singleflight menggabung
//     pemanggil konkuren); gagal → error (perilaku 503 lama dipertahankan).
//
// Persist: tiap fetch sukses menyimpan snapshot JSON ke tabel news_snapshot; saat
// boot warm() memuatnya (fetchedAt lama) → request pertama pasca-restart langsung
// serve stale + memicu refresh, tanpa cold-block/503.
package main

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// swrCache = cache SWR generik. Buat via literal: &swrCache[T]{ttl, key, fetch}.
type swrCache[T any] struct {
	mu         sync.Mutex
	data       T
	fetchedAt  time.Time
	ok         bool // pernah sukses (atau di-warm dari snapshot) minimal sekali
	refreshing bool // ada goroutine refresh async berjalan
	sf         singleflight.Group
	ttl        time.Duration
	key        string           // key persist ("calendar"/"headlines"); "" → tak persist
	now        func() time.Time // clock injectable (nil → time.Now UTC); dipakai stamp & staleness
	fetch      func() (T, error)
}

type swrSnap[T any] struct {
	data      T
	fetchedAt time.Time
}

// clock = waktu acuan (UTC); disuntik lewat field now untuk test.
func (c *swrCache[T]) clock() time.Time {
	if c.now != nil {
		return c.now()
	}
	return time.Now().UTC()
}

// get lihat komentar file.
func (c *swrCache[T]) get() (data T, fetchedAt time.Time, stale bool, err error) {
	now := c.clock()
	c.mu.Lock()
	ok, d, fa, refreshing := c.ok, c.data, c.fetchedAt, c.refreshing
	c.mu.Unlock()

	if ok {
		stale = now.Sub(fa) >= c.ttl
		if stale && !refreshing {
			c.mu.Lock()
			if !c.refreshing { // re-check di bawah lock (hindari spawn ganda)
				c.refreshing = true
				go func() {
					defer func() {
						c.mu.Lock()
						c.refreshing = false
						c.mu.Unlock()
					}()
					c.fetchAndStore() // hasil diabaikan; gagal → last-good tetap
				}()
			}
			c.mu.Unlock()
		}
		return d, fa, stale, nil
	}

	// cold: fetch sinkron (satu kali warm), singleflight menggabung pemanggil konkuren.
	s, ferr := c.fetchAndStore()
	if ferr != nil {
		// pemanggil lain mungkin sempat mengisi di sela
		c.mu.Lock()
		ok2, d2, fa2 := c.ok, c.data, c.fetchedAt
		c.mu.Unlock()
		if ok2 {
			return d2, fa2, now.Sub(fa2) >= c.ttl, nil
		}
		var zero T
		return zero, time.Time{}, false, ferr
	}
	return s.data, s.fetchedAt, now.Sub(s.fetchedAt) >= c.ttl, nil
}

// fetchAndStore memanggil fetch (via singleflight, key konstan), lalu simpan ke
// cache + persist bila sukses. Dipakai jalur cold (sinkron) & refresh (async).
func (c *swrCache[T]) fetchAndStore() (swrSnap[T], error) {
	v, err, _ := c.sf.Do("x", func() (interface{}, error) {
		d, e := c.fetch()
		if e != nil {
			return swrSnap[T]{}, e
		}
		t := c.clock()
		c.mu.Lock()
		c.data, c.fetchedAt, c.ok = d, t, true
		c.mu.Unlock()
		c.persist(d, t)
		return swrSnap[T]{data: d, fetchedAt: t}, nil
	})
	return v.(swrSnap[T]), err
}

// loadSnapshot mengisi cache dari snapshot (warm-start). Tidak menimpa bila sudah terisi.
func (c *swrCache[T]) loadSnapshot(d T, fetchedAt time.Time) {
	c.mu.Lock()
	if !c.ok {
		c.data, c.fetchedAt, c.ok = d, fetchedAt, true
	}
	c.mu.Unlock()
}

// persist menyimpan snapshot JSON ke SQLite (best-effort; tak menggagalkan request).
func (c *swrCache[T]) persist(d T, fetchedAt time.Time) {
	if store == nil || c.key == "" {
		return
	}
	payload, err := json.Marshal(d)
	if err != nil {
		log.Printf("news: marshal snapshot %s: %v", c.key, err)
		return
	}
	if err := store.SaveNewsSnapshot(c.key, string(payload), fetchedAt); err != nil {
		log.Printf("news: persist snapshot %s: %v", c.key, err)
	}
}

// warm memuat snapshot dari SQLite ke cache saat boot (dipanggil setelah openStore).
func (c *swrCache[T]) warm() {
	if store == nil || c.key == "" {
		return
	}
	payload, fetchedAt, ok := store.LoadNewsSnapshot(c.key)
	if !ok {
		return
	}
	var d T
	if err := json.Unmarshal([]byte(payload), &d); err != nil {
		log.Printf("news: warm snapshot %s: %v", c.key, err)
		return
	}
	c.loadSnapshot(d, fetchedAt)
	log.Printf("news: warm cache %s dari snapshot (fetchedAt=%s)", c.key, fetchedAt.Format(time.RFC3339))
}
