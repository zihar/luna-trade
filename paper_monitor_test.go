package main

import (
	"path/filepath"
	"testing"
)

// Verifikasi: SL/TP tersimpan & terbaca (round-trip), dan monitor menutup posisi
// saat harga menyentuh level (server-side, tanpa UI).
func TestPaperSLTPRoundTripAndAutoClose(t *testing.T) {
	st, err := openStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	store = st // global dipakai checkPaperSLTP → ClosePaperTrade

	uid, err := st.CreateUser("a@b.c", "h", "A", 10000)
	if err != nil {
		t.Fatal(err)
	}
	f := func(v float64) *float64 { return &v }

	// long EUR_USD entry 1.1000, SL 1.0950, TP 1.1100, 100k units
	id, err := st.OpenPaperTrade(uid, "EUR_USD", "long", 1.1000, 100000, "2026-01-01T00:00:00Z", f(1.0950), f(1.1100))
	if err != nil {
		t.Fatal(err)
	}

	// round-trip
	all, err := st.AllOpenPaperSLTP()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].ID != id || all[0].UserID != uid ||
		all[0].SL == nil || *all[0].SL != 1.0950 || all[0].TP == nil || *all[0].TP != 1.1100 {
		t.Fatalf("round-trip SL/TP salah: %+v", all)
	}

	// harga di antara SL & TP → tidak close
	if checkPaperSLTP(Tick{Instrument: "EUR_USD", Bid: 1.1000, Ask: 1.1001}, all) {
		t.Fatal("tidak seharusnya close di tengah")
	}
	// guard: bid=0 tak boleh memicu SL (0 <= SL)
	if checkPaperSLTP(Tick{Instrument: "EUR_USD", Bid: 0, Ask: 0}, all) {
		t.Fatal("bid=0 tidak boleh memicu SL")
	}
	// instrumen lain → diabaikan
	if checkPaperSLTP(Tick{Instrument: "GBP_USD", Bid: 1.0000, Ask: 1.0001}, all) {
		t.Fatal("instrumen lain tidak boleh memicu")
	}
	// bid menyentuh SL → close di SL
	if !checkPaperSLTP(Tick{Instrument: "EUR_USD", Bid: 1.0949, Ask: 1.0951}, all) {
		t.Fatal("seharusnya close di SL")
	}
	if got, _ := st.GetPaperTrade(uid, id); got != nil {
		t.Fatal("posisi seharusnya sudah tertutup")
	}
	if bal, _ := st.PaperBalance(uid); bal >= 10000 {
		t.Fatalf("saldo seharusnya turun karena loss, dapat %.2f", bal)
	}
}
