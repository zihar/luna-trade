# Sync Drawings ke Server (C4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gambar pengguna pindah dari `localStorage` per-instrumen ke server per-pengguna, sehingga ia ikut saat ganti browser atau perangkat.

**Architecture:** Satu baris SQLite per `(user_id, instrument)` berisi blob JSON yang formatnya **persis** keluaran `serializeDraws()` yang sudah ada, plus kolom `version` untuk mendeteksi bentrok antar perangkat. Modul klien baru `js/draw-sync.js` memegang jaringan + state versi; `js/draw-persist.js` tetap memegang serialisasi & pembangunan objek. `localStorage` turun pangkat jadi cermin yang hanya dibaca saat request gagal.

**Tech Stack:** Go (net/http `mux.HandleFunc` bergaya Go 1.22, `modernc.org/sqlite` tanpa CGO), JavaScript classic script tanpa bundler, Playwright E2E (`--project=hermetic`), `go test`.

**Spec:** `docs/superpowers/specs/2026-08-08-sync-drawings-server-design.md` — baca dulu; setiap keputusan di plan ini berasal dari sana.

## Global Constraints

- **Teks UI bahasa Inggris** (label tombol, pesan notice). Komentar kode & pesan commit boleh Indonesian.
- **Komentar kode menjelaskan KENAPA**, bukan apa — ikuti kepadatan `js/draw-clone.js` / `store.go`.
- **Modul JS baru WAJIB dapat entri `SENTINEL`** di `tests/smoke/boot-integrity.spec.js`, atau smoke merah.
- **Perintah Playwright WAJIB `--project=hermetic`**, bukan `npm test`.
- **Repo hanya memakai GET & POST** — jangan memperkenalkan PUT/DELETE.
- Endpoint baru wajib di balik `requireUser` (`auth.go:176`).
- Batas payload **256 KB**; debounce jaringan **1500 ms**; debounce lokal 350 ms **tidak berubah**.
- Branch: `zihar/zihar/feat/sync-drawings-server` (spec sudah di-commit di sana). Commit conventional Indonesian + trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Skema `drawings` + metode Store

**Files:**
- Modify: `store.go` (konstanta skema dekat `alertsSchema:177`, pemasangan di `migrate()`, dua metode baru)
- Test: `store_drawings_test.go` (baru)

**Interfaces:**
- Produces:
  - `GetDrawings(userID int64, instrument string) (payload string, version int64, err error)` — belum ada barisnya → `("[]", 0, nil)`
  - `SaveDrawings(userID int64, instrument, payload string, baseVersion, now int64) (version int64, ok bool, err error)` — `ok=false` berarti versi basi (bukan error teknis); `version` yang dikembalikan selalu versi server terkini

- [ ] **Step 1: Tulis test yang gagal**

Buat `store_drawings_test.go`:

```go
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
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `go test -run TestDrawings . `
Expected: gagal kompilasi — `s.GetDrawings undefined`, `s.SaveDrawings undefined`, `maxDrawingsBytes undefined`.

- [ ] **Step 3: Tambah skema di `store.go`**

Tepat sesudah blok `alertsSchema` (`store.go:177`), tambahkan:

```go
// Gambar pengguna: SATU baris per (user, instrumen) berisi blob JSON yang formatnya persis
// keluaran serializeDraws() di frontend. Sengaja tidak dinormalisasi per objek — itu butuh id
// objek yang STABIL lintas sesi, yang belum ada (id overlay dibuat ulang tiap restore).
// `version` naik tiap tulis yang diterima; klien mengirim versi yang jadi dasar editnya sehingga
// perangkat kedua yang memegang versi lama tak bisa menimpa diam-diam.
// Primary key gabungan sudah jadi indeksnya — tak ada query yang memindai.
const drawingsSchema = `
CREATE TABLE IF NOT EXISTS drawings(
  user_id    INTEGER NOT NULL,
  instrument TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  version    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, instrument)
);`

// Batas ukuran satu baris. 256 KB ≈ 1.400 objek dalam satu simbol (objek ≈ 180 byte), jauh di
// atas pemakaian nyata — gerbangnya supaya satu akun tak bisa menumbuhkan baris tanpa batas.
const maxDrawingsBytes = 256 * 1024
```

Di `migrate()`, sesudah `s.db.Exec(alertsSchema)`:

```go
	if _, err := s.db.Exec(drawingsSchema); err != nil {
		return err
	}
```

- [ ] **Step 4: Tambah dua metode di `store.go`**

Di akhir berkas:

```go
// GetDrawings mengembalikan payload JSON + versi utk (user, instrumen).
// Belum ada barisnya → ("[]", 0, nil): "belum pernah menggambar" bukan kondisi error, dan
// memaksa pemanggil membedakannya dari kegagalan hanya akan menyebar cabang yang tak berguna.
func (s *Store) GetDrawings(userID int64, instrument string) (string, int64, error) {
	var payload string
	var version int64
	err := s.db.QueryRow(`SELECT payload, version FROM drawings WHERE user_id=? AND instrument=?`,
		userID, instrument).Scan(&payload, &version)
	if err == sql.ErrNoRows {
		return "[]", 0, nil
	}
	if err != nil {
		return "", 0, err
	}
	return payload, version, nil
}

