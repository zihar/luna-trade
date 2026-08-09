# Alert Garis Miring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuka alert untuk garis MIRING (`trendline`, `rayLine`, `straightLine`) dengan mengganti basis waktu `levelAt()` dari wall-clock menjadi jam pasar-buka, sehingga level yang dievaluasi monitor sama dengan garis yang digambar di sumbu indeks-bar.

**Architecture:** Satu berkas Go baru (`session.go`) berisi fungsi murni `tradingElapsed(inst, a, b)` — milidetik pasar-buka bertanda antara dua waktu, dua model sesi saja (24/7 crypto, 24/5 sisanya dengan jangkar Minggu 17:00 NY → Jumat 17:00 NY). `levelAt()` memakainya sebagai ganti aritmetika kalender. Frontend membuka tiga tool miring dan menormalkan anchor supaya `t1 < t2`. Tak ada perubahan skema DB.

**Tech Stack:** Go (stdlib, `time` + `_ "time/tzdata"`), SQLite pure-Go, JS vanilla modul `js/*.js`, Playwright (`--project=hermetic`).

**Spec:** `docs/superpowers/specs/2026-08-09-alert-garis-miring-design.md`

## Global Constraints

- **Teks UI bahasa Inggris** (label/tombol/pesan error HTTP). Komentar kode & pesan commit Indonesian.
- **Pesan store berbahasa Indonesia TIDAK boleh bocor ke body HTTP** — api.go menerjemahkannya (pola `ErrAlertVertical` yang sudah ada).
- **Modul JS baru wajib punya entri `SENTINEL`** di `tests/smoke/boot-integrity.spec.js`. Rencana ini **tidak** membuat modul JS baru, jadi tak ada entri baru — jangan menambah satu pun.
- **Sebelum push cukup smoke:** `npx playwright test tests/smoke --project=hermetic`. Suite penuh diserahkan ke CI saat push ke `main`.
- **Satu fitur = satu PR.** Zona (channel/rectangle) adalah PR berikutnya — jangan disentuh di sini.
- Jangkar sesi: **Minggu 17:00 New York → Jumat 17:00 New York**. Model 24/7 hanya untuk `BTC_USD`, `ETH_USD`, `LTC_USD`, `BCH_USD`.
- Branch sudah ada: `zihar/zihar/feat/alert-garis-miring` (spec sudah di-commit di sana).

---

### Task 1: `tradingElapsed` — jam-dagang sebagai fungsi murni

**Files:**
- Create: `session.go`
- Test: `session_test.go`

**Interfaces:**
- Consumes: (tak ada — task pertama)
- Produces:
  - `func tradingElapsed(inst string, a, b int64) int64` — ms pasar-buka bertanda antara dua waktu wall-clock ms.
  - `func is247(inst string) bool` — true untuk crypto.
  - `const tradingWeekMs int64 = 120 * 3600 * 1000`

- [ ] **Step 1: Tulis test yang gagal**

Buat `session_test.go`:

```go
package main

import (
	"testing"
	"time"
)

// Helper: waktu New York → epoch ms. Dipakai semua test di berkas ini supaya kasusnya terbaca
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
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `go test ./... -run TestTradingElapsed`
Expected: FAIL — `undefined: tradingElapsed`, `undefined: is247`, `undefined: tradingWeekMs`.

- [ ] **Step 3: Implementasi minimal**

Buat `session.go`:

```go
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
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `go test ./... -run 'TestTradingElapsed|Testis247'`
Expected: PASS semua.

- [ ] **Step 5: Pastikan seluruh test Go lama masih hijau**

Run: `go build ./... && go test ./...`
Expected: PASS. Ini penting: `session.go` menambah `_ "time/tzdata"` ke binary.

- [ ] **Step 6: Commit**

