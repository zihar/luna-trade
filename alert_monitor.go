// Monitor price alert server-side untuk semua user. Subscribe ke Hub harga dan
// menandai alert triggered saat harga menyentuh/melewati level target — tetap
// jalan walau tak ada browser (mirror paper_monitor.go).
package main

import (
	"log"
	"strings"
	"time"
)

// crossed: true bila level lvl dilewati/disentuh antara harga prev→cur (dua arah,
// termasuk sentuh tepat).
func crossed(prev, cur, lvl float64) bool {
	return (prev < lvl && cur >= lvl) || (prev > lvl && cur <= lvl)
}

// startAlertMonitor menjalankan goroutine tunggal yang memantau harga & menandai
// price alert triggered (one-shot). Aman dipanggil sekali saat startup (lihat main.go).
func startAlertMonitor() {
	if hub == nil || store == nil {
		return
	}
	go func() {
		ch := hub.Subscribe() // permanen: jaga upstream tetap streaming
		defer hub.Unsubscribe(ch)

		// Cache alert aktif di-refresh berkala supaya tak query DB tiap tick.
		var cache []AlertRow
		reload := func() {
			rows, err := store.AllActiveAlerts()
			if err != nil {
				log.Printf("alert monitor: reload gagal: %v", err)
				return
			}
			cache = rows
		}
		reload()
		refresh := time.NewTicker(2 * time.Second)
		defer refresh.Stop()

		last := map[Instrument]float64{}
		log.Printf("alert monitor: price alert server-side aktif")
		for {
			select {
			case <-refresh.C:
				reload()
			case t, ok := <-ch:
				if !ok {
					return
				}
				if t.Bid <= 0 || t.Ask <= 0 {
					continue
				}
				mid := (t.Bid + t.Ask) / 2
				prev, seen := last[t.Instrument]
				last[t.Instrument] = mid
				if !seen {
					continue // tick pertama instrumen ini: belum ada prev utk deteksi cross
				}
				hit := false
				for _, a := range cache {
					if !strings.EqualFold(a.Instrument, string(t.Instrument)) {
						continue
					}
					if crossed(prev, mid, a.Price) {
						if err := store.MarkAlertTriggered(a.ID, time.Now().UnixMilli()); err == nil {
							log.Printf("alert monitor: triggered #%d %s @ %.5f (level %.5f)", a.ID, a.Instrument, mid, a.Price)
							hit = true
						}
					}
				}
				if hit {
					reload() // ada yg triggered → segarkan cache (one-shot)
				}
			}
		}
	}()
}