// SaveDrawings menyimpan payload HANYA bila baseVersion masih cocok dengan versi server.
// ok=false berarti versi basi — itu keadaan normal (perangkat lain menyimpan duluan), bukan error
// teknis, jadi ia tidak dikembalikan sebagai err. Versi yang dikembalikan SELALU versi server
// terkini supaya pemanggil bisa mengirimkannya ke klien tanpa query kedua.
//
// Satu pernyataan, bukan SELECT-lalu-UPDATE: seluruh akses DB diserialkan lewat
// SetMaxOpenConns(1) (lihat openStore), jadi transaksi baca-lalu-tulis akan menahan SEMUA fitur
// lain (alert monitor, paper monitor, analitik) selama ia berjalan.
//
// Bentuk `SELECT … WHERE ?=0 OR EXISTS(…)` bukan gaya-gayaan, dan `INSERT … VALUES … ON CONFLICT`
// yang lebih ringkas TIDAK cukup:
//   - baris belum ada + baseVersion=0  → SELECT menghasilkan baris → INSERT (versi 1);
//   - baris ada                        → SELECT menghasilkan baris → konflik → DO UPDATE yang
//     dijaga `WHERE drawings.version=?`;
//   - baris BELUM ada + baseVersion>0  → SELECT kosong → tak ada apa pun yang terjadi → ditolak.
// Tanpa cabang ketiga, klien yang memegang versi hantu akan membuat baris baru diam-diam.
func (s *Store) SaveDrawings(userID int64, instrument, payload string, baseVersion, now int64) (int64, bool, error) {
	if len(payload) > maxDrawingsBytes {
		return 0, false, fmt.Errorf("payload %d byte melebihi batas %d", len(payload), maxDrawingsBytes)
	}
	res, err := s.db.Exec(`
INSERT INTO drawings(user_id,instrument,payload,version,updated_at)
SELECT ?,?,?,1,?
  WHERE ?=0 OR EXISTS(SELECT 1 FROM drawings WHERE user_id=? AND instrument=?)
ON CONFLICT(user_id,instrument) DO UPDATE SET
  payload=excluded.payload, version=drawings.version+1, updated_at=excluded.updated_at
  WHERE drawings.version=?`,
		userID, instrument, payload, now, baseVersion, userID, instrument, baseVersion)
	if err != nil {
		return 0, false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, false, err
	}
	_, cur, err := s.GetDrawings(userID, instrument)
	if err != nil {
		return 0, false, err
	}
	return cur, n > 0, nil
}
```

Pastikan `fmt` dan `database/sql` sudah di-import di `store.go` (keduanya kemungkinan besar sudah; kalau belum, tambahkan).

- [ ] **Step 5: Jalankan test — harus LULUS**

Run: `go test -run TestDrawings .`
Expected: `ok  luna-trade` — 6 test lulus.

Bentuk SQL di atas SUDAH diverifikasi terhadap `modernc.org/sqlite` (termasuk penolakan versi hantu) sebelum plan ini ditulis; kalau ia merah, yang menyimpang adalah salinannya, bukan idenya.

- [ ] **Step 6: Commit**

```bash
git add store.go store_drawings_test.go
git commit -m "$(cat <<'EOF'
feat(store): tabel drawings + simpan ber-guard versi

Satu baris per (user, instrumen) berisi blob JSON identik serializeDraws().
Kolom version membuat perangkat kedua yang memegang versi lama tak bisa
menimpa diam-diam; penolakannya bukan error teknis, jadi dikembalikan
sebagai ok=false beserta versi server terkini.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Endpoint `GET`/`POST /api/drawings`

**Files:**
- Modify: `api.go` (registrasi rute dekat `/api/alerts:37-39`, dua handler baru)
- Test: `api_drawings_test.go` (baru)

**Interfaces:**
- Consumes: `GetDrawings`, `SaveDrawings`, `maxDrawingsBytes` (Task 1); `requireUser` (`auth.go:176`), `userIDFromCtx`, `writeJSON`, `writeErr` (`api.go:251-259`)
- Produces: `handleDrawingsGet`, `handleDrawingsSave`

- [ ] **Step 1: Tulis test yang gagal**

Buat `api_drawings_test.go`:

```go
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

// reqAsUser membuat request yang SUDAH membawa userID di context, seperti yang disuntik
// requireUser — handler diuji langsung, tanpa lapisan sesi.
func reqAsUser(method, target string, body string, uid int64) *http.Request {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	return r.WithContext(context.WithValue(r.Context(), userIDCtxKey, uid))
}

func storeForAPI(t *testing.T) {
	t.Helper()
	s, err := openStore(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	store = s // handler memakai `store` paket-level, sama seperti handler lain
}

func TestDrawingsGetEmpty(t *testing.T) {
	storeForAPI(t)
	w := httptest.NewRecorder()
	handleDrawingsGet(w, reqAsUser("GET", "/api/drawings?instrument=EUR_USD", "", 1))

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d, mau 200 (kosong bukan 404)", w.Code)
	}
	var got struct {
		Payload []any `json:"payload"`
		Version int64 `json:"version"`
	}
	json.Unmarshal(w.Body.Bytes(), &got)
	if len(got.Payload) != 0 || got.Version != 0 {
		t.Fatalf("body=%s", w.Body.String())
	}
}

func TestDrawingsSaveThenGet(t *testing.T) {
	storeForAPI(t)
	w := httptest.NewRecorder()
	handleDrawingsSave(w, reqAsUser("POST", "/api/drawings",
		`{"instrument":"EUR_USD","payload":[{"name":"trendline"}],"baseVersion":0}`, 1))
	if w.Code != http.StatusOK {
		t.Fatalf("simpan: status=%d body=%s", w.Code, w.Body.String())
	}
	var saved struct {
		Version int64 `json:"version"`
	}
	json.Unmarshal(w.Body.Bytes(), &saved)
	if saved.Version != 1 {
		t.Fatalf("version=%d, mau 1", saved.Version)
	}

	w = httptest.NewRecorder()
	handleDrawingsGet(w, reqAsUser("GET", "/api/drawings?instrument=EUR_USD", "", 1))
	if !strings.Contains(w.Body.String(), "trendline") {
		t.Fatalf("get sesudah simpan: %s", w.Body.String())
	}
}

// 409 WAJIB membawa isi server: klien memakainya untuk menawarkan Reload tanpa request kedua.
func TestDrawingsStaleReturns409WithServerCopy(t *testing.T) {
	storeForAPI(t)
	w := httptest.NewRecorder()
	handleDrawingsSave(w, reqAsUser("POST", "/api/drawings",
		`{"instrument":"EUR_USD","payload":[{"name":"a"}],"baseVersion":0}`, 1))

	w = httptest.NewRecorder()
	handleDrawingsSave(w, reqAsUser("POST", "/api/drawings",
		`{"instrument":"EUR_USD","payload":[{"name":"b"}],"baseVersion":0}`, 1))
	if w.Code != http.StatusConflict {
		t.Fatalf("status=%d, mau 409", w.Code)
	}
	var conf struct {
		Version int64 `json:"version"`
		Payload []struct {
			Name string `json:"name"`
		} `json:"payload"`
	}
	json.Unmarshal(w.Body.Bytes(), &conf)
	if conf.Version != 1 || len(conf.Payload) != 1 || conf.Payload[0].Name != "a" {
		t.Fatalf("409 harus membawa versi + isi server: %s", w.Body.String())
	}
}

func TestDrawingsTooLarge(t *testing.T) {
	storeForAPI(t)
	big := `{"instrument":"EUR_USD","baseVersion":0,"payload":["` + strings.Repeat("x", maxDrawingsBytes) + `"]}`
	w := httptest.NewRecorder()
	handleDrawingsSave(w, reqAsUser("POST", "/api/drawings", big, 1))
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d, mau 413", w.Code)
	}
}

func TestDrawingsInstrumentRequired(t *testing.T) {
	storeForAPI(t)
	w := httptest.NewRecorder()
	handleDrawingsGet(w, reqAsUser("GET", "/api/drawings", "", 1))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d, mau 400", w.Code)
	}
}
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `go test -run TestDrawings .`
Expected: gagal kompilasi — `handleDrawingsGet undefined`, `handleDrawingsSave undefined`.

- [ ] **Step 3: Tulis handler di `api.go`**

Tambahkan (dekat handler alerts):

```go
// GET /api/drawings?instrument=EUR_USD → {payload:[…], version:N}
func handleDrawingsGet(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	instrument := r.URL.Query().Get("instrument")
	if instrument == "" {
		writeErr(w, http.StatusBadRequest, "instrument required")
		return
	}
	payload, version, err := store.GetDrawings(uid, instrument)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// payload sudah berupa teks JSON di DB → tulis mentah, jangan di-encode dua kali.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"payload":` + payload + `,"version":` + strconv.FormatInt(version, 10) + `}`))
}

