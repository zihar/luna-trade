# Alert Zona Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alert Entering/Exiting untuk zona — `rect`, `parallelStraightLine`, `priceChannelLine` — dengan satu representasi (garis batas pertama + `pOff`) yang tak mengharuskan server tahu tool apa.

**Architecture:** `LineAnchors` bertambah field bernilai `POff float64`; batas zona dihitung dari `levelAt()` yang sudah ada (jam-dagang #181 diwarisi utuh); `levelTracker` menyimpan keadaan `inside` sebelumnya; frontend menormalkan ketiga bentuk lewat `fidxOf()`.

**Tech Stack:** Go (stdlib), SQLite pure-Go, JS vanilla `js/*.js`, Playwright `--project=hermetic`.

**Spec:** `docs/superpowers/specs/2026-08-10-alert-zona-design.md`

## Global Constraints

- **Teks UI bahasa Inggris**; komentar & commit Indonesian.
- **Pesan store berbahasa Indonesia tak boleh bocor ke body HTTP** (pola `ErrAlertVertical`).
- **`POff` WAJIB `float64` biasa, bukan pointer** — `prevLevel` membandingkan struct langsung (`e.an != an`).
- Tak ada modul JS baru → **jangan** menambah entri `SENTINEL` di `tests/smoke/boot-integrity.spec.js`.
- Sebelum push cukup `npx playwright test tests/smoke --project=hermetic`.
- Branch: `zihar/zihar/feat/alert-zona` (spec sudah di-commit di sana).

---

### Task 1: `POff` + `zoneBounds`

**Files:**
- Modify: `store.go` (struct `LineAnchors`, migrasi kolom, INSERT/SELECT/UPDATE alert)
- Modify: `alert_monitor.go` (fungsi `zoneBounds` baru)
- Test: `alert_monitor_test.go`

**Interfaces:**
- Produces: field `LineAnchors.POff float64`; `func zoneBounds(r AlertRow, now int64) (lo, hi float64)`

- [ ] **Step 1: Tulis test yang gagal**

```go
// Batas zona diwarisi dari levelAt: jam dagang, ekstrapolasi kanan, anchor terbalik — semuanya
// tanpa kode baru. Yang diuji di sini cuma lapisan pOff-nya.
func TestZoneBounds(t *testing.T) {
	t1 := nyMs(t, 2026, time.January, 6, 9, 0)
	base := AlertRow{Instrument: "EUR_USD", An: &LineAnchors{T1: t1, P1: 1.10, T2: t1 + 10*jam, P2: 1.10}}

	naik := base
	naik.An = &LineAnchors{T1: t1, P1: 1.10, T2: t1 + 10*jam, P2: 1.10, POff: 0.05}
	lo, hi := zoneBounds(naik, t1)
	if math.Abs(lo-1.10) > 1e-9 || math.Abs(hi-1.15) > 1e-9 {
		t.Fatalf("pOff positif: lo=%v hi=%v mau 1.10/1.15", lo, hi)
	}

	// pOff NEGATIF harus memberi pita yang sama, cuma dinyatakan dari sisi lain.
	turun := base
	turun.An = &LineAnchors{T1: t1, P1: 1.15, T2: t1 + 10*jam, P2: 1.15, POff: -0.05}
	lo2, hi2 := zoneBounds(turun, t1)
	if math.Abs(lo2-1.10) > 1e-9 || math.Abs(hi2-1.15) > 1e-9 {
		t.Fatalf("pOff negatif: lo=%v hi=%v mau 1.10/1.15", lo2, hi2)
	}
}

// Zona MIRING bergerak menurut jam dagang, sama seperti garis (#181).
func TestZoneBoundsMiringLintasAkhirPekan(t *testing.T) {
	kamis09 := nyMs(t, 2026, time.January, 8, 9, 0)
	jumat09 := nyMs(t, 2026, time.January, 9, 9, 0)
	senin09 := nyMs(t, 2026, time.January, 12, 9, 0)
	r := AlertRow{Instrument: "EUR_USD",
		An: &LineAnchors{T1: kamis09, P1: 1.1000, T2: jumat09, P2: 1.1024, POff: 0.0010}}
	// 48 jam dagang → batas bawah 1.1048, atas 1.1058.
	lo, hi := zoneBounds(r, senin09)
	if math.Abs(lo-1.1048) > 1e-9 || math.Abs(hi-1.1058) > 1e-9 {
		t.Fatalf("lo=%.6f hi=%.6f mau 1.104800/1.105800", lo, hi)
	}
}
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `go test ./... -run TestZoneBounds`
Expected: FAIL — `unknown field POff`, `undefined: zoneBounds`.

- [ ] **Step 3: Implementasi**

Di `store.go`, tambahkan field ke `LineAnchors` (komentar ikut, karena aturan pointer itu tak boleh hilang):

```go
// LineAnchors = dua ujung garis yang jadi acuan alert: waktu wall-clock ms + harga.
// Disimpan apa adanya (bukan dataIndex) supaya monitor tak perlu tahu timeframe atau data candle.
//
// POff mengubah garis jadi ZONA: jarak HARGA dari garis ini ke batas kedua (boleh negatif; 0 =
// bukan zona). Ia sengaja float64 BERNILAI, bukan pointer — levelTracker.prevLevel menentukan
// kesegaran baseline dengan membandingkan struct ini langsung (`e.an != an`), jadi mengubah lebar
// zona otomatis membatalkan baseline. Pointer akan membandingkan ALAMAT dan diam-diam melewatkan
// perubahan itu, sehingga menyeret sisi zona bisa terbaca sebagai harga masuk/keluar.
type LineAnchors struct {
	T1, T2 int64
	P1, P2 float64
	POff   float64
}
```

Migrasi di `migrate()`, sebaris dengan kolom alert lain:

```go
	s.addColumnIfMissing("price_alerts", "p_off", "REAL") // zona: jarak harga ke batas kedua; NULL/0 = bukan zona
```

Perbarui ketiga query alert supaya membawa `p_off`: INSERT di `CreateAlert`, `UPDATE` di
`UpdateAlertAnchors`, dan SELECT di pembaca baris (`AllActiveAlerts` dan pembaca daftar per-user —
cari lewat `grep -n "t1,p1,t2,p2" store.go`). Kolom NULL dibaca 0 lewat `sql.NullFloat64`, pola yang
sama dengan t1/p1 yang sudah ada di berkas itu.

Di `alert_monitor.go`:

```go
// zoneBounds = batas bawah & atas pita pada waktu `now`. Batas pertama memakai levelAt apa adanya,
// jadi jam-dagang, ekstrapolasi ke kanan, normalisasi anchor terbalik, dan penjagaan span-nol
// semuanya diwarisi tanpa kode baru. Urutan dinormalkan supaya pOff negatif memberi pita yang sama
// dengan pOff positif dari sisi seberangnya.
func zoneBounds(r AlertRow, now int64) (lo, hi float64) {
	base := levelAt(r, now)
	other := base + r.An.POff
	return math.Min(base, other), math.Max(base, other)
}
```

Tambahkan `"math"` ke import `alert_monitor.go`.

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `go test ./...`
Expected: PASS semua, termasuk test alert lama (`POff` nol tak mengubah apa pun).

- [ ] **Step 5: Commit**

```bash
git add store.go alert_monitor.go alert_monitor_test.go
git commit -m "feat(alert): LineAnchors.POff + zoneBounds — pita dari garis yang sudah ada

POff float64 BERNILAI, bukan pointer: prevLevel membandingkan struct langsung,
jadi mengubah lebar zona otomatis membatalkan baseline tracker.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: kondisi `enter` / `exit` di monitor

**Files:**
- Modify: `alert_monitor.go` (`lvlEntry`, `levelTracker`, `evalAlert`)
- Test: `alert_monitor_test.go`

**Interfaces:**
- Consumes: `zoneBounds` (Task 1)
- Produces: `levelTracker.prevInside(id int64, an LineAnchors) (bool, bool)`, `levelTracker.recordZone(id int64, an LineAnchors, lvl float64, inside bool)`

- [ ] **Step 1: Tulis test yang gagal**

```go
// Zona: harga masuk pita menyalakan `enter`, bergerak di dalam pita tidak.
func TestEvalAlertZonaEnter(t *testing.T) {
	t1 := nyMs(t, 2026, time.January, 6, 9, 0)
	a := AlertRow{ID: 1, Instrument: "EUR_USD", Cond: "enter",
		An: &LineAnchors{T1: t1, P1: 1.10, T2: t1 + 10*jam, P2: 1.10, POff: 0.05}} // pita 1.10–1.15
	lt := levelTracker{}
	now := t1 + jam
	if _, hit := evalAlert(a, 1.05, 1.05, now, lt); hit {
		t.Fatalf("tick pertama (baseline) tak boleh menyala")
	}
	if _, hit := evalAlert(a, 1.05, 1.12, now, lt); !hit {
		t.Fatalf("harga masuk pita harus menyalakan enter")
	}
}

func TestEvalAlertZonaTidakMenyalaDiDalamPita(t *testing.T) {
	t1 := nyMs(t, 2026, time.January, 6, 9, 0)
	a := AlertRow{ID: 2, Instrument: "EUR_USD", Cond: "enter",
		An: &LineAnchors{T1: t1, P1: 1.10, T2: t1 + 10*jam, P2: 1.10, POff: 0.05}}
	lt := levelTracker{}
	now := t1 + jam
	evalAlert(a, 1.12, 1.12, now, lt) // baseline: sudah DI DALAM
	if _, hit := evalAlert(a, 1.12, 1.14, now, lt); hit {
		t.Fatalf("bergerak di dalam pita bukan 'entering'")
	}
}

func TestEvalAlertZonaExit(t *testing.T) {
	t1 := nyMs(t, 2026, time.January, 6, 9, 0)
	a := AlertRow{ID: 3, Instrument: "EUR_USD", Cond: "exit",
		An: &LineAnchors{T1: t1, P1: 1.10, T2: t1 + 10*jam, P2: 1.10, POff: 0.05}}
	lt := levelTracker{}
	now := t1 + jam
	evalAlert(a, 1.12, 1.12, now, lt) // baseline: di dalam
	if _, hit := evalAlert(a, 1.12, 1.20, now, lt); !hit {
		t.Fatalf("keluar pita harus menyalakan exit")
	}
}

// Sejajar dgn TestSlopedLineCrossesWithoutPriceChange (#180): yang bergerak ZONA-nya, bukan harga.
func TestEvalAlertZonaMiringMenyapuHargaDiam(t *testing.T) {
	t1 := nyMs(t, 2026, time.January, 6, 9, 0)
	a := AlertRow{ID: 4, Instrument: "EUR_USD", Cond: "enter",
		An: &LineAnchors{T1: t1, P1: 1.00, T2: t1 + 10*jam, P2: 2.00, POff: 0.02}}
	const price = 1.50
	lt := levelTracker{}
	// t1+4jam → batas 1.40–1.42 (harga di ATAS pita); t1+5jam → 1.50–1.52 (harga DI DALAM).
	if _, hit := evalAlert(a, price, price, t1+4*jam, lt); hit {
		t.Fatalf("baseline tak boleh menyala")
	}
	if _, hit := evalAlert(a, price, price, t1+5*jam, lt); !hit {
		t.Fatalf("zona yang bergerak melewati harga DIAM harus menyalakan enter")
	}
}

// Menyeret SISI zona (pOff berubah) tak boleh terbaca sebagai harga masuk/keluar.
func TestEvalAlertZonaLebarBerubahTakMenyala(t *testing.T) {
	t1 := nyMs(t, 2026, time.January, 6, 9, 0)
	sempit := LineAnchors{T1: t1, P1: 1.10, T2: t1 + 10*jam, P2: 1.10, POff: 0.01} // 1.10–1.11
	a := AlertRow{ID: 5, Instrument: "EUR_USD", Cond: "enter", An: &sempit}
	lt := levelTracker{}
	now := t1 + jam
	evalAlert(a, 1.12, 1.12, now, lt) // baseline: harga 1.12 DI LUAR pita sempit
	lebar := LineAnchors{T1: t1, P1: 1.10, T2: t1 + 10*jam, P2: 1.10, POff: 0.05} // 1.10–1.15
	a.An = &lebar
	if _, hit := evalAlert(a, 1.12, 1.12, now, lt); hit {
		t.Fatalf("melebarkan zona sendiri tak boleh menyalakan enter")
	}
}
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `go test ./... -run TestEvalAlertZona`
Expected: FAIL — kondisi `enter`/`exit` jatuh ke cabang `default` `sideHit`, jadi hasilnya salah.

- [ ] **Step 3: Implementasi**

`lvlEntry` menyimpan keadaan pita; `an` tetap jadi kunci kesegarannya:

```go
type lvlEntry struct {
	an     LineAnchors
	lvl    float64
	inside bool // keadaan pita pada tick itu; hanya berarti untuk alert zona
}
```

```go
// prevInside = keadaan "harga di dalam pita" pada tick sebelumnya, dgn syarat kesegaran yang sama
// dengan prevLevel: anchor (termasuk POff) harus belum berubah.
func (lt levelTracker) prevInside(id int64, an LineAnchors) (bool, bool) {
	e, ok := lt[id]
	if !ok || e.an != an {
		return false, false
	}
	return e.inside, true
}

// recordZone menyimpan level DAN keadaan pita sekaligus.
func (lt levelTracker) recordZone(id int64, an LineAnchors, lvl float64, inside bool) {
	lt[id] = lvlEntry{an: an, lvl: lvl, inside: inside}
}
```

Di `evalAlert`, sesudah penjagaan "garis belum mulai" dan sebelum jalur garis:

```go
		// Zona: yang diuji BUKAN persilangan satu level, melainkan perpindahan keadaan
		// luar↔dalam pita. Keadaan sebelumnya diambil dari tracker (bukan dihitung ulang dari
		// harga lama terhadap batas baru) — pelajaran #180: membandingkan harga lama dengan level
		// baru mengarang lintasan setiap kali batasnya melompat.
		if a.Cond == "enter" || a.Cond == "exit" {
			lo, hi := zoneBounds(a, now)
			inNow := cur >= lo && cur <= hi
			prevIn, ok := lvlTrack.prevInside(a.ID, *a.An)
			lvlTrack.recordZone(a.ID, *a.An, lvl, inNow)
			if !ok {
				return lvl, false
			}
			if a.Cond == "enter" {
				return lvl, !prevIn && inNow
			}
			return lvl, prevIn && !inNow
		}
```

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `go test ./...`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add alert_monitor.go alert_monitor_test.go
git commit -m "feat(alert): kondisi enter/exit — transisi keadaan pita, bukan persilangan level

Keadaan sebelumnya diambil dari tracker dgn syarat kesegaran yang sama seperti
level (anchor termasuk POff belum berubah), jadi melebarkan zona sendiri tak
terbaca sebagai harga masuk/keluar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: validasi & API

**Files:**
- Modify: `store.go` (`validAnchors`, sentinel baru, daftar cond yang sah di `CreateAlert`)
- Modify: `api.go` (`handleAlertCreate` & `handleAlertAnchors`: terima `pOff`, validasi pasangan cond×pOff)
- Test: `store_line_alerts_test.go`, `api_line_alerts_test.go`

**Interfaces:**
- Produces: `var ErrAlertZonePair = errors.New("kondisi zona & lebar zona tak sepadan")`

- [ ] **Step 1: Tulis test yang gagal**

```go
// Kondisi zona tanpa lebar zona = pita setinggi nol; "masuk ke dalamnya" tak pernah bermakna.
func TestCreateAlertZonaTanpaPOffDitolak(t *testing.T) {
	s := storeForLineAlerts(t)
	t1 := nyMs(t, 2026, time.January, 6, 9, 0)
	an := LineAnchors{T1: t1, P1: 1.10, T2: t1 + 3*jam, P2: 1.20}
	if _, err := s.CreateAlert(1, "EUR_USD", 0, 1000, "enter", "z-1", &an); !errors.Is(err, ErrAlertZonePair) {
		t.Fatalf("err = %v, mau ErrAlertZonePair", err)
	}
}

// Kebalikannya: kondisi GARIS pada anchor yang punya lebar zona juga tak sepadan.
func TestCreateAlertGarisDenganPOffDitolak(t *testing.T) {
	s := storeForLineAlerts(t)
	t1 := nyMs(t, 2026, time.January, 6, 9, 0)
	an := LineAnchors{T1: t1, P1: 1.10, T2: t1 + 3*jam, P2: 1.20, POff: 0.05}
	if _, err := s.CreateAlert(1, "EUR_USD", 0, 1000, "cross", "z-2", &an); !errors.Is(err, ErrAlertZonePair) {
		t.Fatalf("err = %v, mau ErrAlertZonePair", err)
	}
}

func TestCreateAlertZonaSah(t *testing.T) {
	s := storeForLineAlerts(t)
	t1 := nyMs(t, 2026, time.January, 6, 9, 0)
	an := LineAnchors{T1: t1, P1: 1.10, T2: t1 + 3*jam, P2: 1.20, POff: 0.05}
	id, err := s.CreateAlert(1, "EUR_USD", 0, 1000, "enter", "z-3", &an)
	if err != nil {
		t.Fatalf("alert zona sah ditolak: %v", err)
	}
	rows, _ := s.AllActiveAlerts()
	if len(rows) != 1 || rows[0].An.POff != 0.05 || rows[0].Cond != "enter" {
		t.Fatalf("pOff/cond tak tersimpan: %+v", rows)
	}
	_ = id
}
```

Di `api_line_alerts_test.go`, tambahkan satu test HTTP: POST dengan `"cond":"enter"` dan `"pOff":0.05` → 200, dan baris tersimpan membawa `POff`; POST `"cond":"enter"` tanpa `pOff` → 400 dengan teks Inggris `zone`.

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `go test ./... -run 'TestCreateAlertZona|TestCreateAlertGarisDenganPOff'`
Expected: FAIL — `undefined: ErrAlertZonePair`.

- [ ] **Step 3: Implementasi**

Sentinel keempat di `store.go`, di blok `var (...)` yang sama:

```go
	// Kondisi & bentuk harus sepadan: enter/exit butuh pita (POff != 0), cross/up/down butuh garis
	// (POff == 0). Dijaga di store, bukan cuma di UI, supaya baris yang mustahil dievaluasi tak
	// pernah bisa masuk DB lewat klien mana pun.
	ErrAlertZonePair = errors.New("kondisi zona & lebar zona tak sepadan")
```

`CreateAlert` menerima dua cond baru — perluas cek yang ada:

```go
	if cond != "cross" && cond != "up" && cond != "down" && cond != "enter" && cond != "exit" {
		return 0, fmt.Errorf("%w: %s", ErrAlertCond, cond)
	}
```

`validAnchors` bertambah satu parameter `cond` dan satu aturan:

```go
func validAnchors(instrument, cond string, an LineAnchors) error {
	if an.T1 == an.T2 {
		return ErrAlertVertical
	}
	zona := cond == "enter" || cond == "exit"
	if zona != (an.POff != 0) {
		return ErrAlertZonePair
	}
	if an.P1 != an.P2 && tradingElapsed(instrument, an.T1, an.T2) == 0 {
		return ErrAlertNoTradingSpan
	}
	return nil
}
```

Perbarui pemanggilnya di `CreateAlert` (`validAnchors(instrument, cond, *an)`).

Di `api.go` `handleAlertCreate`: tambah `POff *float64 \`json:"pOff"\`` ke struct request, isi
`an.POff` (nil → 0), dan tambah penolakan bahasa Inggris sebelum memanggil store:

```go
		zona := cond == "enter" || cond == "exit"
		off := 0.0
		if req.POff != nil {
			off = *req.POff
		}
		if zona != (off != 0) {
			writeErr(w, http.StatusBadRequest, "zone alerts need a zone; line alerts need a line")
			return
		}
```

Perhatikan urutan: `cond` sudah dinormalkan di atas titik ini — pakai variabel `cond`, bukan
`req.Cond` mentah. Tambahkan juga `ErrAlertZonePair` ke daftar `errors.Is` di jaring pengaman 400.

Di `handleAlertAnchors`: tambah `POff` ke request dan teruskan ke `LineAnchors`. Jalur ini tetap
longgar seperti #181 (hanya vertikal yang ditolak) — alasannya sama dan sudah tertulis di
`UpdateAlertAnchors`.

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `go vet ./... && go test ./...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add store.go api.go store_line_alerts_test.go api_line_alerts_test.go
git commit -m "feat(alert): terima cond enter/exit + pOff, dan jaga pasangannya

Kondisi & bentuk harus sepadan: enter/exit butuh pita, cross/up/down butuh
garis. Dijaga di store, bukan cuma UI.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: frontend — normalisasi ketiga bentuk

**Files:**
- Modify: `js/draw-alert.js`
- Test: `tests/drawing/86-alert-garis.spec.js`

**Interfaces:**
- Produces: `ZONE_TOOL` (Set), `zoneAnchorsOf(overlayId)`, `anchorsOf(overlayId)`; `COND_LABEL` bertambah `enter`/`exit`.

- [ ] **Step 1: Tulis/balik test**

Di `tests/drawing/86-alert-garis.spec.js`:

1. Ganti test `tab Alert TIDAK muncul untuk rect (zona = spec kedua)` menjadi versi positif untuk ketiga tool zona (`rect`, `parallelStraightLine`, `priceChannelLine`): tab Alert terlihat, dan dropdown-nya berisi `enter`/`exit`, bukan `cross`.
2. Tambah test anchor zona:

```js
  const ZONE_TOOLS = ['rect', 'parallelStraightLine', 'priceChannelLine'];

  for (const name of ZONE_TOOLS) {
    test(`${name}: anchor zona membawa pOff bukan nol`, async ({ page }) => {
      await gotoApp(page);
      const { obj } = await drawTool(page, name);
      const an = await page.evaluate((id) => anchorsOf(id), obj.id);
      expect(an, 'anchor zona harus terbentuk').not.toBeNull();
      expect(an.t1).toBeLessThan(an.t2);
      expect(Math.abs(an.pOff), 'zona harus punya tinggi').toBeGreaterThan(0);
      assertNoPageErrors(page);
    });
  }
```

3. Tambah test bahwa `priceChannelLine` mengirim anchor yang sudah DIGESER — garis yang digambar pengguna harus berada tepat di tengah pita:

```js
  test('priceChannelLine: garis yang digambar ada di TENGAH pita yang dikirim', async ({ page }) => {
    await gotoApp(page);
    const { obj } = await drawTool(page, 'priceChannelLine');
    const cek = await page.evaluate((id) => {
      const o = chart.getOverlayById(id), an = anchorsOf(id);
      const f = (fidxOf(o.points[2]) - fidxOf(o.points[0])) / (fidxOf(o.points[1]) - fidxOf(o.points[0]));
      const tengahDigambar = o.points[0].value + (o.points[1].value - o.points[0].value) * f;
      const tengahDikirim = an.p1 + (an.p2 - an.p1) * f + an.pOff / 2;
      return { tengahDigambar, tengahDikirim };
    }, obj.id);
    expect(Math.abs(cek.tengahDikirim - cek.tengahDigambar)).toBeLessThan(1e-6);
    assertNoPageErrors(page);
  });
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx playwright test tests/drawing/86-alert-garis.spec.js --project=hermetic`
Expected: FAIL — `anchorsOf` belum ada, tab Alert belum muncul untuk tool zona.

- [ ] **Step 3: Implementasi**

Di `js/draw-alert.js`, tambahkan di bawah `SLOPED_LINE`:

```js
// Zona: pita antara DUA batas. Ketiganya dinormalkan ke bentuk yang sama sebelum dikirim — garis
// batas pertama + jarak harga ke batas kedua — supaya server tak perlu tahu tool apa yang membuatnya.
const ZONE_TOOL=new Set(['rect','parallelStraightLine','priceChannelLine']);
const ALERTABLE=new Set([...ALERTABLE_LINE, ...ZONE_TOOL]);

// Offset dihitung dalam INDEKS BAR (fidxOf), bukan piksel dan bukan wall-clock. Sumbu-x chart
// linear terhadap indeks bar, jadi inilah satu-satunya basis yang memberi offset persis seperti
// yang tergambar; piksel akan bergantung viewport, wall-clock adalah cacat yang diperbaiki #181.
function zoneAnchorsOf(overlayId){
  const o=chart.getOverlayById(overlayId); if(!o||!o.points||o.points.length<2) return null;
  const P=o.points;
  if(o.name==='rect'){
    // Kotak sudah mekar jadi 8 handle (js/box-resize.js). Batas dibaca dari SEMUA titik, bukan dari
    // indeks tertentu, supaya tak ikut pecah kalau tata letak handle berubah.
    const vs=P.map(p=>p.value).filter(v=>v!=null); if(vs.length<2) return null;
    const lo=Math.min(...vs), hi=Math.max(...vs);
    const fs=P.map(fidxOf).filter(v=>v!=null&&isFinite(v)); if(fs.length<2) return null;
    const t1=fidxToTs(Math.min(...fs)), t2=fidxToTs(Math.max(...fs));
    if(t1==null||t2==null||t1===t2||hi===lo) return null;
    return {t1, p1:lo, t2, p2:lo, pOff:hi-lo};
  }
  if(P.length<3||P[0].value==null||P[1].value==null||P[2].value==null) return null;
  const i1=fidxOf(P[0]), i2=fidxOf(P[1]), i3=fidxOf(P[2]);
  if(i1==null||i2==null||i3==null||i2===i1) return null;
  const f=(i3-i1)/(i2-i1);
  const off=P[2].value-(P[0].value+(P[1].value-P[0].value)*f);
  if(!isFinite(off)||off===0) return null;
  const t1=tsOf(P[0]), t2=tsOf(P[1]); if(t1==null||t2==null||t1===t2) return null;
  const naik=t1<t2;
  let a1=naik?{t:t1,p:P[0].value}:{t:t2,p:P[1].value}, a2=naik?{t:t2,p:P[1].value}:{t:t1,p:P[0].value};
  // priceChannelLine: yang digambar pengguna adalah SUMBU TENGAH, kedua batasnya simetris
  // (klinecharts re(): garis lewat titik ke-3 + cerminnya). Geser garisnya ke batas bawah dan
  // lipatgandakan offsetnya. Penggeseran murni di sumbu HARGA — tak menyentuh waktu, jadi tak
  // butuh jam-dagang di sini.
  if(o.name==='priceChannelLine') return {t1:a1.t, p1:a1.p-off, t2:a2.t, p2:a2.p-off, pOff:off*2};
  return {t1:a1.t, p1:a1.p, t2:a2.t, p2:a2.p, pOff:off};
}

// Satu pintu untuk kedua keluarga — dipakai createLineAlert & syncAlertAnchors, supaya zona ikut
// mengikuti objeknya (geser, undo, hapus) tanpa satu pun jalur baru.
function anchorsOf(overlayId){
  const o=chart.getOverlayById(overlayId); if(!o) return null;
  const an=ZONE_TOOL.has(o.name) ? zoneAnchorsOf(overlayId) : lineAnchorsOf(overlayId);
  if(an && an.pOff==null) an.pOff=0;
  return an;
}
```

`COND_LABEL` bertambah dua entri (satu-satunya sumber label sejak #180):

```js
const COND_LABEL={cross:'Crossing', up:'Crossing up', down:'Crossing down', enter:'Entering zone', exit:'Exiting zone'};
```

`alertPaneHTML` memilih daftar kondisi menurut jenis objek:

```js
const COND_OPTS={line:['cross','up','down'], zone:['enter','exit']};
```
dan membangun `<option>` dari `COND_OPTS[ZONE_TOOL.has(o.name)?'zone':'line']` dengan teks dari
`COND_LABEL`, sehingga label di dropdown, di daftar alert, dan di notifikasi tak bisa berselisih.

Ganti pemakaian `ALERTABLE_LINE` sebagai gerbang tab Alert (di `js/draw-style-modal.js`) menjadi
`ALERTABLE`, dan `lineAnchorsOf(...)` di `createLineAlert` & `syncAlertAnchors` menjadi
`anchorsOf(...)`. Kirim `pOff` di body POST `/api/alerts` dan `/api/alerts/anchors`, serta ikutkan
di pembandingan "anchor berubah?" di `syncAlertAnchors`.

- [ ] **Step 4: Jalankan, pastikan LULUS**

Run: `npx playwright test tests/drawing/86-alert-garis.spec.js --project=hermetic`
Expected: PASS.

- [ ] **Step 5: Smoke + commit**

```bash
npx playwright test tests/smoke --project=hermetic
git add js/ tests/drawing/86-alert-garis.spec.js
git commit -m "feat(alert): alert zona utk rect, parallel channel & price channel

Ketiganya dinormalkan ke satu bentuk (garis batas + pOff) di frontend, jadi
server tak perlu tahu tool apa. Offset dihitung dalam indeks bar lewat fidxOf.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: verifikasi menyeluruh & PR

- [ ] **Step 1: Suite drawing penuh**

Run: `npx playwright test tests/drawing --project=hermetic`
Expected: PASS (317 + test zona baru). Berkas lain menyentuh rect (box-resize, clone, copy-paste).

- [ ] **Step 2: Review diff cabang dengan mata segar**

Baca `git diff origin/main..HEAD -- '*.go' 'js/*.js'` utuh. Yang khusus dicari: jalur yang memakai
`lineAnchorsOf` tapi terlewat diganti `anchorsOf`; `pOff` yang tak ikut dibandingkan di
`syncAlertAnchors` (zona yang digeser tak tersinkron); dan `ALERTABLE_LINE` yang masih jadi gerbang
di tempat lain.

- [ ] **Step 3: `go vet` + build + test**

Run: `go vet ./... && go build ./... && go test ./...`

- [ ] **Step 4: Push & PR**

```bash
git push -u origin zihar/zihar/feat/alert-zona
gh pr create --base main --title "feat(alert): alert zona — Entering/Exiting untuk channel & rectangle" --body "..."
```

Badan PR memuat: satu representasi & kenapa server tak perlu tahu tool, kenapa hanya dua dari empat
kondisi TV, kenapa `POff` bernilai bukan pointer, keputusan zona berlaku terus ke kanan, dan risiko
rollback (`cond` enter/exit dibaca kode lama sebagai cross).

- [ ] **Step 5: CI hijau, lalu `scripts/merge-pr.sh <n>`**

## Catatan untuk pelaksana

- **Jangan** menyentuh `levelAt`, `tradingElapsed`, atau `sideHit` — zona menumpang semuanya.
- **Jangan** membuat modul JS baru (tak ada entri `SENTINEL` baru).
- Pemicuan sungguhan butuh pasar buka; bukti utamanya test Go dengan tick sintetis.
