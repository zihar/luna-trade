package main

import (
	"testing"
	"time"
)

// Helper: waktu New York → epoch ms. Dipakai semua test jam-dagang supaya kasusnya terbaca
// sebagai jam pasar, bukan sebagai angka epoch.
func nyMs(t *testing.T, y int, mo time.Month, d, h, mi int) int64 {
	t.Helper()
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatalf("zoneinfo NY tak tersedia: %v", err)
	}
	return time.Date(y, mo, d, h, mi, 0, 0, loc).UnixMilli()
}

const jam = int64(3600 * 1000)

func TestTradingElapsed24x5(t *testing.T) {
	// 2026: 6 Jan = Selasa, 9 Jan = Jumat, 12 Jan = Senin.
	cases := []struct {
		nama string
		a, b int64
		want int64
	}{
		{
			"dalam satu hari kerja",
			nyMs(t, 2026, time.January, 6, 9, 0),
			nyMs(t, 2026, time.January, 6, 15, 0),
			6 * jam,
		},
		{
			// Pasar tutup Jumat 17:00, buka lagi Minggu 17:00: 1 jam sisa Jumat + 16 jam Minggu→Senin.
			"melintasi satu akhir pekan",
			nyMs(t, 2026, time.January, 9, 16, 0),
			nyMs(t, 2026, time.January, 12, 9, 0),
			17 * jam,
		},
		{
			"kedua ujung di dalam akhir pekan yang sama",
			nyMs(t, 2026, time.January, 10, 8, 0),
			nyMs(t, 2026, time.January, 11, 8, 0),
			0,
		},
		{
			// Jumat 09:00 → Jumat 09:00 pekan berikutnya = tepat satu pekan dagang.
			"tepat satu pekan dagang",
			nyMs(t, 2026, time.January, 9, 9, 0),
			nyMs(t, 2026, time.January, 16, 9, 0),
			tradingWeekMs,
		},
		{
			"a == b",
			nyMs(t, 2026, time.January, 6, 9, 0),
			nyMs(t, 2026, time.January, 6, 9, 0),
			0,
		},
	}
	for _, c := range cases {
		if got := tradingElapsed("EUR_USD", c.a, c.b); got != c.want {
			t.Errorf("%s: tradingElapsed = %d jam, mau %d jam", c.nama, got/jam, c.want/jam)
		}
	}
}

// Bertanda: membalik urutan membalik tanda, tanpa clamp ke nol. levelAt bergantung pada ini
// supaya tetap linear penuh terhadap waktu dagang.
func TestTradingElapsedBertanda(t *testing.T) {
	a := nyMs(t, 2026, time.January, 6, 9, 0)
	b := nyMs(t, 2026, time.January, 12, 9, 0)
	maju := tradingElapsed("EUR_USD", a, b)
	mundur := tradingElapsed("EUR_USD", b, a)
	if maju <= 0 {
		t.Fatalf("maju harus positif, got %d", maju)
	}
	if mundur != -maju {
		t.Fatalf("mundur = %d, mau %d", mundur, -maju)
	}
}

// Transisi DST NY terjadi Minggu 02:00 lokal — SEBELUM pekan dagang mulai (Minggu 17:00).
// Karena itu tiap pekan dagang tepat 120 jam wall-clock, tak ada pekan 119/121 jam.
func TestTradingElapsedLintasDST(t *testing.T) {
	// DST mulai Minggu 8 Maret 2026; DST berakhir Minggu 1 November 2026.
	cases := []struct {
		nama string
		a, b int64
	}{
		{"maju (Maret)", nyMs(t, 2026, time.March, 6, 9, 0), nyMs(t, 2026, time.March, 13, 9, 0)},
		{"mundur (November)", nyMs(t, 2026, time.October, 30, 9, 0), nyMs(t, 2026, time.November, 6, 9, 0)},
	}
	for _, c := range cases {
		if got := tradingElapsed("EUR_USD", c.a, c.b); got != tradingWeekMs {
			t.Errorf("%s: %d jam, mau %d jam (pekan dagang harus tetap 120 jam)", c.nama, got/jam, tradingWeekMs/jam)
		}
	}
}

func TestTradingElapsed24x7(t *testing.T) {
	a := nyMs(t, 2026, time.January, 9, 16, 0)
	b := nyMs(t, 2026, time.January, 12, 9, 0)
	if got, want := tradingElapsed("BTC_USD", a, b), b-a; got != want {
		t.Fatalf("crypto: %d, mau %d (selisih wall-clock apa adanya)", got, want)
	}
	if !is247("btc_usd") {
		t.Fatalf("is247 harus tak peduli huruf besar-kecil")
	}
	if is247("EUR_USD") {
		t.Fatalf("EUR_USD bukan 24/7")
	}
}
