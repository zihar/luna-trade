package main

import (
	"math"
	"testing"
	"time"
)

func TestCrossed(t *testing.T) {
	cases := []struct {
		a, b, lvl float64
		want      bool
	}{
		{1.10, 1.20, 1.15, true},  // naik melintas
		{1.20, 1.10, 1.15, true},  // turun melintas
		{1.10, 1.12, 1.15, false}, // tak sampai
		{1.20, 1.18, 1.15, false}, // tak sampai
		{1.10, 1.15, 1.15, true},  // sentuh tepat (naik)
		{1.20, 1.15, 1.15, true},  // sentuh tepat (turun)
	}
	for i, c := range cases {
		if got := crossed(c.a, c.b, c.lvl); got != c.want {
			t.Errorf("case %d crossed(%v,%v,%v)=%v want %v", i, c.a, c.b, c.lvl, got, c.want)
		}
	}
}

func TestMonitorOneShot(t *testing.T) {
	s := mustTestStore(t)
	id, _ := s.CreateAlert(1, "EUR_USD", 1.15, 1000, "", "", nil)
	_ = id
	// simulasikan langkah inti monitor tanpa Hub: prev→cur melintas → MarkAlertTriggered sekali
	rows, _ := s.AllActiveAlerts()
	if len(rows) != 1 {
		t.Fatalf("want 1 active")
	}
	if crossed(1.10, 1.20, rows[0].Price) {
		s.MarkAlertTriggered(rows[0].ID, 2000)
	}
	rows2, _ := s.AllActiveAlerts()
	if len(rows2) != 0 {
		t.Fatalf("one-shot: harus 0 aktif setelah trigger, got %d", len(rows2))
	}
}

// Garis miring: level berubah menurut waktu, dan dievaluasi sbg perpanjangan TAK HINGGA —
// sebelum t1 dan sesudah t2 pun tetap punya nilai.
func TestLevelAtSloped(t *testing.T) {
	r := AlertRow{An: &LineAnchors{T1: 1000, P1: 1.10, T2: 2000, P2: 1.20}}
	cases := []struct {
		now  int64
		want float64
	}{
		{1000, 1.10}, {1500, 1.15}, {2000, 1.20},
		{3000, 1.30}, // ekstrapolasi ke depan
		{0, 1.00},    // ekstrapolasi ke belakang
	}
	for _, c := range cases {
		if got := levelAt(r, c.now); got < c.want-1e-9 || got > c.want+1e-9 {
			t.Fatalf("levelAt(%d)=%v mau %v", c.now, got, c.want)
		}
	}
}

// Regresi UTAMA spec garis miring: level tak boleh melompat sebesar akhir pekan.
//
// Anchor sengaja dipilih di dua hari kerja BERURUTAN (Kamis 09:00 → Jumat 09:00) supaya ruas
// garisnya sendiri tak memuat jeda pasar: 24 jam dagang = 24 jam wall-clock, jadi kemiringannya
// tepat 0,0001 per jam dagang dan angka harapan di bawah bisa dibaca langsung.
func TestLevelAtSlopedLintasAkhirPekan(t *testing.T) {
	kamis09 := nyMs(t, 2026, time.January, 8, 9, 0)
	jumat09 := nyMs(t, 2026, time.January, 9, 9, 0)
	senin09 := nyMs(t, 2026, time.January, 12, 9, 0)
	r := AlertRow{
		Instrument: "EUR_USD",
		An:         &LineAnchors{T1: kamis09, P1: 1.1000, T2: jumat09, P2: 1.1024},
	}
	// Kamis 09:00 → Senin 09:00 = 24 (ke Jumat 09:00) + 8 (ke tutup Jumat 17:00) + 16 (dari buka
	// Minggu 17:00) = 48 jam DAGANG, sementara wall-clock-nya 96 jam.
	if got, want := levelAt(r, senin09), 1.1048; math.Abs(got-want) > 1e-9 {
		t.Fatalf("level Senin pagi = %.6f, mau %.6f (wall-clock keliru memberi 1.109600)", got, want)
	}
}

// Crypto tak punya jeda: basis waktunya harus tetap wall-clock apa adanya.
func TestLevelAtSlopedCrypto(t *testing.T) {
	jumat16 := nyMs(t, 2026, time.January, 9, 16, 0)
	r := AlertRow{
		Instrument: "BTC_USD",
		An:         &LineAnchors{T1: jumat16, P1: 100000, T2: jumat16 + 10*jam, P2: 100100},
	}
	if got, want := levelAt(r, jumat16+5*jam), 100050.0; math.Abs(got-want) > 1e-6 {
		t.Fatalf("crypto level = %.4f, mau %.4f", got, want)
	}
}

