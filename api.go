// Endpoint HTTP. Harga realtime (SSE) di handlePrices; akun/posisi/order/close/
// journal dilayani paper engine per-user (paper.go). Semua di balik requireUser
// (sesi cookie). Eksekusi OANDA nyata per-user menyusul (Fase 2c, via CredStore).
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