// POST /api/drawings {instrument, payload, baseVersion}
//   versi cocok → 200 {version}
//   versi basi  → 409 {version, payload} MILIK SERVER (klien perlu keduanya untuk menawarkan Reload)
//   kebesaran   → 413
func handleDrawingsSave(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	var req struct {
		Instrument  string          `json:"instrument"`
		Payload     json.RawMessage `json:"payload"`
		BaseVersion int64           `json:"baseVersion"`
	}
	// LimitReader sedikit di atas batas payload supaya badan yang kebesaran tetap TERBACA dan
	// bisa dijawab 413 yang jelas, bukan "bad json" yang menyesatkan.
	if err := json.NewDecoder(io.LimitReader(r.Body, maxDrawingsBytes+4096)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if req.Instrument == "" || len(req.Payload) == 0 {
		writeErr(w, http.StatusBadRequest, "instrument & payload required")
		return
	}
	if len(req.Payload) > maxDrawingsBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "drawings too large")
		return
	}
	version, ok, err := store.SaveDrawings(uid, req.Instrument, string(req.Payload), req.BaseVersion, time.Now().UnixMilli())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		srv, _, err := store.GetDrawings(uid, req.Instrument)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"payload":` + srv + `,"version":` + strconv.FormatInt(version, 10) + `}`))
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"version": version})
}
```

Tambahkan `strconv` ke import `api.go` bila belum ada.

- [ ] **Step 4: Daftarkan rute**

Di `api.go`, tepat sesudah baris `mux.HandleFunc("POST /api/alerts/delete", …)`:

```go
	mux.HandleFunc("GET /api/drawings", requireUser(handleDrawingsGet))
	mux.HandleFunc("POST /api/drawings", requireUser(handleDrawingsSave))
```

- [ ] **Step 5: Jalankan test — harus LULUS**

Run: `go test ./...`
Expected: `ok  luna-trade` (11 test drawings + seluruh test lama tetap hijau).

- [ ] **Step 6: Commit**

```bash
git add api.go api_drawings_test.go
git commit -m "$(cat <<'EOF'
feat(api): endpoint GET/POST /api/drawings

Versi basi dijawab 409 BESERTA isi server, supaya klien bisa menawarkan
Reload tanpa perjalanan kedua yang bisa gagal terpisah. Payload ditulis
mentah (sudah teks JSON di DB) agar tak ter-encode dua kali.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Klien — memuat dari server (+ stub harness)

**Files:**
- Create: `js/draw-sync.js`
- Modify: `js/draw-persist.js:31-34` (`restoreDraws` jadi async & bersumber server), `js/load-chart.js:100`, `index.html` (script tag **sesudah** `draw-persist.js`), `tests/fixtures/api.js` (state + rute stub), `tests/smoke/boot-integrity.spec.js` (`SENTINEL`)
- Test: `tests/drawing/84-draw-sync.spec.js` (baru)

**Interfaces:**
- Consumes: `buildDrawsFromArray(arr)`, `drawsKey()` (`js/draw-persist.js`); `inst` (global instrumen aktif)
- Produces:
  - `drawVer` — peta `instrument → versi server | null` (null = GET belum pernah sukses)
  - `loadDrawsFor(instrument) → Promise<Array>`
  - `readLocalDraws(instrument) → Array`

- [ ] **Step 1: Tulis test yang gagal**

Buat `tests/drawing/84-draw-sync.spec.js`:

```js
// Sync drawings ke server — memuat, fallback, dan adopsi localStorage.
// Spec: docs/superpowers/specs/2026-08-08-sync-drawings-server-design.md

const { test, expect } = require('@playwright/test');
const { gotoApp, assertNoPageErrors } = require('../helpers/app');
const { overlays } = require('../helpers/draw');

/** Satu objek tersimpan, dalam format serializeDraws (vt = wall-clock ms). */
function seedObject(ts) {
  return [{ name: 'trendline', points: [{ vt: ts - 3600000, value: 1.1 }, { vt: ts, value: 1.12 }], lock: 0, extendData: null, style: null }];
}