// Garis digambar KANAN KE KIRI (points[0] sesudah points[1]) adalah gestur yang sah.
// Levelnya harus identik dengan garis yang sama digambar kiri ke kanan.
func TestLevelAtAnchorTerbalik(t *testing.T) {
	a := nyMs(t, 2026, time.January, 6, 9, 0)
	b := nyMs(t, 2026, time.January, 6, 19, 0)
	maju := AlertRow{Instrument: "EUR_USD", An: &LineAnchors{T1: a, P1: 1.10, T2: b, P2: 1.20}}
	balik := AlertRow{Instrument: "EUR_USD", An: &LineAnchors{T1: b, P1: 1.20, T2: a, P2: 1.10}}
	now := a + 5*jam
	if got, want := levelAt(balik, now), levelAt(maju, now); math.Abs(got-want) > 1e-9 {
		t.Fatalf("anchor terbalik = %.6f, mau %.6f", got, want)
	}
}

// Kedua anchor di dalam akhir pekan yang sama → tak ada waktu dagang di antaranya.
// Jangan membagi nol: bekukan level di anchor pertama.
func TestLevelAtSpanNol(t *testing.T) {
	sabtu := nyMs(t, 2026, time.January, 10, 8, 0)
	r := AlertRow{Instrument: "EUR_USD", An: &LineAnchors{T1: sabtu, P1: 1.2345, T2: sabtu + 3*jam, P2: 1.9999}}
	if got, want := levelAt(r, sabtu+jam), 1.2345; math.Abs(got-want) > 1e-9 {
		t.Fatalf("span nol = %.6f, mau %.6f (P1, bukan pembagian nol)", got, want)
	}
}

// Garis horizontal lewat rumus yang SAMA: p1==p2 → konstan, tanpa cabang khusus.
func TestLevelAtHorizontal(t *testing.T) {
	r := AlertRow{An: &LineAnchors{T1: 1000, P1: 1.15, T2: 2000, P2: 1.15}}
	for _, now := range []int64{0, 1500, 9_999_999} {
		if got := levelAt(r, now); got != 1.15 {
			t.Fatalf("levelAt(%d)=%v mau 1.15", now, got)
		}
	}
}

// Alert harga biasa: level = kolom price, tak peduli waktu.
func TestLevelAtPlain(t *testing.T) {
	r := AlertRow{Price: 1.2345}
	if got := levelAt(r, 12345); got != 1.2345 {
		t.Fatalf("got %v", got)
	}
}

// sideHit dinyatakan pada JARAK d = harga − level, jadi kasus "level diam" ditulis dgn level yang
// sama di kedua sisi. Ini penerus TestCondHit: isi kasusnya sama, cuma diterjemahkan ke d.
func TestSideHitPriceMoves(t *testing.T) {
	const lvl = 1.15
	cases := []struct {
		cond      string
		prev, cur float64
		want      bool
		why       string
	}{
		{"cross", 1.10, 1.20, true, "naik melintas"},
		{"cross", 1.20, 1.10, true, "turun melintas"},
		{"cross", 1.10, 1.12, false, "tak sampai"},
		{"up", 1.10, 1.20, true, "naik melintas"},
		{"up", 1.20, 1.10, false, "turun tak menyalakan 'up'"},
		{"down", 1.20, 1.10, true, "turun melintas"},
		{"down", 1.10, 1.20, false, "naik tak menyalakan 'down'"},
		{"up", 1.10, 1.15, true, "menyentuh tepat dihitung"},
	}
	for _, c := range cases {
		if got := sideHit(c.cond, c.prev-lvl, c.cur-lvl); got != c.want {
			t.Fatalf("sideHit(%s, %v, %v)=%v mau %v — %s", c.cond, c.prev-lvl, c.cur-lvl, got, c.want, c.why)
		}
	}
}

// INTI FITUR: harga diam, garisnya yang bergerak melewati harga. Lewat evalAlert (bukan predikat
// telanjang) supaya yang diuji adalah jalur yang sungguh dipakai monitor, termasuk trackernya.
func TestSlopedLineCrossesWithoutPriceChange(t *testing.T) {
	an := LineAnchors{T1: 0, P1: 1.00, T2: 10_000, P2: 2.00}
	r := AlertRow{ID: 1, Cond: "cross", An: &an}
	const price = 1.50
	lvlTrack := levelTracker{}
	// pada t=4000 level 1.40 (harga di ATAS garis); pada t=6000 level 1.60 (harga di BAWAH)
	before, after := levelAt(r, 4000), levelAt(r, 6000)
	if !(price > before && price < after) {
		t.Fatalf("prasyarat salah: level %v → %v terhadap harga %v", before, after, price)
	}
	if _, hit := evalAlert(r, price, price, 4000, lvlTrack); hit {
		t.Fatalf("belum boleh menyala di t=4000 (baseline baru direkam)")
	}
	if _, hit := evalAlert(r, price, price, 6000, lvlTrack); !hit {
		t.Fatalf("garis yang melewati harga yang DIAM harus terdeteksi")
	}
}

