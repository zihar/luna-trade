# Alert dari Objek Gambar — Garis (A5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klik-kanan sebuah garis → tab **Alert** → pilih kondisi → alert dibuat dan **terikat pada garis itu**; levelnya mengikuti garis (berubah seiring waktu untuk garis miring), dan menggeser garis memindahkan alertnya.

**Architecture:** Alert garis bukan jenis alert baru — ia alert yang levelnya berubah. Karena itu ia menumpang tabel `price_alerts` + monitor yang sudah ada, dengan kolom nullable tambahan (`cond`, `draw_id`, `t1/p1/t2/p2`). Level dihitung `level(t)` dari dua anchor; garis horizontal menghasilkan `p1==p2` sehingga rumus yang sama memberi konstanta — satu jalur kode untuk miring dan datar. Ikatan ke objek memakai id stabil baru (`did`) yang hidup di peta samping `objDid`, pola yang sudah dipakai `objStyle`.

**Tech Stack:** Go (`modernc.org/sqlite`, `net/http` Go 1.22 mux), JavaScript classic script tanpa bundler, Playwright E2E (`--project=hermetic`), `go test`.

**Spec:** `docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md` — baca dulu; setiap keputusan berasal dari sana.

## Global Constraints

- **Teks UI bahasa Inggris**; komentar kode & commit boleh Indonesian, dan komentar menjelaskan **KENAPA**.
- **Modul JS baru WAJIB dapat entri `SENTINEL`** di `tests/smoke/boot-integrity.spec.js`.
- **Playwright WAJIB `--project=hermetic`**; jangan `npm test` (suite 5–7 mnt, sudah di CI).
- **Repo hanya GET & POST** — jangan memperkenalkan PUT/DELETE.
- Endpoint baru wajib di balik `requireUser` (`auth.go:176`).
- Kondisi yang didukung persis tiga: `cross`, `up`, `down`. *Greater/Less than* **di luar cakupan**.
- **[Amandemen 2026-08-09, review akhir cabang — C1]** Objek yang didukung persis **tiga**, semuanya HORIZONTAL: `horizontalStraightLine`, `horizontalRayLine`, `priceLine`. **Garis miring** (`trendline`, `rayLine`, `straightLine`) menyusul di **spec kedua**, bersama channel & rectangle. Alasannya basis waktu: anchor alert adalah milidetik **wall-clock** dan monitor mengekstrapolasi dalam waktu **kalender**, sedangkan chart menggambar sumbu-x dalam **indeks bar** — keduanya cuma sepakat pada instrumen tanpa jeda sesi (forex libur ~48 dari 168 jam/pekan; saham ~17,5 dari 24 jam/hari). Keputusan wall-clock dibuat **tanpa menganalisis jeda sesi**; itu cacat spec, bukan cacat implementasi. Garis horizontal levelnya konstan sehingga basis waktunya tak berpengaruh — karena itu ia yang dirilis lebih dulu. Tool miring **tidak** diterima walau kebetulan datar (`p1===p2`): satu seretan ujung sesudahnya mengembalikan persis kasus yang ditunda.
- Untuk tool yang didukung, `p1===p2` dijamin **secara konstruksi**: harga diambil dari `points[0]` untuk KEDUA anchor (nilai titik kedua `horizontalRayLine` tak selalu tersinkron di muatan lama).
- Garis dievaluasi sebagai **perpanjangan tak hingga**; `t1==t2` **ditolak saat pembuatan**.
- **[Amandemen 2026-08-09, review akhir cabang — C2 + I1]** Task 2 & 3 di bawah masih menuliskan API monitor versi awal (`condHit(cond, prev, cur, lvl)` + `crossedByLevelMove`). Keduanya **sudah diganti** oleh satu predikat `sideHit(cond, dPrev, dCur)` atas jarak `d = harga − level`, dengan `dPrev` diukur terhadap level **sebelumnya** dari `levelTracker`. Alasannya: `condHit` membandingkan harga LAMA dengan level BARU (mengarang persilangan tiap kali level melompat), dan jalur "level bergerak" menyala tanpa melihat `cond` sama sekali (alert `up` menyala saat garis bergerak TURUN — dan one-shot membuat persilangan sungguhannya tak pernah bisa menyala lagi). Potongan kode Task 2/3 di bawah dibiarkan apa adanya sebagai catatan sejarah; `alert_monitor.go` adalah acuannya.
- Branch: `zihar/zihar/feat/alert-dari-garis`. Commit conventional Indonesian + trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Store — kolom, struct, dan CRUD alert garis

**Files:**
- Modify: `store.go` (skema alert `:177`, `Alert`/`AlertRow` `:750-765`, `CreateAlert` `:768`, `ListAlerts` `:778`, `AllActiveAlerts` `:815`)
- Test: `store_line_alerts_test.go` (baru)

**Interfaces:**
- Produces:
  - `LineAnchors struct { T1, T2 int64; P1, P2 float64 }`
  - `CreateAlert(uid int64, instrument string, price float64, createdAt int64, cond string, drawID string, an *LineAnchors) (int64, error)` — `cond` kosong dianggap `"cross"`; `an` nil = alert harga biasa
  - `UpdateAlertAnchors(uid, id int64, an LineAnchors) error`
  - `DeleteAlertsByDrawing(uid int64, instrument, drawID string) (int, error)` — mengembalikan jumlah baris terhapus
  - `Alert` & `AlertRow` bertambah field `Cond string`, `DrawID string`, `An *LineAnchors`

- [ ] **Step 1: Tulis test yang gagal**

Buat `store_line_alerts_test.go`:

```go
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
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `go test -run 'TestPlainAlert|TestLineAlert|TestUpdateAlertAnchors|TestDeleteAlertsByDrawing' .`
Expected: gagal kompilasi — `LineAnchors undefined`, jumlah argumen `CreateAlert` salah, `UpdateAlertAnchors`/`DeleteAlertsByDrawing` undefined.

- [ ] **Step 3: Tambah kolom & struct di `store.go`**

Di `migrate()`, di kelompok `addColumnIfMissing` yang sudah ada (`store.go:69`), tambahkan:

```go
	// Alert yang terikat objek gambar: level-nya bukan satu harga tetap melainkan garis antara dua
	// anchor. Kolom nullable + addColumnIfMissing supaya baris alert lama tetap sah tanpa migrasi.
	s.addColumnIfMissing("price_alerts", "cond", "TEXT")     // '' / 'cross' | 'up' | 'down'
	s.addColumnIfMissing("price_alerts", "draw_id", "TEXT")  // did objek gambar; NULL = alert harga biasa
	s.addColumnIfMissing("price_alerts", "t1", "INTEGER")
	s.addColumnIfMissing("price_alerts", "p1", "REAL")
	s.addColumnIfMissing("price_alerts", "t2", "INTEGER")
	s.addColumnIfMissing("price_alerts", "p2", "REAL")
```

Dekat `type Alert struct` (`store.go:750`):

```go
// LineAnchors = dua ujung garis yang jadi acuan alert: waktu wall-clock ms + harga.
// Disimpan apa adanya (bukan dataIndex) supaya monitor tak perlu tahu timeframe atau data candle.
type LineAnchors struct {
	T1, T2 int64
	P1, P2 float64
}
```

Tambahkan ke `Alert` dan `AlertRow`:

```go
	Cond   string       // 'cross' | 'up' | 'down'
	DrawID string       // did objek gambar; "" untuk alert harga biasa
	An     *LineAnchors // nil untuk alert harga biasa