```bash
git add session.go session_test.go
git commit -m "feat(alert): jam-dagang sebagai fungsi murni — dasar basis waktu garis miring

tradingElapsed(inst,a,b) = ms pasar-buka bertanda. Dua model: 24/7 crypto,
24/5 sisanya (Minggu 17:00 NY - Jumat 17:00 NY). Pekan dagang tepat 120 jam
karena transisi DST jatuh SEBELUM pekan dagang mulai.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `levelAt` memakai jam-dagang

**Files:**
- Modify: `alert_monitor.go:18-30` (fungsi `levelAt`)
- Test: `alert_monitor_test.go` (tambah test baru; `TestLevelAtSloped` yang ada TIDAK boleh diubah — ia harus tetap lulus)

**Interfaces:**
- Consumes: `tradingElapsed(inst string, a, b int64) int64` (Task 1)
- Produces: `levelAt(r AlertRow, now int64) float64` — tanda tangan TIDAK berubah; instrumen dibaca dari `r.Instrument`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `alert_monitor_test.go`:

```go
// Regresi UTAMA spec garis miring: level tak boleh melompat sebesar akhir pekan.
// Garis naik 24 jam-dagang = 0,0024 (0,0001 per jam dagang).
func TestLevelAtSlopedLintasAkhirPekan(t *testing.T) {
	jumat16 := nyMs(t, 2026, time.January, 9, 16, 0)
	senin09 := nyMs(t, 2026, time.January, 12, 9, 0) // 17 jam DAGANG sesudah jumat16, 65 jam wall-clock
	r := AlertRow{
		Instrument: "EUR_USD",
		An:         &LineAnchors{T1: jumat16, P1: 1.1000, T2: jumat16 + 24*jam, P2: 1.1024},
	}
	// 17 jam dagang × 0,0001 = 0,0017. Wall-clock akan memberi 65 × 0,0001 = 0,0065 — SALAH.
	if got, want := levelAt(r, senin09), 1.1017; math.Abs(got-want) > 1e-9 {
		t.Fatalf("level Senin pagi = %.6f, mau %.6f (wall-clock keliru memberi 1.106500)", got, want)
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
```

Tambahkan `"math"` dan `"time"` ke blok import `alert_monitor_test.go` bila belum ada, dan pindahkan helper `nyMs` + konstanta `jam` ke `session_test.go` saja (paket sama — jangan dideklarasikan dua kali).

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `go test ./... -run TestLevelAt`
Expected: FAIL pada `TestLevelAtSlopedLintasAkhirPekan` (level 1.106500 ≠ 1.101700), `TestLevelAtAnchorTerbalik`, `TestLevelAtSpanNol`. `TestLevelAtSloped` (lama) dan `TestLevelAtSlopedCrypto` sudah lulus.

- [ ] **Step 3: Implementasi**

Ganti `levelAt` di `alert_monitor.go` (blok komentar lamanya ikut diganti):

```go
// levelAt = level alert pada waktu `now`.
//
// Alert harga biasa (An nil) → kolom price. Alert garis → interpolasi dua anchor dalam JAM DAGANG
// (session.go), bukan waktu kalender: sumbu-x chart linear dalam indeks bar, jadi menginterpolasi
// dalam wall-clock membuat garis miring berjalan 28,6% lebih cepat daripada garis yang digambar.
// Garis horizontal (p1==p2) jatuh ke rumus yang sama dan memberi konstanta apa pun basis waktunya —
// itulah sebab v1 (#180) aman meski memakai wall-clock.
//
// Sengaja diekstrapolasi di luar ruas anchornya: trader menggambar trendline justru untuk mengawasi
// apa yang terjadi SESUDAH titik terakhir, jadi alert yang mati di ujung ruas berhenti bekerja tepat
// saat paling dibutuhkan. Penjagaan "garis yang belum mulai" ada di evalAlert, bukan di sini.
func levelAt(r AlertRow, now int64) float64 {
	if r.An == nil || r.An.T1 == r.An.T2 {
		return r.Price
	}
	an := *r.An
	// Garis boleh digambar kanan ke kiri. Frontend sudah menormalkan, tapi baris alert bisa datang
	// dari muatan lama atau klien lain — monitor tak boleh bergantung pada disiplin pengirim untuk
	// sesuatu yang sebiaya satu perbandingan.
	if an.T2 < an.T1 {
		an.T1, an.P1, an.T2, an.P2 = an.T2, an.P2, an.T1, an.P1
	}
	span := tradingElapsed(r.Instrument, an.T1, an.T2)
	if span == 0 {
		// Kedua anchor di dalam jendela pasar-tutup yang sama (mis. digambar di area future saat
		// akhir pekan). Bekukan di anchor pertama: untuk garis horizontal itu jawaban yang benar,
		// untuk garis miring itu yang paling tak berbahaya.
		return an.P1
	}
	f := float64(tradingElapsed(r.Instrument, an.T1, now)) / float64(span)
	return an.P1 + (an.P2-an.P1)*f
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `go test ./... -run TestLevelAt -v`
Expected: PASS semua, **termasuk `TestLevelAtSloped` lama** (anchornya 1000/2000 ms = Rabu malam NY 1969, di dalam jam dagang, jadi hasilnya sama dengan wall-clock).

- [ ] **Step 5: Seluruh test Go**

Run: `go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add alert_monitor.go alert_monitor_test.go session_test.go
git commit -m "fix(alert): levelAt menginterpolasi dalam jam dagang, bukan waktu kalender

Level garis miring berhenti melompat sebesar akhir pekan: Jumat 16:00 ke Senin
09:00 maju 17 jam dagang, bukan 65 jam. Anchor terbalik dinormalkan, span nol
membekukan level di P1 alih-alih membagi nol.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `evalAlert` diam untuk garis yang belum mulai

**Files:**
- Modify: `alert_monitor.go:115-127` (fungsi `evalAlert`)
- Test: `alert_monitor_test.go`

**Interfaces:**
- Consumes: `levelAt` (Task 2)
- Produces: `evalAlert(a AlertRow, prev, cur float64, now int64, lvlTrack levelTracker) (lvl float64, hit bool)` — tanda tangan tak berubah.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `alert_monitor_test.go`:

```go
// Garis yang SELURUHNYA di masa depan (kedua anchor sesudah now) tak boleh diawasi: levelnya
// hanya bisa didapat dengan mengekstrapolasi ke KIRI, ke bagian garis yang tak seorang pun gambar.
func TestEvalAlertGarisBelumMulai(t *testing.T) {
	now := nyMs(t, 2026, time.January, 6, 9, 0)
	besok := nyMs(t, 2026, time.January, 7, 9, 0)
	a := AlertRow{
		ID: 1, Instrument: "EUR_USD", Cond: "cross",
		An: &LineAnchors{T1: besok, P1: 1.10, T2: besok + 10*jam, P2: 1.20},
	}
	lt := levelTracker{}
	// Dua tick berturut-turut yang jelas melintasi level manapun di sekitar 1.10.
	lt.record(a.ID, *a.An, 1.10)
	if _, hit := evalAlert(a, 1.05, 1.15, now, lt); hit {
		t.Fatalf("alert menyala padahal garisnya belum mulai")
	}
}

// Begitu waktu melewati anchor pertama, alert hidup seperti biasa.
func TestEvalAlertHidupSesudahT1(t *testing.T) {
	t1 := nyMs(t, 2026, time.January, 6, 9, 0)
	a := AlertRow{
		ID: 2, Instrument: "EUR_USD", Cond: "cross",
		An: &LineAnchors{T1: t1, P1: 1.10, T2: t1 + 10*jam, P2: 1.20},
	}
	now := t1 + 5*jam // level = 1.15
	lt := levelTracker{}
	lt.record(a.ID, *a.An, 1.15)
	if _, hit := evalAlert(a, 1.14, 1.16, now, lt); !hit {
		t.Fatalf("alert tak menyala padahal harga melintasi level 1.15")
	}
}
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `go test ./... -run TestEvalAlertGarisBelumMulai`
Expected: FAIL — "alert menyala padahal garisnya belum mulai".

- [ ] **Step 3: Implementasi**

Di `alert_monitor.go`, dalam `evalAlert`, sisipkan penjagaan di dalam cabang `if a.An != nil` **sebelum** `lvlTrack.prevLevel`:

```go
	if a.An != nil {
		// Garis yang seluruhnya masih di masa depan tak diawasi: satu-satunya cara mendapat
		// levelnya sekarang adalah mengekstrapolasi ke KIRI, ke bagian garis yang tak digambar
		// siapa pun. Bukan penonaktifan — begitu waktu melewati anchor pertama, ia hidup sendiri.
		if mulai := a.An.T1; now < mulai && now < a.An.T2 {
			return lvl, false
		}
		pv, ok := lvlTrack.prevLevel(a.ID, *a.An)
		...
	}
```

Catatan: syaratnya `now < T1 && now < T2` supaya benar juga untuk anchor terbalik (T2 < T1) tanpa perlu menormalkan ulang di sini.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `go test ./... -run TestEvalAlert -v`
Expected: PASS, termasuk semua `TestEvalAlert*` lama dari #180.

- [ ] **Step 5: Commit**

```bash
git add alert_monitor.go alert_monitor_test.go
git commit -m "fix(alert): jangan awasi garis yang kedua anchornya masih di masa depan

Levelnya cuma bisa didapat dgn ekstrapolasi ke kiri, ke bagian garis yang tak
digambar siapa pun. Begitu waktu melewati anchor pertama, alert hidup sendiri.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tolak garis miring yang tak punya waktu dagang

**Files:**
- Modify: `store.go` (sentinel error dekat `ErrAlertVertical`; `CreateAlert`; `UpdateAlertAnchors`)
- Modify: `api.go:210-230` (create) dan `api.go:300-310` (anchors)
- Test: `store_line_alerts_test.go`, `api_line_alerts_test.go`

**Interfaces:**
- Consumes: `tradingElapsed` (Task 1)
- Produces: `var ErrAlertNoTradingSpan = errors.New("garis tak punya waktu dagang di antara kedua ujungnya")`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `store_line_alerts_test.go`:

```go
// Garis MIRING yang kedua anchornya jatuh di akhir pekan yang sama tak punya "harga pada waktu t"
// yang bisa diinterpolasi — ditolak di pintu masuk, seperti garis vertikal.
func TestCreateAlertMiringTanpaWaktuDagang(t *testing.T) {
	s := mustTestStore(t)
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
	s := mustTestStore(t)
	sabtu := nyMs(t, 2026, time.January, 10, 8, 0)
	an := LineAnchors{T1: sabtu, P1: 1.10, T2: sabtu + 1, P2: 1.10}
	if _, err := s.CreateAlert(1, "EUR_USD", 0, 1000, "cross", "did-2", &an); err != nil {
		t.Fatalf("alert horizontal ditolak: %v", err)
	}
}

// Jalur update anchor dijaga sama — kalau tidak, penolakan saat create bisa dilewati dgn
// membuat alert pada garis yang sah lalu menyeretnya ke akhir pekan.
func TestUpdateAnchorsMiringTanpaWaktuDagang(t *testing.T) {
	s := mustTestStore(t)
	senin := nyMs(t, 2026, time.January, 12, 9, 0)
	an := LineAnchors{T1: senin, P1: 1.10, T2: senin + 3*jam, P2: 1.20}
	id, err := s.CreateAlert(1, "EUR_USD", 0, 1000, "cross", "did-3", &an)
	if err != nil {
		t.Fatalf("setup gagal: %v", err)
	}
	sabtu := nyMs(t, 2026, time.January, 10, 8, 0)
	buruk := LineAnchors{T1: sabtu, P1: 1.10, T2: sabtu + 3*jam, P2: 1.20}
	if err := s.UpdateAlertAnchors(1, id, buruk); !errors.Is(err, ErrAlertNoTradingSpan) {
		t.Fatalf("err = %v, mau ErrAlertNoTradingSpan", err)
	}
	// Anchor lama harus utuh — penolakan tak boleh menulis separuh.
	rows, _ := s.AllActiveAlerts()
	if len(rows) != 1 || rows[0].An.T1 != senin {
		t.Fatalf("anchor lama ikut berubah: %+v", rows)
	}
}
```

Pastikan `errors` dan `time` ada di import berkas test itu. Helper `nyMs`/`jam` sudah ada dari `session_test.go` (paket sama).

Tambahkan ke `api_line_alerts_test.go` (pola `TestVerticalLineRejected` yang sudah ada, dengan `strconv` untuk menyuntikkan waktu akhir pekan ke JSON):

```go
// Garis miring di akhir pekan ditolak 400, dan pesannya bahasa INGGRIS — pesan store
// ("garis tak punya waktu dagang…") tak boleh sampai ke body HTTP.
func TestSlopedLineNoTradingSpanRejected(t *testing.T) {
	storeForLineAlertAPI(t)
	sabtu := nyMs(t, 2026, time.January, 10, 8, 0)
	body := `{"instrument":"EUR_USD","cond":"cross","drawId":"d-1"` +
		`,"t1":` + strconv.FormatInt(sabtu, 10) + `,"p1":1.10` +
		`,"t2":` + strconv.FormatInt(sabtu+3*jam, 10) + `,"p2":1.20}`
	w := httptest.NewRecorder()
	handleAlertCreate(w, reqUser("POST", "/api/alerts", body, 1))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("garis miring tanpa waktu dagang harus 400, dapat %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "no market time") {
		t.Fatalf("pesan harus bahasa Inggris, dapat %q", w.Body.String())
	}
}

// Regresi #180 lewat jalur HTTP: garis HORIZONTAL di akhir pekan tetap 200.
func TestHorizontalLineNoTradingSpanAccepted(t *testing.T) {
	storeForLineAlertAPI(t)
	sabtu := nyMs(t, 2026, time.January, 10, 8, 0)
	body := `{"instrument":"EUR_USD","cond":"cross","drawId":"d-2"` +
		`,"t1":` + strconv.FormatInt(sabtu, 10) + `,"p1":1.10` +
		`,"t2":` + strconv.FormatInt(sabtu+1, 10) + `,"p2":1.10}`
	w := httptest.NewRecorder()
	handleAlertCreate(w, reqUser("POST", "/api/alerts", body, 1))
	if w.Code != http.StatusOK {
		t.Fatalf("garis horizontal harus tetap 200, dapat %d body=%s", w.Code, w.Body.String())
	}
}
```

Pastikan `strings` dan `time` masuk import berkas itu (`strconv` & `net/http` sudah ada).

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `go test ./... -run 'TestCreateAlertMiring|TestUpdateAnchorsMiring'`
Expected: FAIL — `undefined: ErrAlertNoTradingSpan`.

- [ ] **Step 3: Implementasi**

Di `store.go`, tambahkan sentinel ketiga ke blok `var (...)` yang sudah memuat `ErrAlertCond` dan `ErrAlertVertical`:

```go
	// Garis MIRING yang kedua ujungnya jatuh di jendela pasar-tutup yang sama tak punya
	// waktu dagang untuk diinterpolasi. Hanya berlaku bila P1 != P2: garis horizontal
	// levelnya konstan, dan miliknya memang boleh berspan nol (lihat #180, t2 = t1+1).
	ErrAlertNoTradingSpan = errors.New("garis tak punya waktu dagang di antara kedua ujungnya")
```

Tambahkan satu helper di `store.go` dekat `LineAnchors` supaya kedua pemanggil memakai aturan yang sama persis:

```go
// validAnchors menolak dua bentuk anchor yang tak bisa dievaluasi. Dipakai CreateAlert dan
// UpdateAlertAnchors — satu tempat, supaya penolakan saat create tak bisa dilewati dengan
// membuat alert pada garis yang sah lalu menyeretnya.
func validAnchors(instrument string, an LineAnchors) error {
	if an.T1 == an.T2 {
		return ErrAlertVertical
	}
	if an.P1 != an.P2 && tradingElapsed(instrument, an.T1, an.T2) == 0 {
		return ErrAlertNoTradingSpan
	}
	return nil
}
```

Di `CreateAlert`, ganti blok cek vertikal dengan:

```go
		if err := validAnchors(instrument, *an); err != nil {
			return 0, err
		}
```

Di `UpdateAlertAnchors`, ganti `if an.T1 == an.T2 { return ErrAlertVertical }` dengan pembacaan instrumen dari baris alert itu sendiri, lalu validasi. **Tanda tangannya tidak berubah** — instrumen sengaja diambil dari DB, bukan dari body request, supaya klien tak bisa memilih model sesi yang lebih longgar dengan mengaku instrumen lain:

```go
	// Instrumen dibaca dari barisnya sendiri: model sesi (24/5 vs 24/7) menentukan apakah anchor
	// ini sah, jadi ia tak boleh berasal dari muatan yang dikirim klien.
	var instrument string
	if err := s.db.QueryRow(`SELECT instrument FROM price_alerts WHERE id=? AND user_id=? AND draw_id IS NOT NULL`,
		id, uid).Scan(&instrument); err != nil {
		return fmt.Errorf("alert not found")
	}
	if err := validAnchors(instrument, an); err != nil {
		return err
	}
```

Baris `UPDATE` di bawahnya tetap apa adanya, termasuk cek `RowsAffected() == 0`.

Di `api.go` (handler create), sesudah cek vertikal yang sudah ada, tambahkan:

```go
		// Pesan store berbahasa Indonesia tak boleh sampai ke body HTTP — alasan yang sama
		// dengan penolakan vertikal tepat di atas.
		if *req.P1 != *req.P2 && tradingElapsed(req.Instrument, *req.T1, *req.T2) == 0 {
			writeErr(w, http.StatusBadRequest, "line has no market time between its two points")
			return
		}
```

Di handler anchors, terjemahkan error store yang kembali:

```go
	if err := store.UpdateAlertAnchors(uid, req.ID, LineAnchors{T1: req.T1, P1: req.P1, T2: req.T2, P2: req.P2}); err != nil {
		if errors.Is(err, ErrAlertVertical) {
			writeErr(w, http.StatusBadRequest, "line cannot be vertical")
			return
		}
		if errors.Is(err, ErrAlertNoTradingSpan) {
			writeErr(w, http.StatusBadRequest, "line has no market time between its two points")
			return
		}
		...biarkan penanganan error yang sudah ada...
	}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `go test ./...`
Expected: PASS semua — termasuk `TestCreateAlertHorizontalTanpaWaktuDagangTetapSah` (regresi #180).

- [ ] **Step 5: Commit**

```bash
git add store.go api.go store_line_alerts_test.go api_line_alerts_test.go
git commit -m "feat(alert): tolak garis miring yang tak punya waktu dagang di antara ujungnya

validAnchors dipakai create DAN update anchor — kalau tidak, penolakan bisa
dilewati dgn membuat alert pada garis sah lalu menyeretnya ke akhir pekan.
Garis horizontal berspan nol tetap sah (regresi #180: t2 = t1+1).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Frontend membuka tiga tool miring

**Files:**
- Modify: `js/draw-alert.js:1-39` (komentar kepala, `ALERTABLE_LINE`, `lineAnchorsOf`)
- Test: `tests/drawing/86-alert-garis.spec.js` (balik test yang menegaskan tool miring TIDAK alertable)

**Interfaces:**
- Consumes: endpoint `/api/alerts` (Task 4)
- Produces: `SLOPED_LINE` (Set) dan `ALERTABLE_LINE` (Set) — keduanya global, dibaca test lewat `page.evaluate`.

- [ ] **Step 1: Balik test yang ada + tambah test anchor**

Di `tests/drawing/86-alert-garis.spec.js`:

1. Ganti blok komentar kepala berkas: v1 horizontal-saja sudah tak berlaku; rujuk spec baru `2026-08-09-alert-garis-miring-design.md` dan sebutkan zona (rect/channel) yang masih ditunda.
2. Ganti test `tab Alert TIDAK muncul untuk ${name} (garis miring ditunda ke spec kedua)` menjadi kebalikannya:

```js
  for (const name of SLOPED_TOOLS) {
    test(`tab Alert muncul untuk ${name} (garis miring)`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'style'), obj.id);
      await expect(page.locator('.dm-tab[data-tab="alert"]')).toBeVisible();
      expect(await page.evaluate((n) => ALERTABLE_LINE.has(n), name), `${name} harus alertable`).toBe(true);
      assertNoPageErrors(page);
    });
  }
```

3. Tambahkan test anchor untuk tool miring (p1 ≠ p2 dan t1 < t2 — kebalikan dari invarian horizontal):

```js
  for (const name of SLOPED_TOOLS) {
    test(`${name}: POST alert membawa anchor MIRING yang menaik (t1<t2, p1!==p2)`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      const an = await page.evaluate((id) => lineAnchorsOf(id), obj.id);
      expect(an, 'anchor harus terbentuk').not.toBeNull();
      expect(an.t1, 't1 harus lebih awal dari t2 (dinormalkan)').toBeLessThan(an.t2);
      expect(an.p1, 'garis miring: harga kedua ujung berbeda').not.toBe(an.p2);
      assertNoPageErrors(page);
    });
  }
