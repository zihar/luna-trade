// Konfigurasi server + kredensial broker. Sekarang: single-user, kredensial
// dibaca dari env (BrokerCreds tunggal). Seam multi-user: CredStore.For(userID)
// nanti bisa di-back DB tanpa mengubah pemanggil.
package main

import (
	"os"
	"strconv"
	"strings"
)

// BrokerCreds = kantong kredensial per-broker (cukup untuk OANDA & TradeLocker).
type BrokerCreds struct {
	Kind string // "oanda" | "tradelocker"

	// OANDA
	Token     string
	AccountID string
	Env       string // practice | live

	// TradeLocker (Fase 8)
	Email    string
	Password string
	Server   string
	TLEnv    string // demo | live
}

// Config = setelan server runtime.
type Config struct {
	Broker            string   // connector aktif: oanda | tradelocker
	LiveEnabled       bool     // gate global endpoint order
	MaxOrderUnits     float64  // cap ukuran per order
	WhitelistInstr    []string // instrumen yang boleh ditradingkan
	StreamInstruments []string // instrumen yang di-stream harga realtime (SSE)
	BasicAuthUser     string
	BasicAuthPass     string
	Creds             BrokerCreds
}

// loadConfig membaca semua env yang relevan (loadDotEnv sudah dipanggil di main).
func loadConfig() Config {
	c := Config{
		Broker:        envOr("BROKER", "oanda"),
		LiveEnabled:   os.Getenv("LIVE_TRADING_ENABLED") == "1",
		BasicAuthUser: os.Getenv("BASIC_AUTH_USER"),
		BasicAuthPass: os.Getenv("BASIC_AUTH_PASS"),
	}
	c.MaxOrderUnits = 100000
	if v := os.Getenv("MAX_ORDER_UNITS"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			c.MaxOrderUnits = f
		}
	}
	if w := os.Getenv("WHITELIST_INSTRUMENTS"); w != "" {
		for _, s := range strings.Split(w, ",") {
			if s = strings.TrimSpace(s); s != "" {
				c.WhitelistInstr = append(c.WhitelistInstr, s)
			}
		}
	}
	// Instrumen yang di-stream: STREAM_INSTRUMENTS > whitelist > default majors+XAU.
	// Set tetap (v1): ganti instrumen = restart. Klien SSE filter sendiri sisi FE.
	if s := os.Getenv("STREAM_INSTRUMENTS"); s != "" {
		for _, x := range strings.Split(s, ",") {
			if x = strings.TrimSpace(x); x != "" {
				c.StreamInstruments = append(c.StreamInstruments, x)
			}
		}
	} else if len(c.WhitelistInstr) > 0 {
		c.StreamInstruments = c.WhitelistInstr
	} else {
		// Cocokkan dgn watchlist FE (opsi #instrument di index.html) agar semua baris
		// Markets ter-update realtime, termasuk BTC_USD (crypto, trading 24/7).
		c.StreamInstruments = []string{
			"EUR_USD", "GBP_USD", "USD_JPY", "AUD_USD", "USD_CAD",
			"XAU_USD", "GBP_JPY", "EUR_JPY", "BTC_USD",
		}
	}
	c.Creds = BrokerCreds{
		Kind:      "oanda",
		Token:     os.Getenv("OANDA_TOKEN"),
		AccountID: os.Getenv("OANDA_ACCOUNT_ID"),
		Env:       envOr("OANDA_ENV", "practice"),
		Email:     os.Getenv("TRADELOCKER_EMAIL"),
		Password:  os.Getenv("TRADELOCKER_PASSWORD"),
		Server:    os.Getenv("TRADELOCKER_SERVER"),
		TLEnv:     envOr("TRADELOCKER_ENV", "demo"),
	}
	return c
}

// CredStore = seam multi-user. Sekarang envCredStore mengembalikan satu set.
type CredStore interface {
	For(userID string) (BrokerCreds, error)
}

type envCredStore struct{ c BrokerCreds }

func (e envCredStore) For(string) (BrokerCreds, error) { return e.c, nil }

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