```

- [ ] **Step 4: Perbarui CRUD di `store.go`**

Ganti `CreateAlert` dan tambahkan dua fungsi baru:

```go
// CreateAlert membuat alert baru untuk user, aktif sejak dibuat.
// `an` nil → alert harga biasa (level tetap = price). `an` terisi → alert terikat garis:
// level-nya dihitung dari dua anchor, dan `price` tak dipakai.
// cond kosong dinormalkan jadi "cross" supaya pemanggil lama tak perlu tahu soal kondisi.
func (s *Store) CreateAlert(uid int64, instrument string, price float64, createdAt int64,
	cond, drawID string, an *LineAnchors) (int64, error) {
	if cond == "" {
		cond = "cross"
	}
	if cond != "cross" && cond != "up" && cond != "down" {
		return 0, fmt.Errorf("kondisi tak dikenal: %s", cond)
	}
	var t1, t2 any
	var p1, p2 any
	if an != nil {
		// Garis vertikal tak punya "harga pada waktu t" yang bermakna → tolak di pintu masuk,
		// bukan dijaga diam-diam saat evaluasi.
		if an.T1 == an.T2 {
			return 0, fmt.Errorf("garis vertikal tak bisa dijadikan alert")
		}
		t1, p1, t2, p2 = an.T1, an.P1, an.T2, an.P2
	}
	res, err := s.db.Exec(`INSERT INTO price_alerts(user_id,instrument,price,active,created_at,cond,draw_id,t1,p1,t2,p2)
		VALUES(?,?,?,1,?,?,?,?,?,?,?)`,
		uid, instrument, price, createdAt, cond, nullIfEmpty(drawID), t1, p1, t2, p2)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// nullIfEmpty menyimpan string kosong sebagai NULL supaya "bukan alert garis" punya SATU
// representasi di DB, bukan dua ('' dan NULL) yang harus dicek dua-duanya di setiap query.
func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// UpdateAlertAnchors memindahkan acuan garis sebuah alert (dipakai saat pengguna menggeser
// objeknya). Alert-nya tetap alert yang sama — id, kondisi, dan status triggered tak tersentuh.
func (s *Store) UpdateAlertAnchors(uid, id int64, an LineAnchors) error {
	if an.T1 == an.T2 {
		return fmt.Errorf("garis vertikal tak bisa dijadikan alert")
	}
	res, err := s.db.Exec(`UPDATE price_alerts SET t1=?,p1=?,t2=?,p2=? WHERE id=? AND user_id=? AND draw_id IS NOT NULL`,
		an.T1, an.P1, an.T2, an.P2, id, uid)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("alert not found")
	}
	return nil
}

// DeleteAlertsByDrawing menghapus semua alert milik uid yang terikat objek gambar tertentu.
// Berkunci (instrument, draw_id): `did` unik per objek, tapi menyertakan instrumen membuat
// penyapuan saat memuat satu instrumen tak mungkin menyentuh alert instrumen lain.
func (s *Store) DeleteAlertsByDrawing(uid int64, instrument, drawID string) (int, error) {
	if drawID == "" {
		return 0, fmt.Errorf("drawID kosong")
	}
	res, err := s.db.Exec(`DELETE FROM price_alerts WHERE user_id=? AND instrument=? AND draw_id=?`,
		uid, instrument, drawID)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}
```

Di `ListAlerts` dan `AllActiveAlerts`, tambahkan kolom baru ke `SELECT` dan `Scan`. Karena kolomnya nullable, pakai penampung pointer lalu salin — pola yang sama dengan `triggered_at` yang sudah ada:

```go
	// contoh untuk AllActiveAlerts; ListAlerts sama polanya
	rows, err := s.db.Query(`SELECT user_id,id,instrument,price,
		COALESCE(cond,'cross'),COALESCE(draw_id,''),t1,p1,t2,p2 FROM price_alerts WHERE active=1`)
	…
	var t1, t2 *int64
	var p1, p2 *float64
	if err := rows.Scan(&r.UserID, &r.ID, &r.Instrument, &r.Price, &r.Cond, &r.DrawID, &t1, &p1, &t2, &p2); err != nil {
		return nil, err
	}
	if t1 != nil && t2 != nil && p1 != nil && p2 != nil {
		r.An = &LineAnchors{T1: *t1, T2: *t2, P1: *p1, P2: *p2}
	}
```

Pemanggil lama `CreateAlert` (cari dengan `grep -rn "CreateAlert(" *.go`) diperbarui dengan `"", "", nil`.

- [ ] **Step 5: Jalankan test — harus LULUS**

Run: `go test ./...`
Expected: seluruhnya `ok` — 4 test baru + semua test alert lama tetap hijau.

- [ ] **Step 6: Commit**

```bash
git add store.go store_line_alerts_test.go
git commit -m "$(cat <<'EOF'
feat(alert): kolom & CRUD untuk alert yang terikat garis

Menumpang price_alerts dgn kolom nullable (cond, draw_id, t1/p1/t2/p2)
lewat addColumnIfMissing — baris lama tetap sah tanpa migrasi. Garis
vertikal ditolak di pintu masuk, bukan dijaga diam-diam saat evaluasi.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Monitor — `level(t)` + tiga kondisi

**Files:**
- Modify: `alert_monitor.go` (`crossed` `:14`, loop evaluasi `:60-72`)
- Test: `alert_monitor_test.go` (tambah, jangan ubah `TestCrossed`/`TestMonitorOneShot`)

**Interfaces:**
- Consumes: `AlertRow` + `Cond`/`An` (Task 1)
- Produces:
  - `levelAt(r AlertRow, now int64) float64` — level alert pada waktu `now`
  - `condHit(cond string, prev, cur, lvl float64) bool`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `alert_monitor_test.go`:

```go
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
		cond             string
		prev, cur, lvl   float64
		want             bool
		why              string
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
```

Catatan untuk implementer: test terakhir memakai `crossedByLevelMove(prevLvl, curLvl, price)` — helper yang **belum ada** dan memang bagian dari Step 3. Ia menjawab kasus yang `crossed()` sendiri tak bisa lihat: harga tak berubah, levelnya yang bergerak melintasi harga.

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `go test -run 'TestLevelAt|TestCondHit|TestSlopedLine' .`
Expected: gagal kompilasi — `levelAt`, `condHit`, `crossedByLevelMove` undefined.

- [ ] **Step 3: Implementasi di `alert_monitor.go`**

```go
// levelAt = level alert pada waktu `now`.
// Alert harga biasa (An nil) → kolom price. Alert garis → interpolasi dua anchor, dan sengaja
// diekstrapolasi di luar ruasnya: trader menggambar trendline justru untuk mengawasi apa yang
// terjadi SESUDAH titik terakhir, jadi alert yang mati di ujung ruas berhenti bekerja tepat saat
// paling dibutuhkan. Garis horizontal (p1==p2) jatuh ke rumus yang sama dan memberi konstanta —
// tak ada cabang "kalau horizontal maka…".
func levelAt(r AlertRow, now int64) float64 {
	if r.An == nil || r.An.T2 == r.An.T1 {
		return r.Price
	}
	f := float64(now-r.An.T1) / float64(r.An.T2-r.An.T1)
	return r.An.P1 + (r.An.P2-r.An.P1)*f
}

// condHit menerjemahkan kondisi pengguna jadi keputusan menyala/tidak.
// `cross` memakai crossed() yang sudah ada (dua arah, termasuk sentuh tepat); `up`/`down` adalah
// separuhnya masing-masing.
func condHit(cond string, prev, cur, lvl float64) bool {
	switch cond {
	case "up":
		return prev < lvl && cur >= lvl
	case "down":
		return prev > lvl && cur <= lvl
	default:
		return crossed(prev, cur, lvl)
	}
}

// crossedByLevelMove menangani hal yang tak bisa dilihat dgn membandingkan harga saja: harga DIAM
// sementara GARISNYA yang bergerak melewatinya. Tanpa ini, trendline curam bisa menyeberangi harga
// di antara dua tick dan tak pernah menyalakan alert.
func crossedByLevelMove(prevLvl, curLvl, price float64) bool {
	return (prevLvl < price && curLvl >= price) || (prevLvl > price && curLvl <= price)
}
```

