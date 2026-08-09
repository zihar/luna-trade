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