test.describe('draw-sync: memuat', () => {
  test('gambar dimuat DARI SERVER, bukan dari localStorage', async ({ page }) => {
    const { state } = await gotoApp(page, {
      beforeGoto: async (p) => {
        await p.addInitScript(() => { try { localStorage.clear(); } catch (_) {} });
      },
    });
    // state.drawings di-seed lewat stub: lihat helper di bawah
    expect(state.drawings, 'stub harus punya wadah drawings').toBeTruthy();

    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);
    await page.evaluate((rows) => { window.__seedDrawings('EUR_USD', rows, 3); }, seedObject(ts));
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    expect(await page.evaluate(() => drawVer[inst]), 'versi server harus tercatat').toBe(3);
    assertNoPageErrors(page);
  });

  test('GET gagal → pakai localStorage, dan versi ditandai TIDAK diketahui', async ({ page }) => {
    await gotoApp(page);
    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);

    await page.evaluate((rows) => { localStorage.setItem('br_draws_' + inst, JSON.stringify(rows)); }, seedObject(ts));
    await page.evaluate(() => __setFailDrawings(true));   // stub membalas 500 selama flag ini menyala
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    // null = "tak tahu baseVersion" → Task 4 menolak mendorong dalam keadaan ini.
    expect(await page.evaluate(() => drawVer[inst]), 'versi harus null saat GET gagal').toBeNull();
    assertNoPageErrors(page);
  });

  test('adopsi: server kosong + localStorage berisi → lokal diunggah sekali', async ({ page }) => {
    await gotoApp(page);
    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);

    await page.evaluate((rows) => { localStorage.setItem('br_draws_' + inst, JSON.stringify(rows)); }, seedObject(ts));
    await page.evaluate(() => loadInit(true));
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);

    // Terunggah → server kini punya versi 1 untuk simbol ini.
    await expect.poll(async () => page.evaluate(() => window.__drawingsVersion(inst)), { timeout: 8000 }).toBe(1);
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Tambah stub `/api/drawings` di `tests/fixtures/api.js`**

Di `newState()`, tambahkan satu field:

```js
    drawings: {},   // instrument → {payload, version}; bertahan lewat page.reload() krn dipegang closure route
```

Di dalam `switch (p)`, sebelum `default`, tambahkan:

```js
      case '/api/drawings': {
        // Stub INI menyimpan state sungguhan (bukan selalu balas kosong): seluruh test
        // persistensi bergantung pada isinya bertahan lewat reload.
        if (state.failDrawings) return json(route, { error: 'boom' }, 500);
        if (method === 'GET') {
          const key = url.searchParams.get('instrument') || '';
          const row = state.drawings[key] || { payload: [], version: 0 };
          return json(route, { payload: row.payload, version: row.version });
        }
        const row = state.drawings[body.instrument] || { payload: [], version: 0 };
        if ((body.baseVersion | 0) !== row.version) {
          return json(route, { payload: row.payload, version: row.version }, 409);
        }
        state.drawings[body.instrument] = { payload: body.payload, version: row.version + 1 };
        return json(route, { version: row.version + 1 });
      }
```

Lalu tambahkan jembatan supaya test bisa menyetir stub dari dalam halaman. Di `installStubs`, sesudah `page.route` terpasang:

```js
  // Jembatan test → stub. Test berjalan di Node, stub hidup di closure ini; tanpa jembatan,
  // test tak bisa menyemai isi server atau memaksa kegagalan.
  await page.exposeFunction('__seedDrawings', (instrument, payload, version) => {
    state.drawings[instrument] = { payload, version };
  });
  await page.exposeFunction('__drawingsVersion', (instrument) => (state.drawings[instrument] || { version: 0 }).version);
  await page.exposeFunction('__setFailDrawings', (on) => { state.failDrawings = !!on; });
```

Ketiganya jadi fungsi global di halaman yang mengembalikan `Promise` — itulah sebabnya test memanggilnya lewat `page.evaluate(() => __setFailDrawings(true))`, bukan menyetel variabel window.

- [ ] **Step 3: Jalankan — harus GAGAL**

Run: `npx playwright test tests/drawing/84-draw-sync.spec.js --project=hermetic`
Expected: 3 gagal — `drawVer is not defined` / objek tak muncul, karena `restoreDraws` masih membaca localStorage saja.

- [ ] **Step 4: Buat `js/draw-sync.js`**

```js
// [sync] Gambar hidup di SERVER per (pengguna, instrumen); localStorage turun pangkat jadi cermin
// yang hanya DIBACA saat request gagal. Rancangan & keputusannya:
// docs/superpowers/specs/2026-08-08-sync-drawings-server-design.md

// Versi server per instrumen. null = GET belum pernah sukses → DILARANG mendorong: tanpa
// baseVersion yang benar, dorongan akan menimpa pekerjaan perangkat lain — kegagalan yang persis
// ingin dicegah seluruh rancangan ini.
const drawVer={};

// Isi localStorage utk satu instrumen (jalur penyelamat, bukan sumber kebenaran).
function readLocalDraws(instrument){
  try{ const a=JSON.parse(localStorage.getItem('br_draws_'+instrument)); return Array.isArray(a)?a:[]; }
  catch(_){ return []; }
}

// Muat gambar utk `instrument`. Mengembalikan array siap dioper ke buildDrawsFromArray().
async function loadDrawsFor(instrument){
  let d=null;
  try{
    const r=await fetch('/api/drawings?instrument='+encodeURIComponent(instrument));
    if(!r.ok) throw new Error('HTTP '+r.status);
    d=await r.json();
  }catch(_){
    drawVer[instrument]=null;              // versi tak diketahui → pushDraws menolak mendorong
    return readLocalDraws(instrument);
  }
  drawVer[instrument]=d.version|0;
  const arr=Array.isArray(d.payload)?d.payload:[];
  // Adopsi sekali (migrasi era localStorage): server belum punya apa pun utk simbol ini tapi
  // perangkat ini punya. Unggah yang lokal sbg versi pertama, lalu pakai itu.
  if(!arr.length && drawVer[instrument]===0){
    const local=readLocalDraws(instrument);
    if(local.length){ pushDrawsNow(instrument, local); return local; }
  }
  return arr;
}
```