Di loop evaluasi (`alert_monitor.go:60-72`), ganti cabang pemeriksaan menjadi:

```go
				now := time.Now().UnixMilli()
				for _, a := range cache {
					if !strings.EqualFold(a.Instrument, string(t.Instrument)) {
						continue
					}
					lvl := levelAt(a, now)
					hit := condHit(a.Cond, prev, mid, lvl)
					// Garis miring: level bergerak sendiri, jadi ia bisa menyeberangi harga yang
					// diam. Butuh level pada tick SEBELUMNYA untuk melihatnya.
					if !hit && a.An != nil {
						if pv, ok := lastLvl[a.ID]; ok && crossedByLevelMove(pv, lvl, mid) {
							hit = true
						}
					}
					lastLvl[a.ID] = lvl
					if hit {
						if err := store.MarkAlertTriggered(a.ID, now); err == nil {
							log.Printf("alert monitor: triggered #%d %s @ %.5f (level %.5f, cond %s)", a.ID, a.Instrument, mid, lvl, a.Cond)
							hitAny = true
						}
					}
				}
```

Deklarasikan `lastLvl := map[int64]float64{}` bersebelahan dengan `last := map[Instrument]float64{}` yang sudah ada, dan ganti nama variabel penanda dari `hit` lama jadi `hitAny` agar tak bertabrakan.

- [ ] **Step 4: Jalankan test — harus LULUS**

Run: `go test ./...`
Expected: seluruhnya `ok`.

- [ ] **Step 5: Commit**

```bash
git add alert_monitor.go alert_monitor_test.go
git commit -m "$(cat <<'EOF'
feat(alert): monitor mengevaluasi level garis + tiga kondisi

levelAt() menginterpolasi dua anchor & mengekstrapolasi di luar ruasnya;
horizontal jatuh ke rumus yang sama. crossedByLevelMove menangani hal yang
tak terlihat dari harga saja: harga DIAM, garisnya yang menyeberang.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: API — buat/geser/hapus alert garis

**Files:**
- Modify: `api.go` (`alertView` `:132`, `handleAlertCreate` `:157`, registrasi rute `:37-39`)
- Modify: `tests/fixtures/api.js` (stub `/api/alerts` menerima field baru)
- Test: `api_line_alerts_test.go` (baru)

**Interfaces:**
- Consumes: `CreateAlert(uid, instrument, price, createdAt, cond, drawID, an)`, `UpdateAlertAnchors`, `DeleteAlertsByDrawing` (Task 1)
- Produces: `handleAlertAnchors`, `handleAlertDeleteByDrawing`; `alertView` bertambah `cond`, `drawId`, `t1/p1/t2/p2`

- [ ] **Step 1: Tulis test yang gagal**

Buat `api_line_alerts_test.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func reqUser(method, target, body string, uid int64) *http.Request {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	return r.WithContext(context.WithValue(r.Context(), userIDCtxKey, uid))
}

func storeForLineAlertAPI(t *testing.T) {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	store = s
}

func TestCreateLineAlertViaAPI(t *testing.T) {
	storeForLineAlertAPI(t)
	w := httptest.NewRecorder()
	handleAlertCreate(w, reqUser("POST", "/api/alerts",
		`{"instrument":"EUR_USD","cond":"up","drawId":"d-1","t1":1000,"p1":1.10,"t2":2000,"p2":1.20}`, 1))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var got struct {
		Cond   string  `json:"cond"`
		DrawID string  `json:"drawId"`
		P2     float64 `json:"p2"`
	}
	json.Unmarshal(w.Body.Bytes(), &got)
	if got.Cond != "up" || got.DrawID != "d-1" || got.P2 != 1.20 {
		t.Fatalf("respons tak membawa field garis: %s", w.Body.String())
	}
}

// Alert harga biasa (tanpa anchor) tetap seperti sekarang.
func TestCreatePlainAlertViaAPIUnchanged(t *testing.T) {
	storeForLineAlertAPI(t)
	w := httptest.NewRecorder()
	handleAlertCreate(w, reqUser("POST", "/api/alerts", `{"instrument":"EUR_USD","price":1.2345}`, 1))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestVerticalLineRejected(t *testing.T) {
	storeForLineAlertAPI(t)
	w := httptest.NewRecorder()
	handleAlertCreate(w, reqUser("POST", "/api/alerts",
		`{"instrument":"EUR_USD","cond":"cross","drawId":"d-1","t1":1000,"p1":1.10,"t2":1000,"p2":1.20}`, 1))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("garis vertikal harus 400, dapat %d", w.Code)
	}
}

func TestUnknownCondRejected(t *testing.T) {
	storeForLineAlertAPI(t)
	w := httptest.NewRecorder()
	handleAlertCreate(w, reqUser("POST", "/api/alerts",
		`{"instrument":"EUR_USD","cond":"sideways","drawId":"d-1","t1":1000,"p1":1.1,"t2":2000,"p2":1.2}`, 1))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("kondisi tak dikenal harus 400, dapat %d", w.Code)
	}
}

func TestAnchorsUpdateViaAPI(t *testing.T) {
	storeForLineAlertAPI(t)
	an := LineAnchors{T1: 1000, P1: 1.10, T2: 2000, P2: 1.20}
	id, _ := store.CreateAlert(1, "EUR_USD", 0, 1, "cross", "d-1", &an)

	w := httptest.NewRecorder()
	handleAlertAnchors(w, reqUser("POST", "/api/alerts/anchors",
		`{"id":`+strconv.FormatInt(id, 10)+`,"t1":1500,"p1":1.30,"t2":2500,"p2":1.40}`, 1))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	rows, _ := store.AllActiveAlerts()
	if rows[0].An.P1 != 1.30 {
		t.Fatalf("anchor tak tersimpan: %+v", *rows[0].An)
	}
	// user lain ditolak
	w = httptest.NewRecorder()
	handleAlertAnchors(w, reqUser("POST", "/api/alerts/anchors",
		`{"id":`+strconv.FormatInt(id, 10)+`,"t1":1,"p1":9,"t2":2,"p2":9}`, 2))
	if w.Code == http.StatusOK {
		t.Fatalf("user lain tak boleh bisa menggeser")
	}
}

func TestDeleteByDrawingViaAPI(t *testing.T) {
	storeForLineAlertAPI(t)
	an := LineAnchors{T1: 1, P1: 1, T2: 2, P2: 2}
	store.CreateAlert(1, "EUR_USD", 0, 1, "cross", "d-1", &an)
	store.CreateAlert(1, "EUR_USD", 0, 1, "cross", "d-2", &an)

	w := httptest.NewRecorder()
	handleAlertDeleteByDrawing(w, reqUser("POST", "/api/alerts/by-drawing/delete",
		`{"instrument":"EUR_USD","drawId":"d-1"}`, 1))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	rows, _ := store.AllActiveAlerts()
	if len(rows) != 1 || rows[0].DrawID != "d-2" {
		t.Fatalf("salah baris terhapus: %+v", rows)
	}
}
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `go test -run 'TestCreateLineAlert|TestVerticalLine|TestUnknownCond|TestAnchorsUpdate|TestDeleteByDrawing' .`
Expected: gagal kompilasi — `handleAlertAnchors`/`handleAlertDeleteByDrawing` undefined, field `cond` tak dikenal.

