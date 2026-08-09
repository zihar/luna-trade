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

// Pin kontrak normalisasi: cond diabaikan (omit) di request → tersimpan sebagai "cross",
// bukan "" — baik di baris DB maupun di respons, keduanya harus sepakat.
func TestCreateAlertOmittedCondPersistsAsCross(t *testing.T) {
	storeForLineAlertAPI(t)
	w := httptest.NewRecorder()
	handleAlertCreate(w, reqUser("POST", "/api/alerts",
		`{"instrument":"EUR_USD","drawId":"d-1","t1":1000,"p1":1.10,"t2":2000,"p2":1.20}`, 1))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var got struct {
		Cond string `json:"cond"`
	}
	json.Unmarshal(w.Body.Bytes(), &got)
	if got.Cond != "cross" {
		t.Fatalf("respons: cond seharusnya \"cross\", dapat %q", got.Cond)
	}
	rows, _ := store.AllActiveAlerts()
	if len(rows) != 1 || rows[0].Cond != "cross" {
		t.Fatalf("baris DB: cond seharusnya \"cross\": %+v", rows)
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
