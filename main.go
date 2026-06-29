// Luna Trade — proxy tipis untuk OANDA v20.
//
// Serve index.html (same-origin → tak ada masalah CORS) dan relay /api/candles
// ke OANDA dengan token disisipkan dari env (aman, tak pernah sampai ke browser).
//
// Jalankan:
//
//	export OANDA_TOKEN=xxxxxxxx     # personal access token v20
//	export OANDA_ENV=practice       # practice | live (default practice)
//	go run .                        # → http://localhost:8765
package main

import (
	"bufio"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// loadDotEnv membaca file .env (jika ada) dan menyetel var yang belum di-set di
// environment. Tanpa dependency eksternal; cukup KEY=VALUE per baris.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // .env opsional — abaikan kalau tak ada
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
		if _, exists := os.LookupEnv(k); !exists {
			os.Setenv(k, v)
		}
	}
}

func host() string {
	if os.Getenv("OANDA_ENV") == "live" {
		return "https://api-fxtrade.oanda.com"
	}
	return "https://api-fxpractice.oanda.com"
}

// store = persistensi server-side (journal/fills/snapshot/audit live trading).
// Package-level supaya handler API (api.go) bisa mengaksesnya. Boleh nil saat
// belum ada DB_PATH yang valid — handler live yang akan menjaga nil-nya.
var store *Store

func main() {
	loadDotEnv(".env")
	token := os.Getenv("OANDA_TOKEN")
	if token == "" {
		log.Fatal("OANDA_TOKEN belum di-set")
	}
	addr := ":8765"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}

	// Buka SQLite (default ./luna.db lokal; di server di-set ke /opt/bar-replay/luna.db).
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "luna.db"
	}
	st, err := openStore(dbPath)
	if err != nil {
		log.Fatalf("buka DB %s: %v", dbPath, err)
	}
	defer st.Close()
	st.logReady(dbPath)
	store = st

	// Konfigurasi + connector broker aktif (single-user).
	cfg = loadConfig()
	conn = buildConnector(cfg)
	// Account ID wajib untuk endpoint akun/posisi/order. Live tanpa account ID = pasti
	// salah konfig → fail-fast. Tanpa live, chart + /api/candles tetap jalan (token saja),
	// jadi cukup warning supaya deployment charting murni tak ikut crash.
	if cfg.LiveEnabled && cfg.Creds.AccountID == "" {
		log.Fatal("LIVE_TRADING_ENABLED=1 tapi OANDA_ACCOUNT_ID kosong")
	}
	if cfg.Creds.AccountID == "" {
		log.Printf("PERINGATAN: OANDA_ACCOUNT_ID kosong — /api/account, /api/positions & /api/prices tak akan jalan")
	}
	// Hub harga realtime: satu upstream OANDA → fan-out ke semua klien SSE.
	streamInsts := make([]Instrument, len(cfg.StreamInstruments))
	for i, s := range cfg.StreamInstruments {
		streamInsts[i] = Instrument(s)
	}
	hub = newHub(conn, streamInsts)
	log.Printf("Connector aktif: %s (live trading: %v, stream: %d instrumen)", cfg.Broker, cfg.LiveEnabled, len(streamInsts))

	mux := http.NewServeMux()
	// Shell statik (index.html, assets/) publik; data di balik sesi (requireUser).
	mux.Handle("/", noCache(http.FileServer(http.Dir("."))))
	// Endpoint auth publik (register/login/logout/me + Google OAuth).
	registerAuth(mux)
	registerGoogleOAuth(mux)
	// /api/candles butuh login (data harga historis di-gate sesi).
	mux.HandleFunc("/api/candles", requireUser(candlesHandler(token)))
	registerAPI(mux)

	log.Printf("Luna Trade (OANDA %s) → http://localhost%s", oandaEnv(), addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

// noCache mencegah browser men-cache aset (terutama index.html) supaya
// perubahan langsung terlihat tanpa hard-refresh.
func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, must-revalidate")
		h.ServeHTTP(w, r)
	})
}

func oandaEnv() string {
	if e := os.Getenv("OANDA_ENV"); e != "" {
		return e
	}
	return "practice"
}

// GET /api/candles?instrument=EUR_USD&granularity=H1&count=5000&to=2025-06-15T00:00:00Z
//
//	atau ...&from=2025-06-15T00:00:00Z&count=500  (forward / auto-extend)
func candlesHandler(token string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		inst := q.Get("instrument")
		gran := q.Get("granularity")
		if inst == "" || gran == "" {
			http.Error(w, "instrument & granularity wajib", http.StatusBadRequest)
			return
		}
		count := q.Get("count")
		if count == "" {
			count = "5000"
		}

		p := url.Values{}
		p.Set("granularity", gran)
		p.Set("price", "M") // midpoint
		p.Set("count", count)
		if v := q.Get("to"); v != "" {
			p.Set("to", v)
		}
		if v := q.Get("from"); v != "" {
			p.Set("from", v)
		}
		// Daily/Weekly candle disetel tutup 18:00 NY (samakan dengan engine ICT).
		if gran == "D" || gran == "W" {
			p.Set("alignmentTimezone", "America/New_York")
			p.Set("dailyAlignment", "18")
		}
		target := host() + "/v3/instruments/" + url.PathEscape(inst) + "/candles?" + p.Encode()

		req, _ := http.NewRequest(http.MethodGet, target, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept-Datetime-Format", "RFC3339")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	}
}