- [ ] **Step 3: Perluas `alertView` & `handleAlertCreate`**

```go
type alertView struct {
	ID          int64    `json:"id"`
	Instrument  string   `json:"instrument"`
	Price       float64  `json:"price"`
	Active      bool     `json:"active"`
	CreatedAt   int64    `json:"createdAt"`
	TriggeredAt *int64   `json:"triggeredAt"`
	Cond        string   `json:"cond"`
	DrawID      string   `json:"drawId"`
	T1          *int64   `json:"t1"`
	P1          *float64 `json:"p1"`
	T2          *int64   `json:"t2"`
	P2          *float64 `json:"p2"`
}
```

`handleAlertCreate` menerima bentuk baru; **validasi harga hanya berlaku untuk alert biasa**, karena alert garis tak memakai kolom `price`:

```go
	var req struct {
		Instrument string   `json:"instrument"`
		Price      float64  `json:"price"`
		Cond       string   `json:"cond"`
		DrawID     string   `json:"drawId"`
		T1         *int64   `json:"t1"`
		P1         *float64 `json:"p1"`
		T2         *int64   `json:"t2"`
		P2         *float64 `json:"p2"`
	}
	…decode seperti sekarang…
	if req.Instrument == "" {
		writeErr(w, http.StatusBadRequest, "instrument required")
		return
	}
	var an *LineAnchors
	if req.DrawID != "" {
		if req.T1 == nil || req.P1 == nil || req.T2 == nil || req.P2 == nil {
			writeErr(w, http.StatusBadRequest, "line alert needs t1,p1,t2,p2")
			return
		}
		an = &LineAnchors{T1: *req.T1, P1: *req.P1, T2: *req.T2, P2: *req.P2}
	} else if req.Price <= 0 {
		writeErr(w, http.StatusBadRequest, "instrument & price required")
		return
	}
	id, err := store.CreateAlert(uid, req.Instrument, req.Price, time.Now().UnixMilli(), req.Cond, req.DrawID, an)
	if err != nil {
		// kondisi tak dikenal & garis vertikal adalah salah pemanggil, bukan salah server
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
```

Balasan memakai `alertView` yang sudah terisi field garis.

- [ ] **Step 4: Dua handler baru + rute**

```go
// POST /api/alerts/anchors — pengguna menggeser garisnya, alertnya ikut pindah.
func handleAlertAnchors(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	var req struct {
		ID int64   `json:"id"`
		T1 int64   `json:"t1"`
		P1 float64 `json:"p1"`
		T2 int64   `json:"t2"`
		P2 float64 `json:"p2"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if err := store.UpdateAlertAnchors(uid, req.ID, LineAnchors{T1: req.T1, P1: req.P1, T2: req.T2, P2: req.P2}); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// POST /api/alerts/by-drawing/delete — objek gambarnya dihapus, alertnya ikut.
