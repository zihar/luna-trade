// Endpoint HTTP. Harga realtime (SSE) di handlePrices; akun/posisi/order/close/
// journal dilayani paper engine per-user (paper.go). Semua di balik requireUser
// (sesi cookie). Eksekusi OANDA nyata per-user menyusul (Fase 2c, via CredStore).
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// cfg, conn & hub = state server. Di-set di main.go saat startup.
var (
	cfg  Config
	conn Connector
	hub  *Hub
)

// registerAPI mendaftarkan handler ke mux. Dipanggil dari main().
func registerAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/account", requireUser(handlePaperAccount))
	mux.HandleFunc("GET /api/positions", requireUser(handlePaperPositions))
	mux.HandleFunc("POST /api/order", requireUser(handlePaperOrder))
	mux.HandleFunc("POST /api/close", requireUser(handlePaperClose))
	mux.HandleFunc("POST /api/position/sltp", requireUser(handlePaperModify))
	mux.HandleFunc("GET /api/journal", requireUser(handlePaperJournal))
	mux.HandleFunc("GET /api/news/calendar", requireUser(handleNewsCalendar))   // Fase 1: economic calendar + bias
	mux.HandleFunc("GET /api/news/headlines", requireUser(handleNewsHeadlines)) // headline feed (agregasi multi-sumber)
	mux.HandleFunc("GET /api/prices", requireUser(handlePrices))
	mux.HandleFunc("POST /api/track", requireUser(handleTrack))        // analytics: catat event fitur
	mux.HandleFunc("GET /api/analytics", requireUser(handleAnalytics)) // analytics: laporan (admin)
	mux.HandleFunc("GET /api/alerts", requireUser(handleAlertsList))
	mux.HandleFunc("POST /api/alerts", requireUser(handleAlertCreate))
	mux.HandleFunc("POST /api/alerts/delete", requireUser(handleAlertDelete))
	mux.HandleFunc("GET /api/drawings", requireUser(handleDrawingsGet))
	mux.HandleFunc("POST /api/drawings", requireUser(handleDrawingsSave))
}

// handleTrack mencatat satu event pemakaian fitur (analytics DIY, lihat store.LogEvent).
// Body: {"name":"draw","props":{...}}. Fire-and-forget dari FE.
func handleTrack(w http.ResponseWriter, r *http.Request) {
	uid, ok := userIDFromCtx(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "perlu login")
		return
	}
	var body struct {
		Name  string          `json:"name"`
		Props json.RawMessage `json:"props"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "body tak valid")
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len(name) > 64 {
		writeErr(w, http.StatusBadRequest, "name wajib (<=64 char)")
		return
	}
	props := string(body.Props)
	if len(props) > 4096 {
		props = "" // buang props kebesaran; event tetap dicatat
	}
	if store != nil {
		_ = store.LogEvent(uid, name, props) // best-effort; jangan ganggu UX bila gagal
	}
	w.WriteHeader(http.StatusNoContent)
}

// isAnalyticsAdmin true bila email ada di env ANALYTICS_ADMIN (daftar dipisah koma).
func isAnalyticsAdmin(email string) bool {
	admins := os.Getenv("ANALYTICS_ADMIN")
	if strings.TrimSpace(admins) == "" || email == "" {
		return false
	}
	for _, e := range strings.Split(admins, ",") {
		if strings.EqualFold(strings.TrimSpace(e), email) {
			return true
		}
	}
	return false
}

// handleAnalytics mengembalikan ringkasan pemakaian fitur. Hanya utk admin: email user
// login harus ada di env ANALYTICS_ADMIN (dipisah koma). Kalau env kosong → 403.
func handleAnalytics(w http.ResponseWriter, r *http.Request) {
	uid, ok := userIDFromCtx(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "perlu login")
		return
	}
	if store == nil || strings.TrimSpace(os.Getenv("ANALYTICS_ADMIN")) == "" {
		writeErr(w, http.StatusForbidden, "analytics tidak diaktifkan (set ANALYTICS_ADMIN)")
		return
	}
	u, err := store.GetUserByID(uid)
	if err != nil || u == nil || !isAnalyticsAdmin(u.Email) {
		writeErr(w, http.StatusForbidden, "akses ditolak")
		return
	}
	days := 30
	if v := r.URL.Query().Get("days"); v != "" {
		if n, e := strconv.Atoi(v); e == nil && n > 0 && n <= 365 {
			days = n
		}
	}
	since := func(d int) string {
		return time.Now().UTC().AddDate(0, 0, -d).Format("2006-01-02T15:04:05.000Z")
	}
	feats, err := store.FeatureUsage(since(days))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a1, _ := store.ActiveUsers(since(1))
	a7, _ := store.ActiveUsers(since(7))
	a30, _ := store.ActiveUsers(since(30))
	users, _ := store.UserActivities(since(days))
	writeJSON(w, http.StatusOK, map[string]any{
		"days":         days,
		"features":     feats,
		"users":        users,
		"active_users": map[string]int{"d1": a1, "d7": a7, "d30": a30},
	})
}

// alertView = tampilan JSON satu price alert untuk FE.
type alertView struct {
	ID          int64   `json:"id"`
	Instrument  string  `json:"instrument"`
	Price       float64 `json:"price"`
	Active      bool    `json:"active"`
	CreatedAt   int64   `json:"createdAt"`
	TriggeredAt *int64  `json:"triggeredAt"`
}

// handleAlertsList mengembalikan price alert milik user (aktif atau sudah
// triggered tapi belum di-ack).
func handleAlertsList(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	rows, err := store.ListAlerts(uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]alertView, 0, len(rows))
	for _, a := range rows {
		out = append(out, alertView{a.ID, a.Instrument, a.Price, a.Active, a.CreatedAt, a.TriggeredAt})
	}
	writeJSON(w, http.StatusOK, out)
}

// handleAlertCreate membuat price alert baru untuk instrumen & harga target.
func handleAlertCreate(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	var req struct {
		Instrument string  `json:"instrument"`
		Price      float64 `json:"price"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if req.Instrument == "" || req.Price <= 0 {
		writeErr(w, http.StatusBadRequest, "instrument & price required")
		return
	}
	now := time.Now().UnixMilli()
	id, err := store.CreateAlert(uid, req.Instrument, req.Price, now)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, alertView{id, req.Instrument, req.Price, true, now, nil})
}

