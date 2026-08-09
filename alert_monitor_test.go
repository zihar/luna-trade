package main

import "testing"

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

func TestCondHit(t *testing.T) {
	cases := []struct {
		cond           string
		prev, cur, lvl float64
		want           bool
		why            string
	}{
		{"cross", 1.10, 1.20, 1.15, true, "naik melintas"},
		{"cross", 1.20, 1.10, 1.15, true, "turun melintas"},
		{"cross", 1.10, 1.12, 1.15, false, "tak sampai"},
		{"up", 1.10, 1.20, 1.15, true, "naik melintas"},
		{"up", 1.20, 1.10, 1.15, false, "turun tak menyalakan 'up'"},
		{"down", 1.20, 1.10, 1.15, true, "turun melintas"},
		{"down", 1.10, 1.20, 1.15, false, "naik tak menyalakan 'down'"},
		{"up", 1.10, 1.15, 1.15, true, "menyentuh tepat dihitung"},
	}
	for _, c := range cases {
		if got := condHit(c.cond, c.prev, c.cur, c.lvl); got != c.want {
			t.Fatalf("condHit(%s,%v,%v,%v)=%v mau %v — %s", c.cond, c.prev, c.cur, c.lvl, got, c.want, c.why)
		}
	}
}

// INTI FITUR: harga diam, garisnya yang bergerak melewati harga.
func TestSlopedLineCrossesWithoutPriceChange(t *testing.T) {
	r := AlertRow{Cond: "cross", An: &LineAnchors{T1: 0, P1: 1.00, T2: 10_000, P2: 2.00}}
	const price = 1.50
	// pada t=4000 level 1.40 (harga di ATAS garis); pada t=6000 level 1.60 (harga di BAWAH)
	before, after := levelAt(r, 4000), levelAt(r, 6000)
	if !(price > before && price < after) {
		t.Fatalf("prasyarat salah: level %v → %v terhadap harga %v", before, after, price)
	}
	// monitor membandingkan harga prev→cur terhadap level SAAT ITU; harga tetap, level berubah.
	if condHit(r.Cond, price, price, before) {
		t.Fatalf("belum boleh menyala di t=4000")
	}
	if !condHit(r.Cond, price-0.0, price, after) && !crossedByLevelMove(before, after, price) {
		t.Fatalf("garis yang melewati harga harus terdeteksi")
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