func handleAlertDeleteByDrawing(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	var req struct {
		Instrument string `json:"instrument"`
		DrawID     string `json:"drawId"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if req.Instrument == "" || req.DrawID == "" {
		writeErr(w, http.StatusBadRequest, "instrument & drawId required")
		return
	}
	n, err := store.DeleteAlertsByDrawing(uid, req.Instrument, req.DrawID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"deleted": n})
}
```

Rute, sesudah `POST /api/alerts/delete`:

```go
	mux.HandleFunc("POST /api/alerts/anchors", requireUser(handleAlertAnchors))
	mux.HandleFunc("POST /api/alerts/by-drawing/delete", requireUser(handleAlertDeleteByDrawing))
```

- [ ] **Step 5: Stub hermetik menerima field baru**

Di `tests/fixtures/api.js`, pada `case '/api/alerts'` cabang POST, sertakan field garis di objek yang disimpan & dikembalikan:

```js
          const a = {
            id: state.nextId++,
            instrument: body.instrument || 'EUR_USD',
            price: body.price || 0,
            active: true,
            createdAt: Date.now(),
            triggeredAt: null,
            cond: body.cond || 'cross',
            drawId: body.drawId || '',
            t1: body.t1 ?? null, p1: body.p1 ?? null, t2: body.t2 ?? null, p2: body.p2 ?? null,
          };
```

dan tambahkan dua rute stub baru sebelum `default`:

```js
      case '/api/alerts/anchors': {
        const a = state.alerts.find((x) => x.id === body.id);
        if (a) Object.assign(a, { t1: body.t1, p1: body.p1, t2: body.t2, p2: body.p2 });
        return json(route, { ok: !!a });
      }
      case '/api/alerts/by-drawing/delete': {
        const before = state.alerts.length;
        state.alerts = state.alerts.filter((x) => !(x.instrument === body.instrument && x.drawId === body.drawId));
        return json(route, { deleted: before - state.alerts.length });
      }
```

- [ ] **Step 6: Jalankan — harus LULUS**

Run: `go test ./...` lalu `npx playwright test tests/smoke --project=hermetic`
Expected: dua-duanya hijau.

- [ ] **Step 7: Commit**

```bash
git add api.go api_line_alerts_test.go tests/fixtures/api.js
git commit -m "$(cat <<'EOF'
feat(alert): endpoint alert garis — buat, geser anchor, hapus per objek

Validasi harga hanya berlaku untuk alert biasa; alert garis tak memakai
kolom price. Kondisi tak dikenal & garis vertikal dijawab 400 karena itu
salah pemanggil, bukan salah server.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Klien — id stabil `did` pada objek gambar

**Files:**
- Create: `js/draw-did.js`
- Modify: `js/draw-persist.js` (`serializeDraws` `:14`, `buildDrawsFromArray` `:35`), `js/draw-tools.js` (pendaftaran `drawIds`), `js/draw-clone.js` (`createFromDesc`), `index.html`, `tests/smoke/boot-integrity.spec.js`
- Test: `tests/drawing/85-draw-did.spec.js` (baru)

**Interfaces:**
- Produces:
  - `objDid` — peta `overlayId → did`
  - `newDid() → string` — id acak stabil, mis. `d-<base36 waktu>-<base36 acak>`
  - `didOf(overlayId) → string` — memberi `did` baru bila objek itu belum punya (backfill)

- [ ] **Step 1: Tulis test yang gagal**

Buat `tests/drawing/85-draw-did.spec.js`:

```js
// Id stabil objek gambar (did) — prasyarat alert yang terikat objek.
// Spec: docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect } = require('../helpers/chart');
const { armTool, clickAt, overlays, CLICK_GAP_MS } = require('../helpers/draw');

async function drawLine(page, rect, f = {}) {
  const p1 = { x: Math.round(rect.width * (f.x1 ?? 0.36)), y: Math.round(rect.height * (f.y1 ?? 0.4)) };
  const p2 = { x: Math.round(rect.width * (f.x2 ?? 0.58)), y: Math.round(rect.height * (f.y2 ?? 0.6)) };
  await armTool(page, 'trendline');
  await clickAt(page, rect, p1);
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, p2);
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
}

test.describe('did: id stabil objek gambar', () => {
  test('objek baru dapat did, dan did ikut tersimpan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    const id = (await overlays(page))[0].id;
    const did = await page.evaluate((i) => objDid[i], id);
    expect(did, 'objek baru harus punya did').toBeTruthy();
    const ser = await page.evaluate(() => serializeDraws());
    expect(ser[0].did, 'did harus ikut terserialisasi').toBe(did);
    assertNoPageErrors(page);
  });

  test('did BERTAHAN lewat reload — itulah gunanya "stabil"', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    const did = await page.evaluate(() => objDid[drawIds[0]]);
    await page.waitForTimeout(2500);   // biarkan tersimpan ke server

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof chart !== 'undefined' && chart.getDataList().length > 0 && typeof drawIds !== 'undefined', null, { timeout: 20000 });
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    expect(await page.evaluate(() => objDid[drawIds[0]]), 'did harus sama sesudah reload').toBe(did);
    assertNoPageErrors(page);
  });

  test('objek lama tanpa did dapat did saat dimuat (backfill)', async ({ page }) => {
    await gotoApp(page);
    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);
    // muatan gaya lama: TANPA field did
    await page.evaluate((t) => {
      __seedDrawings(inst, [{ name: 'trendline', points: [{ vt: t - 3600000, value: 1.1 }, { vt: t, value: 1.12 }], lock: 0, extendData: null, style: null }], 3);
    }, ts);
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    expect(await page.evaluate(() => objDid[drawIds[0]]), 'objek lama harus ikut dapat did').toBeTruthy();
    assertNoPageErrors(page);
  });

  test('salinan (paste) dapat did BARU, bukan warisan', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    const asal = await page.evaluate(() => objDid[drawIds[0]]);

    await page.evaluate(() => { copyOverlay(); pasteOverlayAt(90, 90); });
    await page.waitForTimeout(300);

    const dids = await page.evaluate(() => drawIds.map((i) => objDid[i]));
    expect(dids).toHaveLength(2);
    expect(dids[1], 'salinan tak boleh mewarisi did asalnya').not.toBe(asal);
    expect(dids[1], 'salinan tetap harus punya did').toBeTruthy();
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `npx playwright test tests/drawing/85-draw-did.spec.js --project=hermetic`
Expected: 4 gagal — `objDid is not defined`.

- [ ] **Step 3: Buat `js/draw-did.js`**

```js
// [did] Id stabil per objek gambar. klinecharts membuat ulang id overlay tiap restore, jadi id-nya
// tak bisa dipakai untuk menunjuk "objek yang itu" lintas sesi — dan alert yang terikat objek
// (js/draw-alert.js) justru butuh persis itu.
//
// Hidup di peta samping, bukan di dalam objek klinecharts: pola yang sama dengan objStyle
// (js/draw-style.js), karena klinecharts tak punya tempat untuk data milik kita.
const objDid={};   // overlayId → did

// Id acak yang cukup unik tanpa koordinasi server: waktu (base36) + kepingan acak.
function newDid(){ return 'd-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8); }

// did objek — dibuatkan bila belum ada. Inilah SATU-SATUNYA tempat did lahir, supaya empat jalur
// pembuatan objek (onDrawEnd, restore, instant-drop, createFromDesc) tak masing-masing lupa
// seperti applyXDateFlag pernah terlewat di PR #178.
function didOf(overlayId){
  if(!overlayId) return '';
  if(!objDid[overlayId]) objDid[overlayId]=newDid();
  return objDid[overlayId];
}
```

- [ ] **Step 4: Serialisasi & pemulihan**

`js/draw-persist.js` — di `serializeDraws`, sertakan `did` pada tiap objek:

```js
    out.push({ name:o.name, points:pts, lock:o.lock?1:0, did:didOf(id),
      extendData:(o.extendData!==undefined?o.extendData:null), style:objStyle[id]||null });
```

Di `buildDrawsFromArray`, sesudah `drawIds.push(id)`:

```js
      // did dari muatan bila ada; objek lama (sebelum fitur alert-garis) dapat did baru di sini,
      // dan ia ikut tersimpan pada penyimpanan berikutnya.
      objDid[id]= (typeof d.did==='string' && d.did) ? d.did : newDid();
```

`js/draw-clone.js` — di `createFromDesc`, sesudah `drawIds.push(nid)`:

```js
  objDid[nid]=newDid();   // salinan adalah objek LAIN: did baru, jadi alert asalnya tak ikut
```

- [ ] **Step 5: Muat modul + SENTINEL**

`index.html`: `<script src="/js/draw-did.js"></script>` **sebelum** `draw-persist.js` (dipakai olehnya saat runtime; menaruhnya lebih awal membuat urutannya jelas dibaca).

`tests/smoke/boot-integrity.spec.js`:

```js
  'draw-did.js': 'objDid',
```

- [ ] **Step 6: Jalankan — harus LULUS**

Run: `npx playwright test tests/drawing/85-draw-did.spec.js tests/smoke --project=hermetic`
Expected: 4 + smoke hijau.

- [ ] **Step 7: Commit**

```bash
git add js/draw-did.js js/draw-persist.js js/draw-clone.js index.html tests/smoke/boot-integrity.spec.js tests/drawing/85-draw-did.spec.js
git commit -m "$(cat <<'EOF'
feat(draw): id stabil per objek gambar (did)

Id overlay klinecharts dibuat ulang tiap restore, jadi tak bisa menunjuk
"objek yang itu" lintas sesi. did lahir di SATU tempat (didOf) supaya
empat jalur pembuatan objek tak masing-masing lupa.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Klien — tab Alert di modal objek

**Files:**
- Create: `js/draw-alert.js`
- Modify: `js/draw-style-modal.js` (tab `:62`, `openObjSettings` `:31`), `css/panel.css` (gaya isi tab), `index.html`, `tests/smoke/boot-integrity.spec.js`
- Test: `tests/drawing/86-alert-garis.spec.js` (baru)

**Interfaces:**
- Consumes: `objDid`, `didOf` (Task 4); `alerts`, `renderAlertList`, `drawAlertLines` (`js/forming-candle.js`); `tsOf` (anchor waktu objek)
- Produces:
  - `ALERTABLE_LINE` — himpunan enam nama objek
  - `lineAnchorsOf(overlayId) → {t1,p1,t2,p2} | null`
  - `alertPaneHTML(o) → string` · `wireAlertPane(panel, o)`
  - `createLineAlert(overlayId, cond)` · `deleteAlertsForDid(did)`

- [ ] **Step 1: Tulis test yang gagal**

Buat `tests/drawing/86-alert-garis.spec.js`:

```js
// Alert dari objek gambar (garis) — tab Alert, pembuatan, dan label daftar.
// Spec: docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { chartRect } = require('../helpers/chart');
const { armTool, clickAt, overlays, CLICK_GAP_MS } = require('../helpers/draw');

async function drawTrendline(page, rect) {
  await armTool(page, 'trendline');
  await clickAt(page, rect, { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.4) });
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, { x: Math.round(rect.width * 0.58), y: Math.round(rect.height * 0.6) });
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
  return (await overlays(page))[0];
}

async function drawRect(page, rect) {
  await armTool(page, 'rect');
  await clickAt(page, rect, { x: Math.round(rect.width * 0.2), y: Math.round(rect.height * 0.2) });
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, { x: Math.round(rect.width * 0.3), y: Math.round(rect.height * 0.35) });
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
  return (await overlays(page))[0];
}