```

4. Tambahkan test normalisasi arah gambar. `drawTool` menggambar kiri→kanan; gambar manual mundur:

```js
  test('garis digambar KANAN ke KIRI tetap menghasilkan anchor menaik', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await armTool(page, 'trendline');
    await clickAt(page, rect, { x: Math.round(rect.width * 0.6), y: Math.round(rect.height * 0.3) });
    await page.waitForTimeout(CLICK_GAP_MS);
    await clickAt(page, rect, { x: Math.round(rect.width * 0.3), y: Math.round(rect.height * 0.6) });
    await page.waitForTimeout(CLICK_GAP_MS);
    await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
    const obj = (await overlays(page))[0];
    const an = await page.evaluate((id) => lineAnchorsOf(id), obj.id);
    expect(an.t1).toBeLessThan(an.t2);
    assertNoPageErrors(page);
  });
```

5. Test `tab Alert TIDAK muncul untuk rect (zona = spec kedua)` **dibiarkan apa adanya** — rectangle memang masih di luar cakupan.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npx playwright test tests/drawing/86-alert-garis.spec.js --project=hermetic`
Expected: FAIL pada test tool miring (`ALERTABLE_LINE` belum memuatnya, tab Alert tak muncul).

- [ ] **Step 3: Implementasi**

