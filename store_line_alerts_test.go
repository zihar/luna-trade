package main

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func storeForLineAlerts(t *testing.T) *Store {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	return s
}

// Alert harga biasa tak boleh berubah bentuknya oleh fitur ini.
func TestPlainAlertStillWorks(t *testing.T) {
	s := storeForLineAlerts(t)
	id, err := s.CreateAlert(1, "EUR_USD", 1.2345, 1000, "", "", nil)
	if err != nil || id == 0 {
		t.Fatalf("create: id=%d err=%v", id, err)
	}
	rows, _ := s.AllActiveAlerts()
	if len(rows) != 1 || rows[0].An != nil || rows[0].Cond != "cross" {
		t.Fatalf("alert biasa: %+v (cond kosong harus jadi 'cross', anchor nil)", rows[0])
	}
}

func TestLineAlertRoundTrip(t *testing.T) {
	s := storeForLineAlerts(t)
	an := LineAnchors{T1: 1_000_000, P1: 1.10, T2: 2_000_000, P2: 1.20}
	id, err := s.CreateAlert(1, "EUR_USD", 0, 1000, "up", "d-abc", &an)
	if err != nil || id == 0 {
		t.Fatalf("create: %v", err)
	}
	rows, _ := s.AllActiveAlerts()
	if len(rows) != 1 {
		t.Fatalf("want 1 active")
	}
	r := rows[0]
	if r.Cond != "up" || r.DrawID != "d-abc" || r.An == nil {
		t.Fatalf("kolom baru tak terbaca: %+v", r)
	}
	if r.An.T1 != an.T1 || r.An.P1 != an.P1 || r.An.T2 != an.T2 || r.An.P2 != an.P2 {
		t.Fatalf("anchor: %+v mau %+v", *r.An, an)
	}
	// list untuk FE juga harus membawanya
	list, _ := s.ListAlerts(1)
	if len(list) != 1 || list[0].Cond != "up" || list[0].DrawID != "d-abc" || list[0].An == nil {
		t.Fatalf("ListAlerts: %+v", list)
	}
}

// Menggeser garis: anchor diperbarui, alert tetap alert yang sama.
func TestUpdateAlertAnchors(t *testing.T) {
	s := storeForLineAlerts(t)
	an := LineAnchors{T1: 1_000_000, P1: 1.10, T2: 2_000_000, P2: 1.20}
	id, _ := s.CreateAlert(1, "EUR_USD", 0, 1000, "cross", "d-abc", &an)

	moved := LineAnchors{T1: 1_500_000, P1: 1.30, T2: 2_500_000, P2: 1.40}
	if err := s.UpdateAlertAnchors(1, id, moved); err != nil {
		t.Fatalf("update: %v", err)
	}
	rows, _ := s.AllActiveAlerts()
	if rows[0].An.P1 != 1.30 || rows[0].An.T2 != 2_500_000 {
		t.Fatalf("anchor tak berubah: %+v", *rows[0].An)
	}
	// pemilik lain tak boleh bisa menggeser
	if err := s.UpdateAlertAnchors(2, id, an); err == nil {
		t.Fatalf("update oleh user lain harus error")
	}
}

// Hapus garis → alertnya ikut, dan HANYA miliknya.
func TestDeleteAlertsByDrawing(t *testing.T) {
	s := storeForLineAlerts(t)
	an := LineAnchors{T1: 1, P1: 1, T2: 2, P2: 2}
	s.CreateAlert(1, "EUR_USD", 0, 1000, "cross", "d-satu", &an)
	s.CreateAlert(1, "EUR_USD", 0, 1000, "cross", "d-dua", &an)
	s.CreateAlert(1, "XAU_USD", 0, 1000, "cross", "d-satu", &an) // did sama, instrumen beda
	s.CreateAlert(2, "EUR_USD", 0, 1000, "cross", "d-satu", &an) // user lain

	n, err := s.DeleteAlertsByDrawing(1, "EUR_USD", "d-satu")
	if err != nil || n != 1 {
		t.Fatalf("delete: n=%d err=%v", n, err)
	}
	rows, _ := s.AllActiveAlerts()
	if len(rows) != 3 {
		t.Fatalf("hanya 1 baris yang boleh terhapus, sisa=%d", len(rows))
	}
}