test.describe('alert garis: tab & pembuatan', () => {
  test('tab Alert muncul untuk trendline, TIDAK untuk rect', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await drawTrendline(page, rect);

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'style'), o.id);
    await expect(page.locator('.dm-tab[data-tab="alert"]')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.evaluate(() => { drawIds.slice().forEach((i) => chart.removeOverlay(i)); });
    const r = await drawRect(page, rect);
    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'style'), r.id);
    await expect(page.locator('.dm-tab[data-tab="alert"]')).toHaveCount(0);
    assertNoPageErrors(page);
  });

  test('membuat alert mengirim cond + did + empat anchor', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await drawTrendline(page, rect);
    const did = await page.evaluate((id) => objDid[id], o.id);

    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/alerts')) posts.push(r.postDataJSON()); });

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await page.selectOption('.dm-pane[data-pane="alert"] select', 'up');
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(() => posts.length, { timeout: 5000 }).toBe(1);

    const body = posts[0];
    expect(body.cond).toBe('up');
    expect(body.drawId).toBe(did);
    for (const k of ['t1', 'p1', 't2', 'p2']) {
      expect(body[k], `anchor ${k} harus terkirim`).not.toBeUndefined();
      expect(body[k], `anchor ${k} tak boleh null`).not.toBeNull();
    }
    expect(body.t1, 't1 dan t2 harus beda — garis vertikal ditolak server').not.toBe(body.t2);
    assertNoPageErrors(page);
  });

  test('daftar alert menampilkan kondisi & asal, bukan "Crossing" hardcoded', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await drawTrendline(page, rect);

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await page.selectOption('.dm-pane[data-pane="alert"] select', 'down');
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);

    const teks = await page.locator('#alertList .al-item .al-main').first().textContent();
    expect(teks, 'harus menyebut kondisi arah').toMatch(/Crossing down/i);
    expect(teks, 'harus menyebut asal objeknya').toMatch(/Trend/i);
    assertNoPageErrors(page);
  });

  test('objek yang sudah punya alert: tab menampilkannya + bisa dihapus', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await drawTrendline(page, rect);

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await page.click('.dm-pane[data-pane="alert"] .da-create');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);

    await page.evaluate((id) => openObjSettings(chart.getOverlayById(id), 300, 300, 'alert'), o.id);
    await expect(page.locator('.dm-pane[data-pane="alert"] .da-del')).toBeVisible();
    await page.click('.dm-pane[data-pane="alert"] .da-del');
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(0);
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `npx playwright test tests/drawing/86-alert-garis.spec.js --project=hermetic`
Expected: 4 gagal — tab `alert` tak pernah ada.

- [ ] **Step 3: Buat `js/draw-alert.js`**

```js
// [alert-garis] Alert yang terikat objek gambar: levelnya mengikuti garisnya, bukan satu harga
// tetap. Rancangan & keputusannya: docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md

// Enam objek keluarga garis. Channel & rectangle sengaja TIDAK di sini — semantik zona
// (Entering/Exiting) butuh state per-alert di monitor, dan itu spec kedua.
const ALERTABLE_LINE=new Set(['trendline','rayLine','straightLine',
  'horizontalStraightLine','horizontalRayLine','priceLine']);

// Dua anchor objek sebagai {t1,p1,t2,p2} waktu wall-clock — bentuk yang dipahami server.
// Garis horizontal punya dua titik dgn harga sama, jadi ia lewat jalur yang sama persis.
function lineAnchorsOf(overlayId){
  const o=chart.getOverlayById(overlayId); if(!o||!o.points||o.points.length<2) return null;
  const a=o.points[0], b=o.points[1];
  const t1=tsOf(a), t2=tsOf(b);
  if(t1==null||t2==null||t1===t2) return null;   // vertikal / tanpa anchor waktu → tak bisa jadi alert
  if(a.value==null||b.value==null) return null;
  return {t1, p1:a.value, t2, p2:b.value};
}

const COND_LABEL={cross:'Crossing', up:'Crossing up', down:'Crossing down'};

// Alert milik objek ini (dari daftar alert yang sudah disinkron alertPoll).
function alertForDid(did){ return did ? alerts.find(a=>a.drawId===did) : null; }

// Isi tab Alert. Teks UI bahasa Inggris.
function alertPaneHTML(o){
  const did=objDid[o.id], ex=alertForDid(did);
  if(ex) return `<div class="dm-pane" data-pane="alert"><div class="da-has">Alert active — ${COND_LABEL[ex.cond]||'Crossing'}</div>`
    +`<button class="da-del" type="button">Delete alert</button></div>`;
  return `<div class="dm-pane" data-pane="alert">`
    +`<label class="da-row"><span>Condition</span><select class="da-cond">`
    +`<option value="cross">Crossing</option><option value="up">Crossing up</option><option value="down">Crossing down</option>`
    +`</select></label>`
    +`<button class="da-create" type="button">Create alert</button></div>`;
}

function wireAlertPane(panel, o){
  const pane=panel.querySelector('.dm-pane[data-pane="alert"]'); if(!pane) return;
  const btn=pane.querySelector('.da-create');
  if(btn) btn.onclick=async ()=>{ const c=pane.querySelector('.da-cond');
    await createLineAlert(o.id, (c&&c.value)||'cross'); };
  const del=pane.querySelector('.da-del');
  if(del) del.onclick=async ()=>{ await deleteAlertsForDid(objDid[o.id]); };
}

// Membuat alert SELALU menyimpan gambar dulu: did-nya harus sudah ada di server sebelum ada baris
// alert yang menunjuknya, kalau tidak alert bisa menunjuk objek yang tak ada di mana pun.
async function createLineAlert(overlayId, cond){
  const an=lineAnchorsOf(overlayId); if(!an){ toast('This line cannot be used for an alert','warn'); return null; }
  const did=didOf(overlayId);
  try{ saveDraws(); }catch(_){}
  try{
    const r=await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.assign({instrument:inst, cond, drawId:did}, an))});
    if(!r.ok){ toast('Could not create alert','error'); return null; }
    const a=await r.json();
    alerts.push({id:a.id, sym:a.instrument, price:a.price, triggeredAt:null, oid:null,
      cond:a.cond, drawId:a.drawId, name:(chart.getOverlayById(overlayId)||{}).name||''});
    track('alert',{inst, cond, from:'drawing'});
    renderAlertList(); return a;
  }catch(e){ return null; }
}

async function deleteAlertsForDid(did){
  if(!did) return;
  try{ await fetch('/api/alerts/by-drawing/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({instrument:inst, drawId:did})}); }catch(_){}
  alerts=alerts.filter(a=>a.drawId!==did);
  renderAlertList();
}
```

- [ ] **Step 4: Sisipkan tab di `js/draw-style-modal.js`**

Di `openObjSettings`, di sebelah `hasText`:

```js
  const hasAlert=ALERTABLE_LINE.has(name);
```

Di baris tab (`:62`), tambahkan tombol tab bila `hasAlert`:

```js
    +`<div class="dm-tabs"><button class="dm-tab" data-tab="style">Style</button>${hasText?`<button class="dm-tab" data-tab="text">Text</button>`:''}${hasAlert?`<button class="dm-tab" data-tab="alert">Alert</button>`:''}</div>`
```

Sertakan panenya di rangkaian pane (di sebelah `textPane`), lalu sesudah panel terpasang & `dmSwitch` terdefinisi, panggil `wireAlertPane(panel, o)`.

- [ ] **Step 5: Gaya di `css/panel.css`**

```css
  /* tab Alert pada modal objek — meminjam metrik .dm-* yang sudah ada, hanya baris & tombolnya */
  .dm-pane[data-pane="alert"] .da-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; }
  .dm-pane[data-pane="alert"] .da-has{ margin-bottom:10px; }
  .dm-pane[data-pane="alert"] button{ cursor:pointer; padding:5px 10px; border-radius:6px; font-size:12px;
          border:1px solid var(--border); background:transparent; color:var(--txt); }
  .dm-pane[data-pane="alert"] button:hover{ background:rgba(255,255,255,.07); }
  .dm-pane[data-pane="alert"] button:focus-visible{ outline:2px solid var(--accent); outline-offset:1px; }
```

