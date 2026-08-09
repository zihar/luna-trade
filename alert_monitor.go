// Monitor price alert server-side untuk semua user. Subscribe ke Hub harga dan
// menandai alert triggered saat harga menyentuh/melewati level target — tetap
// jalan walau tak ada browser (mirror paper_monitor.go).
package main

import (
	"log"
	"math"
	"strings"
	"time"
)

// crossed: true bila level lvl dilewati/disentuh antara harga prev→cur (dua arah,
// termasuk sentuh tepat).
func crossed(prev, cur, lvl float64) bool {
	return (prev < lvl && cur >= lvl) || (prev > lvl && cur <= lvl)
}

// levelAt = level alert pada waktu `now`.
//
// Alert harga biasa (An nil) → kolom price. Alert garis → interpolasi dua anchor dalam JAM DAGANG
// (session.go), bukan waktu kalender: sumbu-x chart linear dalam indeks bar, jadi menginterpolasi
// dalam wall-clock membuat garis miring berjalan 28,6% lebih cepat daripada garis yang digambar.
// Garis horizontal (p1==p2) jatuh ke rumus yang sama dan memberi konstanta apa pun basis waktunya —
// itulah sebab v1 (#180) aman meski memakai wall-clock.
//
// Sengaja diekstrapolasi di luar ruas anchornya: trader menggambar trendline justru untuk mengawasi
// apa yang terjadi SESUDAH titik terakhir, jadi alert yang mati di ujung ruas berhenti bekerja tepat
// saat paling dibutuhkan. Penjagaan "garis yang belum mulai" ada di evalAlert, bukan di sini.
func levelAt(r AlertRow, now int64) float64 {
	if r.An == nil || r.An.T2 == r.An.T1 {
		return r.Price
	}
	an := *r.An
	// Garis boleh digambar kanan ke kiri. Frontend sudah menormalkan, tapi baris alert bisa datang
	// dari muatan lama atau klien lain — monitor tak boleh bergantung pada disiplin pengirim untuk
	// sesuatu yang sebiaya satu perbandingan.
	if an.T2 < an.T1 {
		an.T1, an.P1, an.T2, an.P2 = an.T2, an.P2, an.T1, an.P1
	}
	span := tradingElapsed(r.Instrument, an.T1, an.T2)
	if span == 0 {
		// Kedua anchor di dalam jendela pasar-tutup yang sama (mis. digambar di area future saat
		// akhir pekan). Bekukan di anchor pertama: untuk garis horizontal itu jawaban yang benar,
		// untuk garis miring itu yang paling tak berbahaya.
		return an.P1
	}
	f := float64(tradingElapsed(r.Instrument, an.T1, now)) / float64(span)
	return an.P1 + (an.P2-an.P1)*f
}

// zoneBounds = batas bawah & atas pita pada waktu `now`.
//
// Batas pertama memakai levelAt apa adanya, jadi jam-dagang, ekstrapolasi ke kanan, normalisasi
// anchor terbalik, dan penjagaan span-nol semuanya diwarisi tanpa satu baris pun kode baru — zona
// miring bergerak persis seperti garis miring. Urutan dinormalkan supaya pOff negatif memberi pita
// yang sama dengan pOff positif yang dinyatakan dari sisi seberangnya.
func zoneBounds(r AlertRow, now int64) (lo, hi float64) {
	base := levelAt(r, now)
	other := base + r.An.POff
	return math.Min(base, other), math.Max(base, other)
}

// sideHit memutuskan alert menyala atau tidak dari PERUBAHAN TANDA jarak harga-ke-level,
// d = harga − level. Satu uji untuk dua gerakan sekaligus: harga bergerak melewati garis yang diam,
// DAN garis bergerak melewati harga yang diam — keduanya sama-sama membalik tanda d.
//
// Ini menggantikan dua predikat lama (condHit + crossedByLevelMove) yang masing-masing salah:
//   - condHit membandingkan harga SEBELUMNYA terhadap level SEKARANG. Saat level melompat antar
//     tick (pengguna menyeret garisnya, proses lanjut sesudah jeda, perangkat lain memindahkannya),
//     itu mengarang persilangan yang tak pernah terjadi;
//   - jalur "level bergerak" menyalakan alert tanpa melihat a.Cond sama sekali, jadi alert `up`
//     menyala saat garis bergerak TURUN melewati harga yang diam (dan sebaliknya) — dan karena
//     alert bersifat one-shot, persilangan yang sungguhan lalu tak pernah bisa menyala lagi.
//
// `cross` sengaja memakai ulang crossed() dgn ambang 0: "d berpindah sisi" adalah persilangan yang
// sama persis, cuma dinyatakan pada sumbu selisih.
func sideHit(cond string, dPrev, dCur float64) bool {
	switch cond {
	case "up":
		return dPrev < 0 && dCur >= 0
	case "down":
		return dPrev > 0 && dCur <= 0
	default:
		return crossed(dPrev, dCur, 0)
	}
}