`pushDrawsNow` baru lahir di Task 4; untuk task ini definisikan stub sementara **di berkas yang sama**, tepat di bawahnya, supaya adopsi punya jalur kirim:

```js
// Dorongan satu tembakan. Task 4 menambahkan penjadwalan & flush di atasnya.
function pushDrawsNow(instrument, payload){
  const base=drawVer[instrument];
  if(base==null) return;                   // GET belum pernah sukses → tak tahu baseVersion
  return fetch('/api/drawings',{method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({instrument, payload, baseVersion:base})})
    .then(async r=>{ if(!r.ok) return; const d=await r.json().catch(()=>null);
      if(d&&d.version!=null) drawVer[instrument]=d.version|0; })
    .catch(()=>{});
}
```

- [ ] **Step 5: Alihkan `restoreDraws` ke server**

Di `js/draw-persist.js`, ganti `restoreDraws()` (baris 31-34) dengan:

```js
// Sumbernya kini SERVER (js/draw-sync.js); localStorage hanya jalur penyelamat saat request gagal.
// Fungsinya jadi async — pemanggilnya (loadInit) menunggunya bersama fetch candles.
async function restoreDraws(){
  buildDrawsFromArray(await loadDrawsFor(inst));
}
```

- [ ] **Step 6: Tunggu di `loadInit`**

Di `js/load-chart.js:100`, ubah `restoreDraws();` menjadi:

```js
  await restoreDraws();   // sumbernya server → async; menunggunya sebelum melepas suppressDrawSave
```

- [ ] **Step 7: Muat modul + SENTINEL**

`index.html`: tambahkan `<script src="/js/draw-sync.js"></script>` **sesudah** baris `draw-persist.js` — urutan listener `beforeunload` mengikuti urutan pendaftaran, dan Task 4 mengandalkan itu.

`tests/smoke/boot-integrity.spec.js`, dekat entri drawing lain:

```js
  'draw-sync.js': 'loadDrawsFor',
```

- [ ] **Step 8: Jalankan test — harus LULUS**

Run: `npx playwright test tests/drawing/84-draw-sync.spec.js --project=hermetic`
Expected: 3 lulus.

Lalu regresi jalur muat yang lama: `npx playwright test tests/smoke --project=hermetic`
Expected: seluruhnya hijau (termasuk `boot-integrity`).

- [ ] **Step 9: Commit**

```bash
git add js/draw-sync.js js/draw-persist.js js/load-chart.js index.html tests/fixtures/api.js tests/smoke/boot-integrity.spec.js tests/drawing/84-draw-sync.spec.js
git commit -m "$(cat <<'EOF'
feat(draw): muat gambar dari server, localStorage jadi jalur penyelamat

GET gagal → tampilkan dari localStorage TAPI tandai versi null, supaya
dorongan berikutnya menolak jalan: tanpa baseVersion yang benar, menyimpan
berarti menimpa pekerjaan perangkat lain.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Klien — mendorong perubahan (debounce, ganti simbol, flush)

**Files:**
- Modify: `js/draw-sync.js` (penjadwalan + flush), `js/draw-persist.js:25-29` (`saveDraws` menyerahkan muatan ke sync)
- Test: `tests/drawing/84-draw-sync.spec.js` (tambah `describe` kedua)

**Interfaces:**
- Consumes: `drawVer`, `pushDrawsNow` (Task 3); `serializeDraws()`, `suppressDrawSave` (`js/draw-persist.js`)
- Produces: `scheduleSyncDraws(instrument, payload)`, `flushSyncDraws(opts)`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `tests/drawing/84-draw-sync.spec.js`:

```js
const { chartRect } = require('../helpers/chart');
const { armTool, clickAt, CLICK_GAP_MS } = require('../helpers/draw');

/** Gambar satu trendline (dua klik) di posisi yang bisa diprediksi. */
async function drawLine(page, rect) {
  const p1 = { x: Math.round(rect.width * 0.36), y: Math.round(rect.height * 0.4) };
  const p2 = { x: Math.round(rect.width * 0.58), y: Math.round(rect.height * 0.6) };
  await armTool(page, 'trendline');
  await clickAt(page, rect, p1);
  await page.waitForTimeout(CLICK_GAP_MS);
  await clickAt(page, rect, p2);
  await page.waitForTimeout(CLICK_GAP_MS);
  await page.waitForFunction(() => inProgressId == null, null, { timeout: 5000 });
}