Di `js/draw-alert.js`, ganti blok komentar v1-horizontal-saja (baris 4–17) dan `lineAnchorsOf` dengan:

```js
// Tool yang bisa dijadikan alert. Dua keluarga, dan pembedaannya BUKAN kosmetik: anchor keduanya
// dibaca dengan aturan berbeda (lihat lineAnchorsOf).
//
// Garis miring dibuka di spec kedua (2026-08-09-alert-garis-miring-design.md) setelah basis
// waktunya diperbaiki: monitor kini menginterpolasi level dalam JAM DAGANG (session.go), bukan
// waktu kalender, sehingga level yang diawasi sama dengan garis yang digambar di sumbu indeks-bar.
// Sebelum itu, garis miring yang diekstrapolasi berlari 28,6% mendahului garisnya sendiri.
//
// Zona (rect, parallelStraightLine, priceChannelLine) masih di luar: ia butuh kondisi enter/exit
// dan level KEDUA, bukan sekadar basis waktu.
const SLOPED_LINE=new Set(['trendline','rayLine','straightLine']);
const ALERTABLE_LINE=new Set(['horizontalStraightLine','horizontalRayLine','priceLine',...SLOPED_LINE]);

// Dua anchor objek sebagai {t1,p1,t2,p2} waktu wall-clock — bentuk yang dipahami server.
// Selalu MENAIK (t1 < t2): garis boleh digambar kanan ke kiri, dan server memakai selisih waktu
// dagang sebagai penyebut. Normalisasi di sini menutup create maupun syncAlertAnchors sekaligus,
// jadi pembandingan "anchor berubah?" tetap stabil — satu bentuk geometris punya satu representasi.
//
// Garis MIRING: kedua titik dibaca sungguhan. Kalau titik kedua hilang atau waktunya kembar,
// objeknya DITOLAK — tidak jatuh ke fallback t1+1 milik tool 1-klik, sebab untuk garis miring
// fallback itu mengarang kemiringan yang praktis tak hingga.
//
// Garis HORIZONTAL: harga diambil dari points[0] untuk KEDUA anchor, jadi `p1===p2` benar SECARA
// KONSTRUKSI. `horizontalRayLine` punya dua titik yang nilainya tak selalu tersinkron (muatan lama
// terutama) — "garis horizontal" yang anchornya berselisih adalah alert MIRING berkostum
// horizontal, dan levelnya akan berjalan. Waktu: `horizontalStraightLine` & `priceLine` cuma punya
// 1 TITIK, jadi t2 dibuat t1+1; intervalnya tak bermakna karena p1===p2 membuat level konstan untuk
// interval APA PUN — yang penting hanya t1!==t2 karena server menolak "garis vertikal".
function lineAnchorsOf(overlayId){
  const o=chart.getOverlayById(overlayId); if(!o||!o.points||!o.points.length) return null;
  const a=o.points[0];
  const t1=tsOf(a); if(t1==null||a.value==null) return null;
  if(SLOPED_LINE.has(o.name)){
    const b=o.points[1]; if(!b||b.value==null) return null;
    const t2=tsOf(b); if(t2==null||t2===t1) return null;
    return t1<t2 ? {t1, p1:a.value, t2, p2:b.value} : {t1:t2, p1:b.value, t2:t1, p2:a.value};
  }
  let t2=t1+1;
  if(o.points.length>1){ const tb=tsOf(o.points[1]); if(tb!=null && tb!==t1) t2=tb; }
  return (t1<t2) ? {t1, p1:a.value, t2, p2:a.value} : {t1:t2, p1:a.value, t2:t1, p2:a.value};
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npx playwright test tests/drawing/86-alert-garis.spec.js --project=hermetic`
Expected: PASS semua (termasuk 3 tool horizontal & test rect yang tak berubah).