// lvlEntry menyimpan level yang pernah dihitung utk sebuah alert garis BESERTA anchor
// yang menghasilkannya. Anchor ikut disimpan supaya baseline basi tak pernah dipakai:
// hanya level yang berasal dari anchor yang SAMA dgn yang berlaku sekarang yang valid.
type lvlEntry struct {
	an     LineAnchors
	lvl    float64
	inside bool // keadaan pita pada tick itu; hanya berarti untuk alert zona (cond enter/exit)
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

// prevInside = keadaan "harga di dalam pita" pada tick sebelumnya, dengan syarat kesegaran yang
// PERSIS sama dengan prevLevel: anchor harus belum berubah. Karena POff ikut di dalam LineAnchors,
// mengubah lebar zona otomatis membatalkan baseline — kalau tidak, menyeret sisi zona bisa terbaca
// sebagai harga masuk/keluar pita, cacat yang sama bentuknya dengan yang dibayar #180 untuk level.
func (lt levelTracker) prevInside(id int64, an LineAnchors) (bool, bool) {
	e, ok := lt[id]
	if !ok || e.an != an {
		return false, false
	}
	return e.inside, true
}

// recordZone menyimpan level DAN keadaan pita sekaligus. Alert zona tak memakai `lvl` untuk
// memutuskan apa pun, tapi ia tetap dicatat supaya satu entry cukup untuk kedua keluarga alert.
func (lt levelTracker) recordZone(id int64, an LineAnchors, lvl float64, inside bool) {
	lt[id] = lvlEntry{an: an, lvl: lvl, inside: inside}
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

// evalAlert mengevaluasi satu alert pada satu tick: menghitung levelnya sekarang, membandingkan
// SISI harga terhadap level di tick sebelumnya vs sekarang, lalu memperbarui bookkeeping level
// per-alert. Dipisah dari loop goroutine supaya bisa dites langsung tanpa Hub/DB.
//
// Sisi SEBELUMNYA dihitung terhadap level SEBELUMNYA (dari tracker, anchor yang sama), bukan
// terhadap level sekarang: itulah satu-satunya cara "harga bergerak" dan "garis bergerak" jadi satu
// pertanyaan yang jujur. Alert harga biasa punya prevLvl == lvl == price, jadi perilakunya identik
// dgn sebelumnya.
//
// Tanpa baseline yang sah (belum ada entry, atau anchornya berubah sejak tick terakhir) evaluasi
// DILEWATI sama sekali. Menebak dgn memakai level sekarang sbg pengganti level sebelumnya persis
// yang membuat reposisi garis oleh pengguna sendiri terbaca sbg persilangan; tak menyalakan apa pun
// pada satu tick adalah jawaban yang jujur — tick berikutnya sudah punya baseline.
func evalAlert(a AlertRow, prev, cur float64, now int64, lvlTrack levelTracker) (lvl float64, hit bool) {
	lvl = levelAt(a, now)
	prevLvl := lvl
	if a.An != nil {
		// Garis yang seluruhnya masih di masa depan tak diawasi: satu-satunya cara mendapat
		// levelnya sekarang adalah mengekstrapolasi ke KIRI, ke bagian garis yang tak digambar
		// siapa pun. Bukan penonaktifan — begitu waktu melewati anchor pertama, ia hidup sendiri.
		// Kedua anchor diperiksa (bukan cuma T1) supaya benar juga saat anchornya terbalik.
		if now < a.An.T1 && now < a.An.T2 {
			return lvl, false
		}
		// ZONA: yang diuji bukan persilangan satu level, melainkan perpindahan keadaan luar↔dalam
		// pita. Bedanya nyata — harga bisa masuk pita lewat batas ATAS tanpa pernah menyentuh batas
		// pertama, dan sebaliknya bisa melintasi batas pertama sambil tetap berada di luar pita.
		//
		// Keadaan sebelumnya diambil dari tracker, bukan dihitung ulang dari harga lama terhadap
		// batas sekarang: pelajaran #180 — membandingkan harga lama dengan level baru mengarang
		// lintasan setiap kali batasnya melompat (pengguna menyeret zonanya, proses lanjut sesudah
		// jeda, perangkat lain memindahkannya).
		if a.Cond == "enter" || a.Cond == "exit" {
			lo, hi := zoneBounds(a, now)
			inNow := cur >= lo && cur <= hi
			prevIn, ok := lvlTrack.prevInside(a.ID, *a.An)
			lvlTrack.recordZone(a.ID, *a.An, lvl, inNow)
			if !ok {
				return lvl, false
			}
			if a.Cond == "enter" {
				return lvl, !prevIn && inNow
			}
			return lvl, prevIn && !inNow
		}
		pv, ok := lvlTrack.prevLevel(a.ID, *a.An)
		lvlTrack.record(a.ID, *a.An, lvl) // dicatat lebih dulu: tick berikutnya butuh baseline ini juga saat tick INI dilewati
		if !ok {
			return lvl, false
		}
		prevLvl = pv
	}
	return lvl, sideHit(a.Cond, prev-prevLvl, cur-lvl)
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
