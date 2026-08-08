package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// storeForDrawings membuka Store baru di file temp + migrate (pola sama dgn store_alerts_test.go).
func storeForDrawings(t *testing.T) *Store {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	return s
}

// Belum pernah menggambar bukan kondisi error: klien tak perlu membedakan "kosong" dari "gagal".
func TestDrawingsEmptyIsNotError(t *testing.T) {
	s := storeForDrawings(t)
	payload, version, err := s.GetDrawings(1, "EUR_USD")
	if err != nil || payload != "[]" || version != 0 {
		t.Fatalf("kosong: payload=%q version=%d err=%v", payload, version, err)
	}
}

func TestDrawingsSaveAndVersionBump(t *testing.T) {
	s := storeForDrawings(t)
	v, ok, err := s.SaveDrawings(1, "EUR_USD", `[{"name":"trendline"}]`, 0, 1000)
	if err != nil || !ok || v != 1 {
		t.Fatalf("simpan pertama: v=%d ok=%v err=%v", v, ok, err)
	}
	v, ok, err = s.SaveDrawings(1, "EUR_USD", `[{"name":"rect"}]`, 1, 2000)
	if err != nil || !ok || v != 2 {
		t.Fatalf("simpan kedua: v=%d ok=%v err=%v", v, ok, err)
	}
	payload, version, _ := s.GetDrawings(1, "EUR_USD")
	if payload != `[{"name":"rect"}]` || version != 2 {
		t.Fatalf("state akhir: payload=%s version=%d", payload, version)
	}
}

// Inti fitur: perangkat kedua yang memegang versi lama TIDAK boleh menimpa diam-diam.
func TestDrawingsStaleBaseVersionRejected(t *testing.T) {
	s := storeForDrawings(t)
	s.SaveDrawings(1, "EUR_USD", `[{"name":"a"}]`, 0, 1000)
	s.SaveDrawings(1, "EUR_USD", `[{"name":"b"}]`, 1, 2000)

	v, ok, err := s.SaveDrawings(1, "EUR_USD", `[{"name":"c"}]`, 1, 3000)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if ok {
		t.Fatalf("baseVersion basi harus DITOLAK")
	}
	if v != 2 {
		t.Fatalf("versi server yang dikembalikan = %d, mau 2 (klien butuh ini utk menawarkan Reload)", v)
	}
	payload, _, _ := s.GetDrawings(1, "EUR_USD")
	if payload != `[{"name":"b"}]` {
		t.Fatalf("isi baris berubah walau ditolak: %s", payload)
	}
}

// Versi hantu: klien mengaku basis 7 padahal barisnya belum pernah ada.
// Harus ditolak, bukan diam-diam membuat baris baru.
func TestDrawingsGhostVersionRejected(t *testing.T) {
	s := storeForDrawings(t)
	v, ok, err := s.SaveDrawings(1, "XAU_USD", `[{"name":"a"}]`, 7, 1000)
	if err != nil || ok {
		t.Fatalf("versi hantu harus ditolak: v=%d ok=%v err=%v", v, ok, err)
	}
	payload, version, _ := s.GetDrawings(1, "XAU_USD")
	if payload != "[]" || version != 0 {
		t.Fatalf("baris tak boleh terbentuk: payload=%s version=%d", payload, version)
	}
}

func TestDrawingsIsolatedPerUser(t *testing.T) {
	s := storeForDrawings(t)
	s.SaveDrawings(1, "EUR_USD", `[{"name":"punya-user-1"}]`, 0, 1000)

	payload, version, _ := s.GetDrawings(2, "EUR_USD")
	if payload != "[]" || version != 0 {
		t.Fatalf("user 2 melihat gambar user 1: %s v=%d", payload, version)
	}
	// user 2 menyimpan tak boleh menyentuh baris user 1
	if _, ok, _ := s.SaveDrawings(2, "EUR_USD", `[{"name":"punya-user-2"}]`, 0, 2000); !ok {
		t.Fatalf("user 2 harus bisa menyimpan barisnya sendiri")
	}
	p1, v1, _ := s.GetDrawings(1, "EUR_USD")
	if p1 != `[{"name":"punya-user-1"}]` || v1 != 1 {
		t.Fatalf("baris user 1 terganggu: %s v=%d", p1, v1)
	}
}

func TestDrawingsPayloadTooLargeRejected(t *testing.T) {
	s := storeForDrawings(t)
	big := "[\"" + strings.Repeat("x", maxDrawingsBytes) + "\"]"
	if _, ok, err := s.SaveDrawings(1, "EUR_USD", big, 0, 1000); ok || err == nil {
		t.Fatalf("payload > %d byte harus ditolak (ok=%v err=%v)", maxDrawingsBytes, ok, err)
	}
}