test.describe('draw-sync: mendorong', () => {
  test('menggambar → terdorong ke server dengan baseVersion yang benar', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);

    await expect.poll(async () => page.evaluate(() => __drawingsVersion(inst)), { timeout: 8000 }).toBe(1);
    expect(await page.evaluate(() => drawVer[inst]), 'versi lokal harus ikut naik').toBe(1);
    assertNoPageErrors(page);
  });

  test('reload CEPAT (<1,5 dtk) tetap menyimpan — flush beforeunload', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    // sengaja TIDAK menunggu debounce 1500ms: inilah yang diuji
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => typeof chart !== 'undefined' && chart.getDataList && chart.getDataList().length > 0 && typeof drawIds !== 'undefined',
      null, { timeout: 20000 }
    );
    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(1);
    assertNoPageErrors(page);
  });

  test('GET gagal → TIDAK ada POST sama sekali', async ({ page }) => {
    await gotoApp(page);
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/drawings')) posts.push(r.url()); });

    await page.evaluate(() => __setFailDrawings(true));
    await page.evaluate(() => loadInit(true));
    await page.waitForTimeout(500);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    await page.waitForTimeout(2500);   // lewati debounce 1500ms dgn margin

    expect(posts, 'tanpa baseVersion yang diketahui, mendorong = menimpa perangkat lain').toHaveLength(0);
    assertNoPageErrors(page);
  });

  test('ganti instrumen saat dorongan tertunda: muatan lama tak nyasar ke simbol baru', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    // Simbol awal dibaca, bukan diasumsikan EUR_USD — kalau default harness berubah, test ini
    // harus tetap menguji hal yang sama, bukan gagal karena alasan yang salah.
    const asal = await page.evaluate(() => inst);
    await drawLine(page, rect);
    await page.evaluate(() => selectSymbol('XAU_USD'));   // < 1,5 dtk sesudah menggambar
    await page.waitForFunction(() => inst === 'XAU_USD', null, { timeout: 15000 });
    await page.waitForTimeout(2500);

    expect(await page.evaluate((s) => __drawingsVersion(s), asal), `gambar harus mendarat di ${asal}`).toBe(1);
    expect(await page.evaluate(() => __drawingsVersion('XAU_USD')), 'XAU_USD tak boleh menerima gambar simbol asal').toBe(0);
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `npx playwright test tests/drawing/84-draw-sync.spec.js --project=hermetic -g "mendorong"`
Expected: 4 gagal (tak ada POST sama sekali kecuali jalur adopsi).

- [ ] **Step 3: Tambah penjadwalan & flush di `js/draw-sync.js`**

```js
const DRAW_PUSH_MS=1500;        // debounce JARINGAN, di atas debounce lokal 350ms (draw-persist)
let drawPushTimer=null;
// Muatan yang menunggu dikirim: {instrument, payload}. Instrumen & isinya DITANGKAP BERSAMAAN saat
// dijadwalkan — bukan dibaca ulang saat kirim. Debounce 1,5 dtk memberi jendela di mana `inst`
// sudah berganti sementara muatan yang antre milik simbol lama; membaca ulang di sana akan
// menyimpan gambar EUR ke baris XAU, kerusakan senyap yang baru ketahuan berhari-hari kemudian.
let drawPushPending=null;

function scheduleSyncDraws(instrument, payload){
  if(drawPushPending && drawPushPending.instrument!==instrument) flushSyncDraws();   // selesaikan simbol lama dulu
  drawPushPending={instrument, payload};
  clearTimeout(drawPushTimer);
  drawPushTimer=setTimeout(()=>flushSyncDraws(), DRAW_PUSH_MS);
}

// Kirim sekarang apa pun yang tertunda. `opts.keepalive` dipakai saat halaman ditutup.
function flushSyncDraws(opts){
  clearTimeout(drawPushTimer); drawPushTimer=null;
  const p=drawPushPending; drawPushPending=null;
  if(p) pushDrawsNow(p.instrument, p.payload, opts);
}

// Halaman disembunyikan / ditutup → kirim tanpa menunggu debounce. `fetch(keepalive:true)`, BUKAN
// navigator.sendBeacon: semantiknya sama tapi ia lewat jalur yang bisa dicegat page.route, jadi
// jaring pengaman ini ikut TERUJI, bukan sekadar diklaim.
addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') flushSyncDraws({keepalive:true}); });
addEventListener('beforeunload',()=>{ try{ saveDraws(); }catch(_){} flushSyncDraws({keepalive:true}); });
```

Ubah `pushDrawsNow` (Task 3) supaya menerima `opts`:

```js
function pushDrawsNow(instrument, payload, opts){
  const base=drawVer[instrument];
  if(base==null) return;                   // GET belum pernah sukses → tak tahu baseVersion
  const init={method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({instrument, payload, baseVersion:base})};
  if(opts&&opts.keepalive) init.keepalive=true;
  return fetch('/api/drawings', init)
    .then(async r=>{ if(!r.ok) return; const d=await r.json().catch(()=>null);
      if(d&&d.version!=null) drawVer[instrument]=d.version|0; })
    .catch(()=>{});
}
```

- [ ] **Step 4: `saveDraws` menyerahkan muatan ke sync**

Di `js/draw-persist.js`, ganti `saveDraws()` (baris 25-29) dengan:

```js
function saveDraws(){ if(suppressDrawSave) return;
  const arr=serializeDraws(), json=JSON.stringify(arr);
  try{ localStorage.setItem(drawsKey(), json); }catch(e){}
  recordDrawHistory(json);
  // Muatan + instrumen diserahkan BERSAMAAN ke lapisan sync (js/draw-sync.js) supaya dorongan yang
  // tertunda tak pernah perlu membaca ulang `inst` yang mungkin sudah berganti.
  try{ scheduleSyncDraws(inst, arr); }catch(_){}
}
```

`suppressDrawSave` menjaga gerbangnya: `clearDrawings()` saat ganti instrumen tak akan terkirim sebagai "hapus semua".

- [ ] **Step 5: Jalankan test — harus LULUS**

Run: `npx playwright test tests/drawing/84-draw-sync.spec.js --project=hermetic`
Expected: 7 lulus (3 dari Task 3 + 4 dorong).

- [ ] **Step 6: Regresi tetangga**

Run: `npx playwright test tests/drawing/83-copy-paste.spec.js tests/smoke --project=hermetic`
Expected: seluruhnya hijau. Test "hasil paste selamat dari reload" di berkas 83 kini melewati jalur server — kalau ia merah, penyebab pertama yang harus dicurigai adalah flush `beforeunload`, bukan copy/paste-nya.

- [ ] **Step 7: Commit**

```bash
git add js/draw-sync.js js/draw-persist.js tests/drawing/84-draw-sync.spec.js
git commit -m "$(cat <<'EOF'
feat(draw): dorong gambar ke server (debounce 1,5 dtk + flush saat ditutup)

Muatan & instrumen ditangkap bersamaan saat dijadwalkan; ganti simbol
mem-flush antrean lama dulu, supaya gambar EUR tak pernah tersimpan ke
baris XAU. Flush pakai fetch(keepalive) agar bisa dicegat page.route dan
karenanya ikut teruji.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Notice bentrok (409) — Reload / Keep mine

**Files:**
- Modify: `js/draw-sync.js` (penanganan 409 + notice), `css/layout.css` (gaya `.sync-conflict`, dekat `.toast`)
- Test: `tests/drawing/84-draw-sync.spec.js` (tambah `describe` ketiga)

**Interfaces:**
- Consumes: `drawVer`, `pushDrawsNow` (Task 3-4); `buildDrawsFromArray`, `clearDrawings`, `suppressDrawSave`, `resetDrawHistory`, `$`
- Produces: `drawConflict` (peta `instrument → {srv, mine}`), `showDrawConflict(instrument, srv, mine)`, `hideDrawConflict(instrument)`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `tests/drawing/84-draw-sync.spec.js`:

```js
test.describe('draw-sync: bentrok antar perangkat', () => {
  /** Buat server berjalan lebih dulu, sehingga dorongan berikutnya pasti 409. */
  async function makeServerAhead(page) {
    await page.evaluate(() => __seedDrawings(inst, [{ name: 'rect', points: [], lock: 0, extendData: null, style: null }], 9));
  }

  test('409 → notice MENETAP, objek lokal tak tergantikan, dorongan berhenti', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    await expect.poll(async () => page.evaluate(() => drawVer[inst]), { timeout: 8000 }).toBe(1);

    await makeServerAhead(page);
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/drawings')) posts.push(1); });

    await page.evaluate(() => { chart.createOverlay({ name: 'rect', points: [] }); scheduleSyncDraws(inst, serializeDraws()); });
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });

    // Menetap: toast biasa hilang 3,8 dtk — ini tidak boleh.
    await page.waitForTimeout(4500);
    await expect(page.locator('#syncConflict')).toBeVisible();

    expect(await overlays(page), 'objek lokal tak boleh diganti tanpa persetujuan').toHaveLength(2);
    const n = posts.length;
    await page.evaluate(() => scheduleSyncDraws(inst, serializeDraws()));
    await page.waitForTimeout(2500);
    expect(posts.length, 'tak boleh menembak 409 berulang selama menunggu keputusan').toBe(n);
    assertNoPageErrors(page);
  });

  test('Reload → isi server yang dipakai', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    await expect.poll(async () => page.evaluate(() => drawVer[inst]), { timeout: 8000 }).toBe(1);

    const ts = await page.evaluate(() => chart.getDataList().at(-1).timestamp);
    await page.evaluate((t) => __seedDrawings(inst, [
      { name: 'trendline', points: [{ vt: t - 7200000, value: 1.05 }, { vt: t, value: 1.06 }], lock: 0, extendData: null, style: null },
      { name: 'trendline', points: [{ vt: t - 3600000, value: 1.07 }, { vt: t, value: 1.08 }], lock: 0, extendData: null, style: null },
    ], 9), ts);

    await page.evaluate(() => scheduleSyncDraws(inst, serializeDraws()));
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });
    await page.locator('#syncConflict [data-act="reload"]').click();

    await expect.poll(async () => (await overlays(page)).length, { timeout: 8000 }).toBe(2);
    await expect(page.locator('#syncConflict')).toBeHidden();
    assertNoPageErrors(page);
  });

  test('Keep mine → punya perangkat ini yang menang', async ({ page }) => {
    await gotoApp(page);
    const rect = await chartRect(page);
    await drawLine(page, rect);
    await expect.poll(async () => page.evaluate(() => drawVer[inst]), { timeout: 8000 }).toBe(1);

    await makeServerAhead(page);
    await page.evaluate(() => scheduleSyncDraws(inst, serializeDraws()));
    await expect(page.locator('#syncConflict')).toBeVisible({ timeout: 8000 });
    await page.locator('#syncConflict [data-act="keep"]').click();

    // Server menerima muatan lokal di atas versi 9 → jadi 10.
    await expect.poll(async () => page.evaluate(() => __drawingsVersion(inst)), { timeout: 8000 }).toBe(10);
    expect(await overlays(page), 'objek lokal tetap seperti apa adanya').toHaveLength(1);
    assertNoPageErrors(page);
  });
});
```

- [ ] **Step 2: Jalankan — harus GAGAL**

Run: `npx playwright test tests/drawing/84-draw-sync.spec.js --project=hermetic -g "bentrok"`
Expected: 3 gagal — `#syncConflict` tak pernah muncul.

