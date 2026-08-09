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
// di antara dua tick dan tak pernah menyalakan alert. Predikatnya sama persis dgn crossed() — bedanya
// cuma makna argumen (level yang bergerak vs harga yang diam) — nama terpisah dipertahankan karena
// di titik pemanggilan itulah yang memberi tahu pembaca APA yang sedang diperiksa menyeberang.
func crossedByLevelMove(prevLvl, curLvl, price float64) bool {
	return crossed(prevLvl, curLvl, price)
}

// lvlEntry menyimpan level yang pernah dihitung utk sebuah alert garis BESERTA anchor
// yang menghasilkannya. Anchor ikut disimpan supaya baseline basi tak pernah dipakai:
// hanya level yang berasal dari anchor yang SAMA dgn yang berlaku sekarang yang valid.
type lvlEntry struct {
	an  LineAnchors
	lvl float64
}

// levelTracker adalah bookkeeping level SEBELUMNYA per-alert (bukan per-instrumen — dua
// alert pada instrumen yang sama bisa punya garis berbeda). Dipisah jadi tipe kecil
// dgn fungsinya sendiri supaya bisa dites langsung tanpa menyentuh goroutine monitor.
type levelTracker map[int64]lvlEntry

// prevLevel mengembalikan level tersimpan utk alert `id`, HANYA bila anchor yang
// menghasilkannya (saat direkam) masih SAMA dgn `an` sekarang. Anchor berbeda berarti
// garis sudah digeser sejak tick terakhir — men-drag garis adalah interaksi UTAMA fitur
// ini, dan level dari posisi lama tak boleh dibandingkan seakan itu posisi yang sama;
// kalau tidak, reposisi garis oleh pengguna sendiri bisa terbaca sbg "level menyeberangi
// harga" yang palsu.
func (lt levelTracker) prevLevel(id int64, an LineAnchors) (float64, bool) {
	e, ok := lt[id]
	if !ok || e.an != an {
		return 0, false
	}
	return e.lvl, true
}

// record menyimpan level alert garis beserta anchor sumbernya, supaya tick berikutnya
// bisa memverifikasi anchor belum berubah sebelum memakainya (lihat prevLevel). Alert
// harga biasa sengaja tak lewat sini — dipanggil hanya saat An != nil oleh evalAlert.
func (lt levelTracker) record(id int64, an LineAnchors, lvl float64) {
	lt[id] = lvlEntry{an: an, lvl: lvl}
}

// prune membuang entry milik alert yang sudah tak aktif lagi (triggered atau dihapus
// user), supaya peta tak tumbuh tanpa batas — proses ini didesain hidup lama tanpa
// browser sama sekali terbuka.
func (lt levelTracker) prune(active map[int64]bool) {
	for id := range lt {
		if !active[id] {
			delete(lt, id)
		}
	}
}

// evalAlert mengevaluasi satu alert pada satu tick: menghitung levelnya sekarang,
// memutuskan apakah kondisinya menyala (lewat pergerakan harga ATAU lewat pergerakan
// garis), lalu memperbarui bookkeeping level per-alert. Dipisah dari loop goroutine
// supaya bisa dites langsung tanpa Hub/DB.
func evalAlert(a AlertRow, prev, cur float64, now int64, lvlTrack levelTracker) (lvl float64, hit bool) {
	lvl = levelAt(a, now)
	hit = condHit(a.Cond, prev, cur, lvl)
	if a.An == nil {
		return lvl, hit // alert harga biasa: tak pernah butuh bookkeeping level
	}
	if !hit {
		// Garis miring: level bergerak sendiri, jadi ia bisa menyeberangi harga yang
		// diam. Butuh level pada tick SEBELUMNYA (dari anchor yang SAMA) utk melihatnya.
		if pv, ok := lvlTrack.prevLevel(a.ID, *a.An); ok && crossedByLevelMove(pv, lvl, cur) {
			hit = true
		}
	}
	lvlTrack.record(a.ID, *a.An, lvl)
	return lvl, hit
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
		lvlTrack := levelTracker{}
		reload := func() {
			rows, err := store.AllActiveAlerts()
			if err != nil {
				log.Printf("alert monitor: reload gagal: %v", err)
				return
			}
			cache = rows
			active := make(map[int64]bool, len(rows))
			for _, r := range rows {
				active[r.ID] = true
			}
			lvlTrack.prune(active) // alert yg triggered/dihapus sejak reload terakhir: buang bookkeeping-nya
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
				hitAny := false
				now := time.Now().UnixMilli()
				for _, a := range cache {
					if !strings.EqualFold(a.Instrument, string(t.Instrument)) {
						continue
					}
					lvl, hit := evalAlert(a, prev, mid, now, lvlTrack)
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