- [ ] **Step 6: Label daftar alert di `js/forming-candle.js`**

`alertPoll` harus membawa field baru saat memetakan baris server, dan `renderAlertList` memakainya:

```js
    const next=(rows||[]).map(a=>({id:a.id, sym:a.instrument, price:a.price, triggeredAt:a.triggeredAt,
      oid:(byId[a.id]&&byId[a.id].oid)||null, cond:a.cond||'cross', drawId:a.drawId||''}));
```

```js
// Judul satu baris alert. Alert biasa tetap "Crossing <harga>"; alert garis menyebut kondisi dan
// asal objeknya — tanpa ini tiga kondisi baru tak terbedakan di satu-satunya tempat pengguna
// melihat alertnya.
function alertTitle(a){
  const cond=({cross:'Crossing', up:'Crossing up', down:'Crossing down'})[a.cond||'cross'];
  if(!a.drawId) return `${dispSym(a.sym)} ${cond} ${a.price}`;
  const src=({trendline:'Trend line', rayLine:'Ray', straightLine:'Line',
    horizontalStraightLine:'Horizontal line', horizontalRayLine:'Horizontal ray', priceLine:'Price line'})[a.name]||'Drawing';
  return `${dispSym(a.sym)} · ${src} · ${cond}`;
}
```

dan `renderAlertList` memakai `alertTitle(a)` menggantikan string hardcoded-nya. Untuk alert garis yang datang dari server (mis. sesudah reload) `a.name` kosong → labelnya "Drawing", dan itu diterima: nama objek bukan milik tabel alert.

**`drawAlertLines()` harus melewati alert garis.** Fungsi itu (`js/forming-candle.js:109`) membuat satu overlay `alertLine` untuk **tiap** alert instrumen ini pada `a.price`. Alert garis tak punya `price` (0), jadi tanpa gerbang ini setiap alert garis menggambar garis datar di harga **nol** — dan garisnya sudah ada di kanvas sebagai objek gambarnya sendiri:

```js
  alerts.filter(a=>a.sym===inst && !a.drawId).forEach(a=>{   // alert garis: objeknya SUDAH jadi garisnya
```

Selain itu, teks toast saat alert menyala (`alertPoll`, `:184`) untuk alert garis harus memakai judul yang sama, bukan `instrument + ' crossed ' + price` yang untuk alert garis berisi harga 0:

```js
        const msg = a.drawId ? `${dispSym(a.instrument)} — ${({cross:'crossing',up:'crossing up',down:'crossing down'})[a.cond||'cross']} your line`
                             : a.instrument+' crossed '+a.price;
```

- [ ] **Step 7: Muat modul + SENTINEL**

`index.html`: `<script src="/js/draw-alert.js"></script>` **sesudah** `draw-did.js` dan `draw-style-modal.js`.

`tests/smoke/boot-integrity.spec.js`:

```js
  'draw-alert.js': 'ALERTABLE_LINE',
```

- [ ] **Step 8: Jalankan — harus LULUS**

Run: `npx playwright test tests/drawing/86-alert-garis.spec.js tests/smoke --project=hermetic`
Expected: 4 + smoke hijau.

- [ ] **Step 9: Commit**

```bash
git add js/draw-alert.js js/draw-style-modal.js js/forming-candle.js css/panel.css index.html tests/smoke/boot-integrity.spec.js tests/drawing/86-alert-garis.spec.js
git commit -m "$(cat <<'EOF'
feat(alert): tab Alert di modal objek + label daftar yang jujur

Tab menumpang pola dm-tabs yang sudah ada, jadi klik-kanan objek tak perlu
dibongkar. Daftar alert berhenti menulis "Crossing" hardcoded: tiga kondisi
baru harus terbedakan di satu-satunya tempat pengguna melihatnya.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Klien — alert mengikuti objeknya (geser, hapus, sapu)

**Files:**
- Modify: `js/draw-alert.js` (sinkron & penyapuan), `js/draw-persist.js` (`saveDraws`), `js/draw-tools.js` (`onRemoved` di `delHooks`)
- Test: `tests/drawing/86-alert-garis.spec.js` (tambah `describe` kedua)

**Interfaces:**
- Consumes: `lineAnchorsOf`, `deleteAlertsForDid` (Task 5); `objDid` (Task 4)
- Produces: `syncAlertAnchors()` — dipanggil sesudah gambar tersimpan; `sweepAlertsForMissingDrawings()` — dipanggil sesudah instrumen selesai dimuat

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `tests/drawing/86-alert-garis.spec.js`:

```js
test.describe('alert garis: mengikuti objeknya', () => {
  async function buatAlert(page, rect) {
    const o = await drawTrendline(page, rect);
    await page.evaluate((id) => createLineAlert(id, 'cross'), o.id);
    await expect.poll(async () => (await page.locator('#alertList .al-item').count()), { timeout: 6000 }).toBe(1);
    return o;
  }

  test('menggeser garis memperbarui anchor alert di server', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await buatAlert(page, rect);
    const sebelum = await page.evaluate(() => __alertRow(0));

    // geser badan garis ke bawah
    const px = await page.evaluate((id) => {
      const ov = chart.getOverlayById(id);
      return ov.points.map((p) => { let c = chart.convertToPixel(p.timestamp != null ? { timestamp: p.timestamp, value: p.value } : { dataIndex: p.dataIndex, value: p.value }, { paneId: 'candle_pane', absolute: true }); if (Array.isArray(c)) c = c[0]; return { x: c.x, y: c.y }; });
    }, o.id);
    const spot = { x: px[0].x + (px[1].x - px[0].x) * 0.3, y: px[0].y + (px[1].y - px[0].y) * 0.3 };
    await page.mouse.move(rect.x + spot.x, rect.y + spot.y, { steps: 4 });
    await page.mouse.down();
    await page.mouse.move(rect.x + spot.x, rect.y + spot.y + 70, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1200);

    const sesudah = await page.evaluate(() => __alertRow(0));
    expect(sesudah.p1, 'anchor harga harus ikut bergeser').not.toBe(sebelum.p1);
    assertNoPageErrors(page);
  });

  test('menghapus garis menghapus alertnya', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    const o = await buatAlert(page, rect);

    await page.evaluate((id) => chart.removeOverlay(id), o.id);
    await expect.poll(async () => page.evaluate(() => __alertCount()), { timeout: 6000 }).toBe(0);
    assertNoPageErrors(page);
  });

  // Gerbang penyapuan: chart kosong SESAAT saat memuat tak boleh memusnahkan alert.
  test('memuat ulang instrumen TIDAK menghapus alert', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await buatAlert(page, rect);
    await page.waitForTimeout(2500);   // gambar tersimpan ke server

    await page.evaluate(() => loadInit(true));
    await page.waitForTimeout(2500);

    expect(await page.evaluate(() => __alertCount()), 'alert tak boleh hilang saat memuat ulang').toBe(1);
    assertNoPageErrors(page);
  });
});
```

Tambahkan dua jembatan di `tests/fixtures/api.js` (pola sama dengan `__drawingsVersion`):

```js
  await page.exposeFunction('__alertCount', () => state.alerts.length);
  await page.exposeFunction('__alertRow', (i) => state.alerts[i] || null);
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `npx playwright test tests/drawing/86-alert-garis.spec.js --project=hermetic -g "mengikuti"`
Expected: 3 gagal — anchor tak pernah diperbarui, alert tak terhapus.

- [ ] **Step 3: Sinkron anchor & penyapuan di `js/draw-alert.js`**