- [ ] **Step 3: Tangani 409 di `pushDrawsNow`**

Ganti badan `.then(...)` pada `pushDrawsNow` menjadi:

```js
  return fetch('/api/drawings', init)
    .then(async r=>{
      if(r.status===409){                       // perangkat lain menyimpan duluan
        const d=await r.json().catch(()=>null);
        if(d){ drawVer[instrument]=d.version|0; showDrawConflict(instrument, d, payload); }
        return;
      }
      if(!r.ok) return;                         // gagal sementara → versi tak berubah, dorongan berikutnya mencoba lagi
      const d=await r.json().catch(()=>null);
      if(d&&d.version!=null) drawVer[instrument]=d.version|0;
    })
    .catch(()=>{});
```

dan tambahkan gerbang di awal `pushDrawsNow`, sesudah cek `base==null`:

```js
  if(drawConflict[instrument]) return;      // menunggu keputusan pengguna → jangan menembak 409 lagi
```

- [ ] **Step 4: Tulis notice-nya di `js/draw-sync.js`**

```js
// Instrumen yang sedang menunggu keputusan pengguna: {srv, mine}.
// `mine` = muatan yang GAGAL terdorong; disimpan karena "Keep mine" harus bisa mengirim ulang
// muatan itu walau pengguna sudah berpindah simbol.
const drawConflict={};

// Notice MENETAP — sengaja BUKAN toast(): toast hilang sendiri dalam 3,8 dtk dan tak punya slot
// tombol (js/toast.js:13), padahal ini keputusan yang tak boleh terlewat. Mengikuti peringatan
// TradingView "Your chart layout was changed": beri tahu, jangan blokir, biarkan pengguna memilih.
function showDrawConflict(instrument, srv, mine){
  drawConflict[instrument]={srv, mine};
  let el=$('#syncConflict');
  if(!el){ el=document.createElement('div'); el.id='syncConflict'; el.className='sync-conflict'; document.body.appendChild(el); }
  el.innerHTML='<span class="sc-msg"></span>'
    +'<button class="sc-act" type="button" data-act="reload">Reload</button>'
    +'<button class="sc-act sc-primary" type="button" data-act="keep">Keep mine</button>';
  el.querySelector('.sc-msg').textContent='Your drawings were changed on another device';
  el.classList.add('show');
  el.querySelector('[data-act="reload"]').onclick=()=>{
    const c=drawConflict[instrument]; hideDrawConflict(instrument);
    if(!c || instrument!==inst) return;      // sudah pindah simbol → tak ada yang perlu diganti di layar
    const prev=suppressDrawSave; suppressDrawSave=true;
    clearDrawings(); buildDrawsFromArray(c.srv.payload||[]);
    suppressDrawSave=prev;
    try{ resetDrawHistory(); }catch(_){}     // isi kanvas diganti wholesale → history lama tak lagi bermakna
  };
  el.querySelector('[data-act="keep"]').onclick=()=>{
    const c=drawConflict[instrument]; hideDrawConflict(instrument);
    if(c) pushDrawsNow(instrument, c.mine);  // drawVer sudah = versi server → dorongan ini menimpa
  };
}
function hideDrawConflict(instrument){
  delete drawConflict[instrument];
  const el=$('#syncConflict'); if(el) el.classList.remove('show');
}
```

