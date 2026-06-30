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
	mux.HandleFunc("GET /api/journal", requireUser(handlePaperJournal))
	mux.HandleFunc("GET /api/prices", requireUser(handlePrices))
	mux.HandleFunc("POST /api/track", requireUser(handleTrack))         // analytics: catat event fitur
	mux.HandleFunc("GET /api/analytics", requireUser(handleAnalytics))  // analytics: laporan (admin)
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
			if _, err := io.WriteString(w, ":ka\n\n"); err != nil {
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
