// Monitor SL/TP server-side untuk posisi paper. Subscribe ke Hub harga dan
// auto-close posisi saat harga menyentuh Stop Loss / Take Profit — tetap jalan
// walau tak ada browser (subscribe permanen menjaga upstream OANDA hidup).
package main

import (
	"log"
	"strings"
	"time"
)

// startPaperMonitor menjalankan goroutine tunggal yang memantau harga & menutup
// posisi paper ber-SL/TP. Aman dipanggil sekali saat startup (lihat main.go).
func startPaperMonitor() {
	if hub == nil || store == nil {
		return
	}
	go func() {
		ch := hub.Subscribe() // permanen: jaga upstream tetap streaming
		defer hub.Unsubscribe(ch)

		// Cache posisi ber-SL/TP di-refresh berkala supaya tak query DB tiap tick.
		var cache []PaperOpenSLTP
		reload := func() {
			c, err := store.AllOpenPaperSLTP()
			if err != nil {
				log.Printf("paper monitor: reload gagal: %v", err)
				return
			}
			cache = c
		}
		reload()
		refresh := time.NewTicker(2 * time.Second)
		defer refresh.Stop()

		log.Printf("paper monitor: SL/TP server-side aktif")
		for {
			select {
			case <-refresh.C:
				reload()
			case t, ok := <-ch:
				if !ok {
					return
				}
				if checkPaperSLTP(t, cache) {
					reload() // ada yg ditutup → segarkan cache
				}
			}
		}
	}()
}

// checkPaperSLTP menutup posisi pada instrumen tick bila harga menyentuh SL/TP.
// long dinilai di bid, short di ask (mirror markPrice). Balikan true bila ada
// yang ditutup (agar pemanggil me-reload cache).
func checkPaperSLTP(t Tick, cache []PaperOpenSLTP) bool {
	closedAny := false
	for _, p := range cache {
		if !strings.EqualFold(p.Instrument, string(t.Instrument)) {
			continue
		}
		var exit float64
		hit := false
		if p.Dir == "long" {
			if t.Bid <= 0 { // harga bid belum valid → jangan picu
				continue
			}
			if p.SL != nil && t.Bid <= *p.SL {
				exit, hit = *p.SL, true
			} else if p.TP != nil && t.Bid >= *p.TP {
				exit, hit = *p.TP, true
			}
		} else { // short
			if t.Ask <= 0 {
				continue
			}
			if p.SL != nil && t.Ask >= *p.SL {
				exit, hit = *p.SL, true
			} else if p.TP != nil && t.Ask <= *p.TP {
				exit, hit = *p.TP, true
			}
		}
		if !hit {
			continue
		}
		pnl := pnlUSD(p.Instrument, p.Dir, p.Entry, exit, p.Units)
		exitTime := time.Now().UTC().Format(time.RFC3339)
		if _, err := store.ClosePaperTrade(p.UserID, p.ID, exit, pnl, exitTime); err != nil {
			continue // kemungkinan sudah ditutup manual — abaikan (guard di SQL)
		}
		log.Printf("paper monitor: auto-close #%d %s %s @ %.5f pnl=%.2f", p.ID, p.Instrument, p.Dir, exit, pnl)
		closedAny = true
	}
	return closedAny
}