```js
// Anchor alert diperbarui dari objeknya. Menumpang irama simpan gambar, BUKAN hook per-gestur:
// dengan begitu drag, undo/redo, kunci sudut Shift, dan magnet semuanya ikut benar tanpa masing-
// masing perlu diingat.
async function syncAlertAnchors(){
  const byDid={}; drawIds.forEach(id=>{ const d=objDid[id]; if(d) byDid[d]=id; });
  for(const a of alerts.slice()){
    if(!a.drawId || a.sym!==inst) continue;
    const oid=byDid[a.drawId]; if(!oid) continue;          // objeknya tak ada di layar → urusan penyapuan
    const an=lineAnchorsOf(oid); if(!an) continue;
    if(a.t1===an.t1 && a.p1===an.p1 && a.t2===an.t2 && a.p2===an.p2) continue;   // tak berubah → jangan kirim
    Object.assign(a, an);
    try{ await fetch('/api/alerts/anchors',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.assign({id:a.id}, an))}); }catch(_){}
  }
}

// Objek gambarnya sudah tak ada → alertnya ikut dibuang. Jaring untuk penghapusan yang terjadi di
// tempat lain (perangkat lain, atau saat tab ini tertutup); penghapusan di sesi ini ditangani
// seketika oleh onRemoved.
//
// HANYA boleh jalan sesudah instrumen ini selesai dimuat: selama memuat, drawIds kosong sesaat, dan
// aturan naif "did tak ditemukan → hapus" akan memusnahkan SEMUA alert setiap kali chart dimuat.
async function sweepAlertsForMissingDrawings(){
  if(suppressDrawSave) return;
  const ada=new Set(drawIds.map(id=>objDid[id]).filter(Boolean));
  for(const a of alerts.slice()){
    if(!a.drawId || a.sym!==inst) continue;
    if(!ada.has(a.drawId)) await deleteAlertsForDid(a.drawId);
  }
}
```

- [ ] **Step 4: Pemanggilnya**

`js/draw-persist.js` — di akhir `saveDraws()`, sesudah `scheduleSyncDraws(...)`:

```js
  try{ syncAlertAnchors(); }catch(_){}   // alert ikut pindah bila objeknya bergeser (js/draw-alert.js)
```

`js/load-chart.js` — sesudah `await restoreDraws();` di dalam `try`, di samping `resetDrawHistory()`:

```js
  try{ sweepAlertsForMissingDrawings(); }catch(_){}   // objek yang hilang di tempat lain → alertnya ikut
```

`js/draw-tools.js` — di `onRemoved` pada `delHooks()`, sesudah `drawIds=drawIds.filter(...)`:

```js
    // Objek dihapus di sesi ini → alertnya seketika, tanpa menunggu penyapuan saat muat berikutnya.
    try{ const d=objDid[e.overlay.id]; if(d) deleteAlertsForDid(d); }catch(_){}
```

- [ ] **Step 5: Jalankan — harus LULUS**

Run: `npx playwright test tests/drawing/86-alert-garis.spec.js tests/drawing/85-draw-did.spec.js tests/smoke --project=hermetic`
Expected: 7 + 4 + smoke hijau.

- [ ] **Step 6: Commit**

```bash
git add js/draw-alert.js js/draw-persist.js js/load-chart.js js/draw-tools.js tests/fixtures/api.js tests/drawing/86-alert-garis.spec.js
git commit -m "$(cat <<'EOF'
feat(alert): alert mengikuti objeknya — geser, hapus, sapu

Anchor disinkronkan lewat irama simpan gambar, bukan hook per-gestur, jadi
drag/undo/Shift/magnet ikut benar tanpa masing-masing diingat. Penyapuan
digerbang suppressDrawSave: tanpa itu, chart yang kosong sesaat saat memuat
akan memusnahkan semua alert.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Verifikasi & PR

- [ ] **Step 1: Go**

Run: `go test ./...`
Expected: seluruhnya `ok`.

- [ ] **Step 2: Smoke (gerbang wajib sebelum push)**

Run: `npx playwright test tests/smoke --project=hermetic`
Expected: hijau. Merah dengan "belum punya entri di SENTINEL" berarti entri Task 4/5 belum masuk.

- [ ] **Step 3: Regresi drawing + alert**

Run: `npx playwright test tests/drawing --project=hermetic`
Expected: hijau. Berkas `83-copy-paste` & `84-draw-sync` menyentuh jalur simpan/muat yang task ini ikut sisipi — di situ regresi paling mungkin muncul.

- [ ] **Step 4: Verifikasi MANUAL (dan batasnya, apa adanya)**

Monitor hanya menyala oleh tick sungguhan, dan tick live **hanya ada saat pasar buka** — jadi "alert benar-benar berbunyi" tak bisa dijamin kapan saja. Yang **wajib** diperiksa manual, dan bisa kapan saja:

1. `go build -o luna-trade . && PORT=8765 ./luna-trade`, login `test@luna.local` / `LunaTest123!`.
2. Gambar trendline → klik-kanan → tab **Alert** ada → buat dengan *Crossing up*.
3. Panel Alerts menampilkan kondisi & asal (bukan "Crossing 0").
4. Geser garisnya → tunggu ~2 dtk → `sqlite3 luna.db "SELECT t1,p1,t2,p2 FROM price_alerts"` berubah.
5. Hapus garisnya → barisnya hilang dari tabel.
6. Muat ulang instrumen (tombol Load) → alert yang masih punya garis **tidak** ikut terhapus.
7. Klik-kanan `rect` → tab Alert **tidak** ada.

Kalau pasar kebetulan buka, tambahkan: buat alert *Crossing* pada garis horizontal dekat harga berjalan dan tunggu ia menyala. Kalau tutup, **katakan itu di badan PR** — jangan tulis seolah sudah diuji.

- [ ] **Step 5: Push & buka PR**

```bash
git push -u origin zihar/zihar/feat/alert-dari-garis
gh pr create --base main --title "feat(alert): alert dari objek gambar — garis (A5)" --body "$(cat <<'EOF'
Klik-kanan sebuah garis → tab **Alert** → pilih kondisi → alert dibuat dan **terikat pada garis
itu**. Levelnya mengikuti garisnya: untuk garis miring ia berubah seiring waktu, dan menggeser
garisnya memindahkan alertnya.

Kondisi: **Crossing · Crossing up · Crossing down** (kondisi TV untuk garis; *Greater/Less than*
dilewati karena itu KEADAAN, bukan lintasan, dan menuntut aturan pengulangan yang alert Luna belum
punya konsepnya).

Alert garis bukan jenis alert baru — ia alert yang levelnya berubah, jadi ia menumpang tabel
`price_alerts` + monitor yang sudah ada. Garis horizontal menghasilkan `p1==p2` sehingga rumus
`level(t)` yang sama memberi konstanta: satu jalur kode untuk miring dan datar.

Ikatan ke objek memakai id stabil baru (`did`) — id overlay klinecharts dibuat ulang tiap restore,
jadi tak bisa menunjuk "objek yang itu" lintas sesi. `did` juga prasyarat rename/grup di Object Tree
nanti.

Spec: `docs/superpowers/specs/2026-08-09-alert-dari-garis-design.md`
Zona (channel & rectangle) menyusul di spec kedua.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: CI hijau, lalu merge & rilis**

```bash
gh pr checks --watch
scripts/merge-pr.sh <nomor-pr>
```

Jangan `gh pr merge` langsung (aturan 8 `CLAUDE.md`). Sesudah CI penuh di `main` hijau: Actions → **Release** → *Run workflow*, lalu pastikan antrean kosong dengan `git log --oneline origin/release..origin/main`.
