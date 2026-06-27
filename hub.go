// Hub = broadcaster harga realtime. Menjamin TEPAT SATU koneksi upstream ke
// broker (PriceStream) berapa pun jumlah klien SSE: upstream di-start lazy saat
// subscriber pertama (0→1) dan dihentikan saat subscriber terakhir pergi (1→0,
// dengan linger singkat). Tiap tick disalin (fan-out) ke semua subscriber.
package main

import (
	"context"
	"log"
	"sync"
	"time"
)

// stopLinger = jeda sebelum upstream dimatikan setelah subscriber habis, supaya
// reload/buka-tutup tab cepat tak memicu reconnect upstream berulang.
const stopLinger = 5 * time.Second

type Hub struct {
	conn  Connector
	insts []Instrument

	mu        sync.Mutex
	subs      map[chan Tick]struct{}
	cancel    context.CancelFunc // != nil → upstream sedang jalan
	stopTimer *time.Timer
}

func newHub(conn Connector, insts []Instrument) *Hub {
	return &Hub{conn: conn, insts: insts, subs: map[chan Tick]struct{}{}}
}

// Subscribe mendaftarkan klien baru & mengembalikan channel tick miliknya.
// Upstream OANDA distart HANYA saat ini transisi 0→1 subscriber.
func (h *Hub) Subscribe() chan Tick {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.stopTimer != nil { // batalkan rencana stop — ada peminat lagi
		h.stopTimer.Stop()
		h.stopTimer = nil
	}
	ch := make(chan Tick, 32)
	h.subs[ch] = struct{}{}

	if h.cancel == nil { // 0→1: baru di sini upstream dibuka (satu-satunya)
		ctx, cancel := context.WithCancel(context.Background())
		h.cancel = cancel
		go h.runUpstream(ctx)
		log.Printf("pricing hub: upstream START (%d instrumen)", len(h.insts))
	}
	return ch
}

// Unsubscribe melepas klien. Saat subscriber habis (1→0), upstream dijadwalkan
// berhenti setelah stopLinger.
func (h *Hub) Unsubscribe(ch chan Tick) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.subs[ch]; !ok {
		return
	}
	delete(h.subs, ch)
	close(ch)

	if len(h.subs) == 0 && h.cancel != nil && h.stopTimer == nil {
		h.stopTimer = time.AfterFunc(stopLinger, func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			if len(h.subs) == 0 && h.cancel != nil {
				h.cancel()
				h.cancel = nil
				h.stopTimer = nil
				log.Printf("pricing hub: upstream STOP (tak ada subscriber)")
			}
		})
	}
}

// runUpstream membaca SATU stream broker dan menyebarkannya ke semua subscriber.
func (h *Hub) runUpstream(ctx context.Context) {
	in := make(chan Tick, 64)
	go func() {
		err := h.conn.PriceStream(ctx, h.insts, in)
		close(in)
		if err != nil && ctx.Err() == nil {
			log.Printf("pricing hub: upstream berhenti tak terduga: %v", err)
		}
	}()
	for t := range in {
		h.broadcast(t)
	}
}

// broadcast menyalin satu tick ke semua subscriber tanpa blocking: klien lambat
// (buffer penuh) di-skip ticknya, tak menahan upstream maupun klien lain.
func (h *Hub) broadcast(t Tick) {
	h.mu.Lock()
	for ch := range h.subs {
		select {
		case ch <- t:
		default:
		}
	}
	h.mu.Unlock()
}
