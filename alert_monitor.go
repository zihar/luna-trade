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

// levelAt = level alert pada waktu `now`.
// Alert harga biasa (An nil) → kolom price. Alert garis → interpolasi dua anchor, dan sengaja
// diekstrapolasi di luar ruasnya: trader menggambar trendline justru untuk mengawasi apa yang
// terjadi SESUDAH titik terakhir, jadi alert yang mati di ujung ruas berhenti bekerja tepat saat
// paling dibutuhkan. Garis horizontal (p1==p2) jatuh ke rumus yang sama dan memberi konstanta —
// tak ada cabang "kalau horizontal maka…".
func levelAt(r AlertRow, now int64) float64 {
	if r.An == nil || r.An.T2 == r.An.T1 {
		return r.Price
	}
	f := float64(now-r.An.T1) / float64(r.An.T2-r.An.T1)
	return r.An.P1 + (r.An.P2-r.An.P1)*f
}

// condHit menerjemahkan kondisi pengguna jadi keputusan menyala/tidak.
// `cross` memakai crossed() yang sudah ada (dua arah, termasuk sentuh tepat); `up`/`down` adalah
// separuhnya masing-masing.
func condHit(cond string, prev, cur, lvl float64) bool {
	switch cond {
	case "up":
		return prev < lvl && cur >= lvl
	case "down":
		return prev > lvl && cur <= lvl
	default:
		return crossed(prev, cur, lvl)
	}
}

// crossedByLevelMove menangani hal yang tak bisa dilihat dgn membandingkan harga saja: harga DIAM
// sementara GARISNYA yang bergerak melewatinya. Tanpa ini, trendline curam bisa menyeberangi harga
// di antara dua tick dan tak pernah menyalakan alert.
func crossedByLevelMove(prevLvl, curLvl, price float64) bool {
	return (prevLvl < price && curLvl >= price) || (prevLvl > price && curLvl <= price)
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
		lastLvl := map[int64]float64{}
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
				hitAny := false
				now := time.Now().UnixMilli()
				for _, a := range cache {
					if !strings.EqualFold(a.Instrument, string(t.Instrument)) {
						continue
					}
					lvl := levelAt(a, now)
					hit := condHit(a.Cond, prev, mid, lvl)
					// Garis miring: level bergerak sendiri, jadi ia bisa menyeberangi harga yang
					// diam. Butuh level pada tick SEBELUMNYA untuk melihatnya.
					if !hit && a.An != nil {
						if pv, ok := lastLvl[a.ID]; ok && crossedByLevelMove(pv, lvl, mid) {
							hit = true
						}
					}
					lastLvl[a.ID] = lvl
					if hit {
						if err := store.MarkAlertTriggered(a.ID, now); err == nil {
							log.Printf("alert monitor: triggered #%d %s @ %.5f (level %.5f, cond %s)", a.ID, a.Instrument, mid, lvl, a.Cond)
							hitAny = true
						}
					}
				}
				if hitAny {
					reload() // ada yg triggered → segarkan cache (one-shot)
				}
			}
		}
	}()
}