- [ ] **Step 5: Gaya `.sync-conflict` di `css/layout.css`**

Tepat sesudah blok `.toast` (sebelum `@media (prefers-reduced-motion…)` yang mengikutinya):

```css
  /* Notice bentrok sync: meminjam bahasa visual .toast, TAPI menetap sampai ditindak dan
     interaktif — ia meminta keputusan, bukan memberi kabar sekilas. */
  .sync-conflict{ position:fixed; top:18px; left:50%; transform:translateX(-50%); z-index:2001;
          display:none; align-items:center; gap:10px; max-width:min(520px,92vw);
          background:var(--panel); border:1px solid var(--border); border-left:3px solid #e3b341; color:var(--txt);
          padding:9px 10px 10px 13px; border-radius:9px; box-shadow:var(--shadow); font-size:13px; }
  .sync-conflict.show{ display:flex; }
  .sync-conflict .sc-msg{ flex:1; min-width:0; }
  .sync-conflict .sc-act{ flex:none; cursor:pointer; padding:4px 10px; border-radius:6px; font-size:12px;
          border:1px solid var(--border); background:transparent; color:var(--txt); transition:background .15s, border-color .15s; }
  .sync-conflict .sc-act:hover{ background:rgba(255,255,255,.07); }
  .sync-conflict .sc-act:focus-visible{ outline:2px solid var(--accent); outline-offset:1px; }
  .sync-conflict .sc-primary{ border-color:var(--accent); }
```

- [ ] **Step 6: Jalankan seluruh berkas test — harus LULUS**

Run: `npx playwright test tests/drawing/84-draw-sync.spec.js --project=hermetic`
Expected: 10 lulus (3 muat + 4 dorong + 3 bentrok).

- [ ] **Step 7: Commit**

```bash
git add js/draw-sync.js css/layout.css tests/drawing/84-draw-sync.spec.js
git commit -m "$(cat <<'EOF'
feat(draw): notice bentrok sync — Reload / Keep mine

Menetap sampai ditindak (bukan toast: toast hilang 3,8 dtk & tak punya
slot tombol), mengikuti peringatan TradingView "Your chart layout was
changed". Dorongan otomatis berhenti selama menunggu keputusan supaya
409 tak ditembak berulang.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Verifikasi & PR

- [ ] **Step 1: Go**

Run: `go test ./...`
Expected: seluruhnya `ok`.

- [ ] **Step 2: Smoke (gerbang wajib sebelum push)**

Run: `npx playwright test tests/smoke --project=hermetic`
Expected: seluruhnya hijau. `boot-integrity` merah dengan "belum punya entri di SENTINEL" berarti entri Task 3 Step 7 belum masuk.

- [ ] **Step 3: Regresi drawing**

Run: `npx playwright test tests/drawing --project=hermetic`
Expected: seluruhnya hijau. Berkas `83-copy-paste.spec.js` dan `20-parity.spec.js` kini melewati jalur muat/simpan yang baru — di situlah regresi paling mungkin muncul.

- [ ] **Step 4: Verifikasi MANUAL lintas perangkat (tak tercakup E2E)**

Harness hermetik satu browser; klaim inti fitur ini justru "gambar ikut pindah perangkat". Periksa manual dan **laporkan apa adanya**:

1. `go build -o luna-trade . && PORT=8765 ./luna-trade` (butuh `.env`), login `test@luna.local` / `LunaTest123!`.
2. Gambar trendline di EUR_USD, tunggu ~2 detik.
3. Buka jendela **incognito**, login akun yang sama → trendline harus sudah ada.
4. Di incognito, geser garisnya, tunggu ~2 detik. Kembali ke jendela pertama, gambar objek lain → **notice bentrok** harus muncul.
5. Klik **Reload** → kanvas jadi versi incognito. Ulangi & klik **Keep mine** → versi jendela pertama yang menang.
6. Catat hasil tiap langkah di badan PR.

- [ ] **Step 5: Push & buka PR**

```bash
git push -u origin zihar/zihar/feat/sync-drawings-server
gh pr create --base main --title "feat(draw): sync drawings ke server per-pengguna (C4)" --body "$(cat <<'EOF'
Gambar pindah dari `localStorage` per-instrumen ke server per-pengguna, jadi ia ikut saat ganti
browser atau perangkat. Ini satu-satunya sisa backlog drawing di mana pengguna bisa kehilangan
pekerjaannya sendiri — alerts sudah per-user di server sejak #52/#53, drawings tertinggal.

Bentrok antar perangkat memakai **last-write-wins + deteksi versi**: notice yang menetap dengan
**Reload** / **Keep mine**, mengikuti peringatan TradingView "Your chart layout was changed" —
beri tahu, jangan blokir, pengguna yang memutuskan.

Spec: `docs/superpowers/specs/2026-08-08-sync-drawings-server-design.md`
Test: `store_drawings_test.go`, `api_drawings_test.go`, `tests/drawing/84-draw-sync.spec.js`

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