- [ ] **Step 5: Smoke**

Run: `npx playwright test tests/smoke --project=hermetic`
Expected: 22 test PASS. `module-hygiene` & `boot-integrity` khususnya harus hijau — tak ada modul baru, jadi tak boleh ada `SENTINEL` baru.

- [ ] **Step 6: Commit**

```bash
git add js/draw-alert.js tests/drawing/86-alert-garis.spec.js
git commit -m "feat(alert): buka alert untuk trendline, ray, dan extended line

Anchor tool miring dibaca sungguhan dari kedua titik & dinormalkan menaik
(garis boleh digambar kanan ke kiri). Aturan p1===p2 utk tool horizontal tetap
utuh — ia yang menahan alert miring berkostum horizontal.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Perbarui `TOOL_SPEC` & verifikasi menyeluruh

**Files:**
- Modify: `tests/helpers/spec.js` (kolom yang menandai tool alertable, bila ada)
- Modify: `docs/superpowers/specs/2026-08-09-alert-garis-miring-design.md` (isi angka jeda harian hasil pengukuran)

**Interfaces:**
- Consumes: semua task sebelumnya.
- Produces: PR siap review.

- [ ] **Step 1: Periksa apakah `TOOL_SPEC` menandai alertable**

Run: `grep -n "alert" tests/helpers/spec.js`
Kalau ada kolom `alert`, setel `true` untuk `trendline`, `rayLine`, `straightLine`. Kalau **tidak ada** kolom seperti itu, jangan mengarangnya — lewati langkah ini dan catat di badan PR bahwa `TOOL_SPEC` tak punya dimensi alert.

- [ ] **Step 2: Suite drawing penuh (bukan cuma satu berkas)**

Run: `npx playwright test tests/drawing --project=hermetic`
Expected: PASS. Berkas lain menyentuh trendline (clone, copy-paste, constrain, magnet) — perubahan `lineAnchorsOf` tak boleh menyenggol mereka.

- [ ] **Step 3: Ukur jeda harian indeks/energi dari candle nyata**

Butuh `.env` (OANDA token). Jalankan server lokal, lalu ambil candle H1 dan hitung berapa jam per hari kerja yang benar-benar punya bar:

```bash
PORT=8765 ./luna-trade &
sleep 3
for sym in DE30_EUR UK100_GBP JP225_USD WTICO_USD; do
  echo -n "$sym: "
  curl -s "http://localhost:8765/api/candles?instrument=$sym&tf=H1&count=240" \
    | grep -o '"timestamp"' | wc -l
