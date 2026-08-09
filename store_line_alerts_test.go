package main

import (
	"path/filepath"
	"testing"
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
