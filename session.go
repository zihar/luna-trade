// Jam-dagang: berapa milidetik PASAR BUKA di antara dua waktu wall-clock.
//
// Ini basis waktu untuk alert garis miring. Sumbu-x chart linear dalam INDEKS BAR, bukan dalam
// waktu kalender, dan keduanya cuma sepakat pada instrumen tanpa jeda sesi — forex kehilangan 48
// dari 168 jam tiap pekan. Menginterpolasi garis miring dalam waktu kalender membuat levelnya
// berjalan 28,6% lebih cepat daripada garis yang dilihat pengguna.
// Rancangan: docs/superpowers/specs/2026-08-09-alert-garis-miring-design.md
package main

import (
	"log"
	"math"
	"strings"
	"time"

	// zoneinfo di-embed ke binary: belum ada satu pun LoadLocation di codebase ini, jadi
	// ketergantungan baru pada /usr/share/zoneinfo host (EC2 arm64) dibuat mustahil sejak awal.
	_ "time/tzdata"
)

// Pekan dagang: Minggu 17:00 New York → Jumat 17:00 New York = 120 jam.
//
// Angkanya tepat, bukan hampiran: transisi DST New York terjadi Minggu pukul 02:00 lokal — SEBELUM
// pekan dagang dimulai — jadi tak ada pekan dagang 119 atau 121 jam yang harus dikecualikan.
const tradingWeekMs int64 = 120 * 3600 * 1000

// Jangkar 17:00 NY sama dengan yang dipakai proyek untuk batas bar D/W/MN (js/bar-time.js) dan
// untuk alignmentTimezone yang dikirim ke OANDA (main.go).
var nyLoc = loadNY()

func loadNY() *time.Location {
	l, err := time.LoadLocation("America/New_York")
	if err != nil {
		// Dengan tzdata di-embed ini praktis mustahil. Kalau toh terjadi: berisik, jangan diam —
		// offset tetap membuat jam-dagang meleset 1 jam selama musim DST.
		log.Printf("session: zoneinfo NY tak tersedia (%v) — jatuh ke EST tetap, jam-dagang meleset 1 jam saat DST", err)
		return time.FixedZone("EST", -5*3600)
	}
	return l
}

// Minggu 17:00 NY pertama pada/sesudah epoch, dipakai sebagai titik nol penomoran pekan.
// 4 Januari 1970 adalah hari Minggu.
var epochWeek = time.Date(1970, time.January, 4, 17, 0, 0, 0, nyLoc)

// Instrumen yang diperdagangkan tanpa henti. Sisanya (forex, metals, energy, indices CFD, DXY
// sintetis) memakai model 24/5 — termasuk instrumen yang tak dikenal, karena model yang meleset
// sedikit lebih baik daripada alert yang diam-diam mati.
var insts247 = map[string]bool{"BTC_USD": true, "ETH_USD": true, "LTC_USD": true, "BCH_USD": true}

func is247(inst string) bool { return insts247[strings.ToUpper(inst)] }

// tradingElapsed = milidetik pasar-buka antara a dan b, BERTANDA (a > b memberi negatif).
// Bertanda supaya levelAt tetap fungsi linear penuh terhadap waktu dagang; keputusan "jangan
// awasi garis yang belum mulai" ada di evalAlert, bukan tersembunyi sebagai clamp di sini.
func tradingElapsed(inst string, a, b int64) int64 {
	if a == b {
		return 0
	}
	if a > b {
		return -tradingElapsed(inst, b, a)
	}
	if is247(inst) {
		return b - a
	}
	return tradingClock(b) - tradingClock(a)
}

// tradingClock memetakan wall-clock ke "milidetik dagang sejak epochWeek" — monoton tak turun,
// dan datar sepanjang akhir pekan. Selisih dua nilainya adalah jawaban tradingElapsed.
func tradingClock(ms int64) int64 {
	t := time.UnixMilli(ms).In(nyLoc)
	ws := weekStart(t)
	off := t.Sub(ws).Milliseconds()
	if off > tradingWeekMs {
		off = tradingWeekMs // t jatuh di akhir pekan → jam berhenti di tutup Jumat
	}
	return weeksSinceEpoch(ws)*tradingWeekMs + off
}

// weekStart = Minggu 17:00 NY terakhir yang tidak melewati t.
func weekStart(t time.Time) time.Time {
	y, m, d := t.Date()
	ws := time.Date(y, m, d, 17, 0, 0, 0, nyLoc)
	ws = ws.AddDate(0, 0, -int(ws.Weekday())) // mundur ke Minggu
	if ws.After(t) {
		ws = ws.AddDate(0, 0, -7)
	}
	return ws
}

// Jumlah pekan dari epochWeek. Pembulatan aman karena kedua ujungnya adalah Minggu 17:00 NY:
// DST hanya bisa menggeser jaraknya ±1 jam dari kelipatan 168 jam.
func weeksSinceEpoch(ws time.Time) int64 {
	return int64(math.Round(ws.Sub(epochWeek).Hours() / 168))
}