done
```

240 bar H1 = 10 hari kalender kalau 24 jam/hari. Bandingkan jumlah bar yang benar-benar dikembalikan terhadap rentang waktunya untuk mendapat jam-dagang per hari kerja. **Tulis angka hasilnya** ke bagian "Batas ketelitian yang diterima" di spec, menggantikan kalimat rencana pengukuran. Kalau server tak bisa dijalankan (tak ada `.env`/token), tulis itu apa adanya di spec — jangan menebak angka.

- [ ] **Step 4: `go vet` & build**

Run: `go vet ./... && go build ./... && go test ./...`
Expected: bersih.

- [ ] **Step 5: Commit & buka PR**

```bash
git add -A
git commit -m "docs(alert): angka jeda harian indeks/energi hasil pengukuran candle H1

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin zihar/zihar/feat/alert-garis-miring
gh pr create --base main --title "feat(alert): alert dari garis miring — basis waktu jam-dagang" --body "..."
```

Badan PR wajib memuat: masalah wall-clock yang diwarisi #180, dua model sesi & kenapa cuma dua (hub tak menyiarkan saham), aturan geometri, apa yang **tidak** berubah (skema DB, levelTracker, UI daftar), risiko rollback asimetris, dan bahwa zona menyusul di PR berikutnya.

- [ ] **Step 6: Tunggu CI hijau, lalu merge lewat skrip**

Run: `gh pr checks --watch` lalu `scripts/merge-pr.sh <n>`
Jangan `gh pr merge` langsung — skrip menolak PR yang checknya pending atau yang ketinggalan dari main.

---

## Catatan untuk pelaksana

- **Jangan menyentuh `levelTracker`, `prevLevel`, `sideHit`, `syncAlertAnchors`, atau `sweepAlertsForMissingDrawings`.** Semuanya sudah benar untuk garis miring; spec menjelaskan kenapa.
- **Jangan menambah kolom DB.** Kalau terasa perlu, berarti ada yang menyimpang dari spec.
- Pemicuan sungguhan hanya bisa diuji saat pasar buka — bukti utamanya test Go dengan waktu sintetis, bukan browser.