// handleAlertDelete menghapus (ack) satu price alert milik user.
func handleAlertDelete(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json")
		return
	}
	if err := store.DeleteAlert(uid, req.ID); err != nil {
		writeErr(w, http.StatusNotFound, "alert not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

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
//   versi basi  → 409 {version, payload} MILIK SERVER, keduanya dari SATU pembacaan store yang
//                  sama — klien memakai pasangan ini apa adanya untuk menawarkan Reload, jadi
//                  version yang basi berpasangan dengan payload yang baru (TOCTOU) tak boleh terjadi
//   kebesaran   → 413
func handleDrawingsSave(w http.ResponseWriter, r *http.Request) {
	uid, _ := userIDFromCtx(r)
	// ContentLength diperiksa lebih dulu: badan yang JAUH melebihi batas (mis. 3× lipat) akan
	// dipotong oleh LimitReader di bawah sebelum JSON-nya lengkap, sehingga decoder gagal dengan
	// "unexpected EOF" — itu salah dibaca sebagai JSON rusak (400) padahal sebenarnya kebesaran
	// (413). Cek ini menangkap kasus itu lebih awal. Body kecil yang memang rusak tetap lolos ke
	// decoder dan dijawab 400 seperti biasa.
	if r.ContentLength > maxDrawingsBytes+4096 {
		writeErr(w, http.StatusRequestEntityTooLarge, "drawings too large")
		return
	}
	var req struct {
		Instrument  string          `json:"instrument"`
		Payload     json.RawMessage `json:"payload"`
		BaseVersion int64           `json:"baseVersion"`
	}
	// LimitReader tetap jadi jaring pengaman untuk badan tanpa Content-Length yang diketahui
	// (mis. chunked) — sedikit di atas batas payload supaya badan yang kebesaran tetap TERBACA
	// dan bisa dijawab 413 yang jelas oleh pemeriksaan len(req.Payload) di bawah.
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
		// srvVersion (BUKAN `version` dari SaveDrawings) — antara kegagalan simpan di atas dan
		// baris ini, device lain bisa saja berhasil menyimpan versi baru; ambil version DARI
		// pembacaan yang sama dengan payload supaya 409 tak memasangkan version basi dengan
		// payload yang lebih baru.
		srv, srvVersion, err := store.GetDrawings(uid, req.Instrument)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"payload":` + srv + `,"version":` + strconv.FormatInt(srvVersion, 10) + `}`))
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"version": version})
}

// handlePrices = SSE harga realtime. Butuh OANDA_ACCOUNT_ID (stream upstream).
// Semua klien berbagi SATU upstream lewat hub.
func handlePrices(w http.ResponseWriter, r *http.Request) {
	if hub == nil {
		writeErr(w, http.StatusServiceUnavailable, "stream tidak aktif")
		return
	}
	if cfg.Creds.AccountID == "" {
		writeErr(w, http.StatusServiceUnavailable, "OANDA_ACCOUNT_ID kosong — stream tak tersedia")
		return
	}
	fl, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming tak didukung")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // matikan buffering nginx utk SSE
	w.WriteHeader(http.StatusOK)
	fl.Flush()

	ch := hub.Subscribe()
	defer hub.Unsubscribe(ch)

	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()
	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case t, ok := <-ch:
			if !ok {
				return
			}
			b, _ := json.Marshal(t)
			if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
				return
			}
			fl.Flush()
		case <-keepalive.C:
			// event bernama (bukan komentar :ka) agar client bisa mendeteksi
			// koneksi hidup lewat addEventListener('ping') — independen dari tick
			// harga (mis. saat market tutup). Tak masuk onmessage → tak jadi tick.
			if _, err := io.WriteString(w, "event: ping\ndata: 1\n\n"); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
