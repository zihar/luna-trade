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

// Badan yang JAUH melebihi batas (beberapa kali lipat maxDrawingsBytes) dulu terpotong oleh
// LimitReader sebelum JSON-nya lengkap → decoder gagal "unexpected EOF" → salah dijawab 400
// ("bad json"), padahal seharusnya 413. Ini kasus yang ditemukan review sebagai patah.
func TestDrawingsGrosslyOversizedReturns413NotBadJSON(t *testing.T) {
	storeForAPI(t)
	huge := `{"instrument":"EUR_USD","baseVersion":0,"payload":["` + strings.Repeat("x", 3*maxDrawingsBytes) + `"]}`
	w := httptest.NewRecorder()
	handleDrawingsSave(w, reqAsUser("POST", "/api/drawings", huge, 1))
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s, mau 413 (bukan 400 bad json)", w.Code, w.Body.String())
	}
}

// Badan KECIL yang memang rusak (bukan kebesaran) harus tetap 400 — perbaikan 413 di atas
// tak boleh menelan semua kegagalan decode jadi 413.
func TestDrawingsSmallMalformedBodyStays400(t *testing.T) {
	storeForAPI(t)
	w := httptest.NewRecorder()
	handleDrawingsSave(w, reqAsUser("POST", "/api/drawings", `{"instrument":`, 1))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s, mau 400", w.Code, w.Body.String())
	}
}

// 409 harus mengambil version DAN payload dari SATU pembacaan store yang sama — bukan
// mencampur version dari SaveDrawings yang gagal (bisa jadi sudah basi lagi di saat
// pembacaan payload berikutnya dijalankan) dengan payload dari pembacaan terpisah.
// Skenario: dua save DITERIMA berurutan, lalu satu save basi (baseVersion=0) → 409 harus
// melaporkan version=2 (jumlah save yang diterima) BERPASANGAN dengan payload save kedua.
func TestDrawingsStale409VersionMatchesReturnedPayload(t *testing.T) {
	storeForAPI(t)
	w := httptest.NewRecorder()
	handleDrawingsSave(w, reqAsUser("POST", "/api/drawings",
		`{"instrument":"EUR_USD","payload":[{"name":"a"}],"baseVersion":0}`, 1))
	if w.Code != http.StatusOK {
		t.Fatalf("save pertama: status=%d body=%s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	handleDrawingsSave(w, reqAsUser("POST", "/api/drawings",
		`{"instrument":"EUR_USD","payload":[{"name":"b"}],"baseVersion":1}`, 1))
	var v2 struct {
		Version int64 `json:"version"`
	}
	json.Unmarshal(w.Body.Bytes(), &v2)
	if w.Code != http.StatusOK || v2.Version != 2 {
		t.Fatalf("save kedua: status=%d body=%s, mau 200 version=2", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	handleDrawingsSave(w, reqAsUser("POST", "/api/drawings",
		`{"instrument":"EUR_USD","payload":[{"name":"c"}],"baseVersion":0}`, 1))
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
	if conf.Version != 2 || len(conf.Payload) != 1 || conf.Payload[0].Name != "b" {
		t.Fatalf("409 harus version=2 berpasangan dgn payload save kedua (\"b\"): %s", w.Body.String())
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