// C2: jalur "level bergerak" dulu menyalakan alert TANPA melihat a.Cond sama sekali (ia memakai
// crossed() yang dua arah), jadi alert `up` menyala saat garis bergerak TURUN melewati harga yang
// diam — dan karena one-shot, persilangan yang sungguhan tak pernah bisa menyala lagi sesudahnya.
func TestLevelMoveRespectsCondDirection(t *testing.T) {
	const price = 1.50
	// Garis NAIK melewati harga yang diam: dari sudut pandang harga, harga jatuh dari ATAS ke BAWAH
	// garis → itu "down", bukan "up".
	naik := LineAnchors{T1: 0, P1: 1.00, T2: 10_000, P2: 2.00}
	// Garis TURUN melewati harga yang diam → "up".
	turun := LineAnchors{T1: 0, P1: 2.00, T2: 10_000, P2: 1.00}

	cases := []struct {
		cond string
		an   LineAnchors
		want bool
		why  string
	}{
		{"up", naik, false, "garis NAIK melewati harga diam bukan 'crossing up'"},
		{"down", naik, true, "garis NAIK melewati harga diam = harga jadi di BAWAH garis"},
		{"down", turun, false, "garis TURUN melewati harga diam bukan 'crossing down'"},
		{"up", turun, true, "garis TURUN melewati harga diam = harga jadi di ATAS garis"},
		{"cross", naik, true, "'cross' menyala dua arah"},
		{"cross", turun, true, "'cross' menyala dua arah"},
	}
	for i, c := range cases {
		an := c.an
		r := AlertRow{ID: int64(i + 1), Cond: c.cond, An: &an}
		lvlTrack := levelTracker{}
		if _, hit := evalAlert(r, price, price, 4000, lvlTrack); hit {
			t.Fatalf("case %d: tick pertama (baseline) tak boleh menyala", i)
		}
		if _, hit := evalAlert(r, price, price, 6000, lvlTrack); hit != c.want {
			t.Fatalf("case %d cond=%s: hit=%v mau %v — %s", i, c.cond, hit, c.want, c.why)
		}
	}
}

// I1: sisi SEBELUMNYA harus dihitung terhadap level SEBELUMNYA. Kalau harga prev dibandingkan ke
// level SEKARANG (perilaku lama), lompatan level antar tick mengarang persilangan yang tak pernah
// terjadi — di sini harga & garis sama-sama bergerak, tapi harga TAK PERNAH berpindah sisi.
func TestNoHitWhenBothTicksOnSameSide(t *testing.T) {
	an := LineAnchors{T1: 0, P1: 1.00, T2: 10_000, P2: 2.00} // level 1.40 @4000, 1.60 @6000
	r := AlertRow{ID: 1, Cond: "cross", An: &an}
	lvlTrack := levelTracker{}
	// Harga selalu di ATAS garis: 1.45 vs level 1.40, lalu 1.65 vs level 1.60.
	if _, hit := evalAlert(r, 1.45, 1.45, 4000, lvlTrack); hit {
		t.Fatalf("tick pertama (baseline) tak boleh menyala")
	}
	if _, hit := evalAlert(r, 1.45, 1.65, 6000, lvlTrack); hit {
		t.Fatalf("harga tak pernah berpindah sisi → tak boleh menyala (prev dibanding level LAMA)")
	}
}

// I1 (lanjutan): tanpa baseline yang sah, tick itu DILEWATI — bukan ditebak. Anchor berubah antar
// tick (pengguna menyeret garisnya) adalah kasus nyatanya.
func TestNoHitWithoutValidBaseline(t *testing.T) {
	lvlTrack := levelTracker{}
	an := LineAnchors{T1: 0, P1: 1.40, T2: 10_000, P2: 1.40}
	r := AlertRow{ID: 1, Cond: "cross", An: &an}
	// Tick pertama: belum ada entry sama sekali → lewati walau harga "menyeberang".
	if _, hit := evalAlert(r, 1.30, 1.50, 1000, lvlTrack); hit {
		t.Fatalf("tanpa baseline, jangan menebak: tick pertama tak boleh menyala")
	}
	// Tick kedua dgn anchor BERBEDA → baseline tersimpan tak berlaku, lewati lagi.
	an2 := LineAnchors{T1: 0, P1: 1.60, T2: 10_000, P2: 1.60}
	r.An = &an2
	if _, hit := evalAlert(r, 1.70, 1.50, 2000, lvlTrack); hit {
		t.Fatalf("anchor berubah → baseline lama tak sah, tick ini tak boleh menyala")
	}
}