// Garis MIRING yang kedua anchornya jatuh di akhir pekan yang sama tak punya "harga pada waktu t"
// yang bisa diinterpolasi — ditolak di pintu masuk, seperti garis vertikal.
func TestCreateAlertMiringTanpaWaktuDagang(t *testing.T) {
	s := storeForLineAlerts(t)
	sabtu := nyMs(t, 2026, time.January, 10, 8, 0)
	an := LineAnchors{T1: sabtu, P1: 1.10, T2: sabtu + 3*jam, P2: 1.20}
	if _, err := s.CreateAlert(1, "EUR_USD", 0, 1000, "cross", "did-1", &an); !errors.Is(err, ErrAlertNoTradingSpan) {
		t.Fatalf("err = %v, mau ErrAlertNoTradingSpan", err)
	}
}

// Garis HORIZONTAL dgn span dagang nol TETAP SAH — regresi #180. Alert garis horizontal memakai
// t2 = t1+1, jadi yang digambar di area future saat akhir pekan punya span nol, dan levelnya
// konstan sehingga span memang tak relevan.
func TestCreateAlertHorizontalTanpaWaktuDagangTetapSah(t *testing.T) {
	s := storeForLineAlerts(t)
	sabtu := nyMs(t, 2026, time.January, 10, 8, 0)
	an := LineAnchors{T1: sabtu, P1: 1.10, T2: sabtu + 1, P2: 1.10}
	if _, err := s.CreateAlert(1, "EUR_USD", 0, 1000, "cross", "did-2", &an); err != nil {
		t.Fatalf("alert horizontal ditolak: %v", err)
	}
}

// Jalur GESER sengaja lebih longgar dari jalur CREATE: menyeret garis sampai kedua ujungnya masuk
// akhir pekan harus TETAP tersimpan. Kalau ditolak, syncAlertAnchors (yang menulis state lokalnya
// sebelum fetch dan menelan kegagalan) membuat garis di layar bergerak sementara alert diam-diam
// mengawasi posisi lama. Perilaku anchor seperti itu sendiri terdefinisi: levelAt membekukannya
// di P1.
func TestUpdateAnchorsKeAkhirPekanTetapTersimpan(t *testing.T) {
	s := storeForLineAlerts(t)
	senin := nyMs(t, 2026, time.January, 12, 9, 0)
	an := LineAnchors{T1: senin, P1: 1.10, T2: senin + 3*jam, P2: 1.20}
	id, err := s.CreateAlert(1, "EUR_USD", 0, 1000, "cross", "did-3", &an)
	if err != nil {
		t.Fatalf("setup gagal: %v", err)
	}
	sabtu := nyMs(t, 2026, time.January, 10, 8, 0)
	geser := LineAnchors{T1: sabtu, P1: 1.30, T2: sabtu + 3*jam, P2: 1.40}
	if err := s.UpdateAlertAnchors(1, id, geser); err != nil {
		t.Fatalf("geser ke akhir pekan harus tersimpan, dapat: %v", err)
	}
	rows, _ := s.AllActiveAlerts()
	if len(rows) != 1 || rows[0].An.T1 != sabtu || rows[0].An.P1 != 1.30 {
		t.Fatalf("anchor tak tersimpan: %+v", rows)
	}
	// Dan levelnya terdefinisi: beku di P1, bukan pembagian nol.
	if got := levelAt(rows[0], sabtu+jam); got != 1.30 {
		t.Fatalf("level = %v, mau 1.30 (beku di P1)", got)
	}
}

// Vertikal tetap ditolak di jalur geser — ia tak punya "harga pada waktu t" sama sekali.
func TestUpdateAnchorsVertikalDitolak(t *testing.T) {
	s := storeForLineAlerts(t)
	senin := nyMs(t, 2026, time.January, 12, 9, 0)
	an := LineAnchors{T1: senin, P1: 1.10, T2: senin + 3*jam, P2: 1.20}
	id, _ := s.CreateAlert(1, "EUR_USD", 0, 1000, "cross", "did-4", &an)
	if err := s.UpdateAlertAnchors(1, id, LineAnchors{T1: senin, P1: 1.1, T2: senin, P2: 1.2}); !errors.Is(err, ErrAlertVertical) {
		t.Fatalf("err = %v, mau ErrAlertVertical", err)
	}
}
