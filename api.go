// Endpoint HTTP untuk live trading. Semua di belakang basicAuth (sudah membungkus
// mux di main.go). Endpoint yang mengubah state (order/close) tambahan dijaga oleh
// requireLive(). Browser memanggil endpoint ini saat mode LIVE; kredensial broker
// tetap di server.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// cfg, conn & hub = state server tunggal (single-user). Di-set di main.go saat startup.
var (
	cfg  Config
	conn Connector
	hub  *Hub
)

// registerAPI mendaftarkan handler live ke mux. Dipanggil dari main().
func registerAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/account", handleAccount)
	mux.HandleFunc("GET /api/positions", handlePositions)
	mux.HandleFunc("POST /api/order", requireLive(handleOrder))
	mux.HandleFunc("GET /api/prices", handlePrices)
}

// handlePrices = SSE harga realtime. Read-only (tak butuh LIVE_TRADING_ENABLED),
// tapi butuh OANDA_ACCOUNT_ID. Semua klien berbagi SATU upstream lewat hub.
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

// requireLive menolak endpoint mutasi (order/close) bila live trading tidak diaktifkan.
func requireLive(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !cfg.LiveEnabled {
			writeErr(w, http.StatusForbidden, "live trading tidak aktif (set LIVE_TRADING_ENABLED=1)")
			return
		}
		h(w, r)
	}
}

// reqCtx = context dengan timeout wajar untuk panggilan broker.
func reqCtx(r *http.Request) (context.Context, context.CancelFunc) {
	return context.WithTimeout(r.Context(), 15*time.Second)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// handleAccount → ringkasan akun dari broker aktif + simpan snapshot.
func handleAccount(w http.ResponseWriter, r *http.Request) {
	if conn == nil {
		writeErr(w, http.StatusServiceUnavailable, "connector tidak aktif")
		return
	}
	ctx, cancel := reqCtx(r)
	defer cancel()
	acct, err := conn.AccountSummary(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if store != nil {
		if err := store.SaveAccountSnapshot(conn.Name(), acct); err != nil {
			log.Printf("snapshot akun gagal disimpan: %v", err)
		}
	}
	writeJSON(w, http.StatusOK, acct)
}

// handlePositions → posisi net + trade granular dari broker aktif.
func handlePositions(w http.ResponseWriter, r *http.Request) {
	if conn == nil {
		writeErr(w, http.StatusServiceUnavailable, "connector tidak aktif")
		return
	}
	ctx, cancel := reqCtx(r)
	defer cancel()
	positions, err := conn.Positions(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	trades, err := conn.Trades(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"positions": positions,
		"trades":    trades,
	})
}

// handleOrder → validasi body, kirim ke broker, catat audit+fill+journal.
func handleOrder(w http.ResponseWriter, r *http.Request) {
	if conn == nil {
		writeErr(w, http.StatusServiceUnavailable, "connector tidak aktif")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "gagal baca body")
		return
	}
	req, err := validateOrder(cfg, raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	reqJSON, _ := json.Marshal(req)

	// Idempotency: klaim clientTag DULU (sebelum eksekusi). Klaim kedua dgn tag
	// sama → 409, order TIDAK diulang → cegah dobel-order akibat double-click /
	// refresh / retry jaringan. clientTag harus stabil per-intent (mis. UUID per
	// klik tombol); retry yang DISENGAJA pakai tag baru. Tanpa clientTag tak ada
	// proteksi — audit dicatat jalur lama (kompatibel mundur).
	var auditID int64
	var claimed bool
	if store != nil && req.ClientTag != "" {
		id, ok, err := store.ClaimOrder(conn.Name(), req.ClientTag, "/api/order", string(reqJSON))
		switch {
		case err != nil:
			log.Printf("klaim order_audit gagal (lanjut tanpa dedup): %v", err)
		case !ok:
			writeErr(w, http.StatusConflict, "order dengan clientTag ini sudah diproses — cek posisi sebelum kirim ulang")
			return
		default:
			auditID, claimed = id, true
		}
	}

	ctx, cancel := reqCtx(r)
	defer cancel()
	res, perr := conn.PlaceOrder(ctx, req)

	// Audit SELALU dicatat (sukses maupun ditolak). Jika sudah diklaim → lengkapi
	// baris itu; jika tidak (tanpa clientTag) → catat baris baru.
	if store != nil {
		respStatus := http.StatusOK
		if perr != nil {
			respStatus = http.StatusBadGateway
		}
		if claimed {
			if err := store.CompleteOrderAudit(auditID, respStatus, string(res.Raw)); err != nil {
				log.Printf("complete order_audit gagal: %v", err)
			}
		} else if err := store.SaveOrderAudit(conn.Name(), req.ClientTag, "/api/order", string(reqJSON), respStatus, string(res.Raw)); err != nil {
			log.Printf("order_audit gagal: %v", err)
		}
	}

	if perr != nil {
		writeErr(w, http.StatusBadGateway, perr.Error())
		return
	}

	// Pada FILLED: catat fill + buka baris journal.
	if store != nil && res.Status == "FILLED" && res.FillPrice != nil {
		dir := "long"
		if req.Side == Sell {
			dir = "short"
		}
		_ = store.SaveFill(conn.Name(), res.BrokerOrderID, res.BrokerTradeID, string(req.Instrument), string(req.Side), res.FilledUnits, *res.FillPrice)
		if res.BrokerTradeID != "" {
			openTime := time.Now().UTC().Format(time.RFC3339)
			if err := store.OpenJournal(conn.Name(), string(req.Instrument), dir, *res.FillPrice, res.FilledUnits, openTime, res.BrokerTradeID); err != nil {
				log.Printf("open journal gagal: %v", err)
			}
		}
	}

	writeJSON(w, http.StatusOK, res)
}