// Alert harga biasa (An nil) punya prevLvl == lvl == price, jadi jalur baru harus memberi hasil
// yang PERSIS sama dgn semantik lama — bukti bahwa alert harga yang sudah ada tak teregresi.
func TestPlainAlertUnchangedByNewPath(t *testing.T) {
	cases := []struct {
		cond      string
		prev, cur float64
		want      bool
	}{
		{"cross", 1.10, 1.20, true},
		{"cross", 1.20, 1.10, true},
		{"cross", 1.10, 1.12, false},
		{"up", 1.10, 1.20, true},
		{"up", 1.20, 1.10, false},
		{"down", 1.20, 1.10, true},
		{"down", 1.10, 1.20, false},
		{"up", 1.10, 1.15, true}, // sentuh tepat
		{"", 1.10, 1.20, true},   // cond kosong = cross
	}
	lvlTrack := levelTracker{}
	for i, c := range cases {
		a := AlertRow{ID: int64(i + 1), Cond: c.cond, Price: 1.15}
		lvl, hit := evalAlert(a, c.prev, c.cur, 12345, lvlTrack)
		if lvl != 1.15 {
			t.Fatalf("case %d: alert biasa levelnya harus kolom price, dapat %v", i, lvl)
		}
		if hit != c.want {
			t.Fatalf("case %d cond=%q prev=%v cur=%v: hit=%v mau %v", i, c.cond, c.prev, c.cur, hit, c.want)
		}
	}
}

// Fix round 1 — bug #1: men-drag garis tak boleh membangkitkan alert palsu. Level
// lama (dari anchor SEBELUM digeser) tak boleh dibandingkan seakan level itu berasal
// dari garis yang sama dgn anchor yang berlaku sekarang.
func TestLevelTrackerIgnoresStaleLevelAfterAnchorChange(t *testing.T) {
	lvlTrack := levelTracker{}
	const price = 1.50

	// Tick 1: garis LAMA, levelnya di BAWAH harga (harga diam di kedua tick).
	oldAn := LineAnchors{T1: 0, P1: 1.00, T2: 10_000, P2: 2.00} // level(4000) = 1.40
	a := AlertRow{ID: 1, Cond: "cross", An: &oldAn}
	lvl1, hit1 := evalAlert(a, price, price, 4000, lvlTrack)
	if hit1 {
		t.Fatalf("tick pertama belum boleh menyala")
	}
	if lvl1 >= price {
		t.Fatalf("prasyarat salah: level lama %v harus di BAWAH harga %v", lvl1, price)
	}

	// Pengguna men-drag garis: anchor baru (horizontal) taruh levelnya di ATAS harga,
	// pada waktu evaluasi yang SAMA — persis skenario reload cache di tengah drag.
	newAn := LineAnchors{T1: 0, P1: 1.60, T2: 10_000, P2: 1.60}
	a.An = &newAn
	lvl2, hit2 := evalAlert(a, price, price, 4000, lvlTrack)
	if lvl2 <= price {
		t.Fatalf("prasyarat salah: level baru %v harus di ATAS harga %v", lvl2, price)
	}
	if hit2 {
		t.Fatalf("reposisi garis oleh pengguna sendiri tak boleh menyalakan alert (level lama basi terpakai)")
	}
}

// Fix round 1 — bug #2 (bagian tulis): alert harga biasa tak pernah membaca
// levelTracker, jadi tak boleh ditulis ke sana juga (kalau tidak, peta tumbuh
// tanpa guna selama umur proses monitor).
func TestLevelTrackerSkipsPlainPriceAlerts(t *testing.T) {
	lvlTrack := levelTracker{}
	a := AlertRow{ID: 7, Cond: "cross", Price: 1.2345} // An nil: alert harga biasa
	evalAlert(a, 1.10, 1.20, 1000, lvlTrack)
	if _, ok := lvlTrack[7]; ok {
		t.Fatalf("alert harga biasa (An nil) tak boleh dicatat di levelTracker")
	}
}

// Fix round 1 — bug #2 (bagian pangkas): entry milik alert yang sudah tak aktif
// (triggered/dihapus) harus lenyap setelah reload, bukan menumpuk selamanya —
// goroutine monitor didesain hidup lama tanpa browser terbuka.
func TestLevelTrackerPruneRemovesInactiveAlerts(t *testing.T) {
	lvlTrack := levelTracker{
		1: {lvl: 1.10},
		2: {lvl: 1.20},
	}
	lvlTrack.prune(map[int64]bool{1: true}) // alert 2 sudah tak ada di cache aktif
	if _, ok := lvlTrack[1]; !ok {
		t.Fatalf("alert 1 masih aktif, entrinya tak boleh hilang")
	}
	if _, ok := lvlTrack[2]; ok {
		t.Fatalf("alert 2 sudah tak aktif, entrinya harus dibuang")
	}
}
