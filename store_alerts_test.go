package main

import (
	"path/filepath"
	"testing"
)

// mustTestStore membuka Store baru di file temp + migrate, utk dipakai test store_alerts.
func mustTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	return s
}

func TestAlertsCRUD(t *testing.T) {
	s := mustTestStore(t) // helper: buka Store di file temp + migrate (lihat Step 2)
	id, err := s.CreateAlert(1, "EUR_USD", 1.2345, 1000)
	if err != nil || id == 0 {
		t.Fatalf("create: id=%d err=%v", id, err)
	}
	got, err := s.ListAlerts(1)
	if err != nil || len(got) != 1 || got[0].Price != 1.2345 || !got[0].Active {
		t.Fatalf("list: %+v err=%v", got, err)
	}
	// ownership: user lain tak bisa hapus
	if err := s.DeleteAlert(2, id); err == nil {
		t.Fatalf("delete by wrong user should error")
	}
	// monitor melihatnya aktif
	rows, _ := s.AllActiveAlerts()
	if len(rows) != 1 || rows[0].UserID != 1 {
		t.Fatalf("active rows: %+v", rows)
	}
	// trigger → one-shot: tak lagi aktif
	if err := s.MarkAlertTriggered(id, 2000); err != nil {
		t.Fatalf("mark: %v", err)
	}
	rows, _ = s.AllActiveAlerts()
	if len(rows) != 0 {
		t.Fatalf("after trigger, active should be 0: %+v", rows)
	}
	// masih tampil di ListAlerts (triggered, belum di-ack) dgn TriggeredAt terisi
	got, _ = s.ListAlerts(1)
	if len(got) != 1 || got[0].TriggeredAt == nil || *got[0].TriggeredAt != 2000 {
		t.Fatalf("triggered list: %+v", got)
	}
	// hapus oleh pemilik
	if err := s.DeleteAlert(1, id); err != nil {
		t.Fatalf("delete: %v", err)
	}
	got, _ = s.ListAlerts(1)
	if len(got) != 0 {
		t.Fatalf("after delete: %+v", got)
	}
}
