// Validasi & rekonstruksi order. Server TIDAK mem-proxy body browser mentah ke
// broker: ia mem-parse, memvalidasi (whitelist instrumen, cap ukuran, sanity
// harga), lalu membangun ulang OrderRequest tepercaya.
package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// orderInput = bentuk longgar yang dikirim browser.
type orderInput struct {
	Instrument string   `json:"instrument"`
	Side       string   `json:"side"` // buy | sell
	Type       string   `json:"type"` // market | limit | stop
	Units      float64  `json:"units"`
	Price      *float64 `json:"price"`
	SL         *float64 `json:"sl"`
	TP         *float64 `json:"tp"`
	Trail      *float64 `json:"trail"`
	ClientTag  string   `json:"clientTag"`
}

func validateOrder(cfg Config, raw []byte) (OrderRequest, error) {
	var in orderInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return OrderRequest{}, fmt.Errorf("body tidak valid: %v", err)
	}

	inst := strings.TrimSpace(in.Instrument)
	if inst == "" {
		return OrderRequest{}, fmt.Errorf("instrument wajib")
	}
	if !instrumentAllowed(cfg, inst) {
		return OrderRequest{}, fmt.Errorf("instrument %q tidak diizinkan (cek WHITELIST_INSTRUMENTS)", inst)
	}

	var side Side
	switch strings.ToLower(in.Side) {
	case "buy":
		side = Buy
	case "sell":
		side = Sell
	default:
		return OrderRequest{}, fmt.Errorf("side harus buy/sell")
	}

	var typ OrderType
	switch strings.ToLower(in.Type) {
	case "", "market":
		typ = Market
	case "limit":
		typ = Limit
	case "stop":
		typ = Stop
	default:
		return OrderRequest{}, fmt.Errorf("type harus market/limit/stop")
	}

	if in.Units <= 0 {
		return OrderRequest{}, fmt.Errorf("units harus > 0")
	}
	if in.Units > cfg.MaxOrderUnits {
		return OrderRequest{}, fmt.Errorf("units %.0f melebihi cap %.0f (MAX_ORDER_UNITS)", in.Units, cfg.MaxOrderUnits)
	}

	if typ != Market && (in.Price == nil || *in.Price <= 0) {
		return OrderRequest{}, fmt.Errorf("price wajib & > 0 untuk order %s", typ)
	}
	if in.SL != nil && *in.SL <= 0 {
		return OrderRequest{}, fmt.Errorf("sl harus > 0")
	}
	if in.TP != nil && *in.TP <= 0 {
		return OrderRequest{}, fmt.Errorf("tp harus > 0")
	}
	if in.Trail != nil && *in.Trail <= 0 {
		return OrderRequest{}, fmt.Errorf("trail harus > 0")
	}

	return OrderRequest{
		Instrument: Instrument(inst),
		Side:       side,
		Type:       typ,
		Units:      in.Units,
		Price:      in.Price,
		SL:         in.SL,
		TP:         in.TP,
		TrailDist:  in.Trail,
		ClientTag:  strings.TrimSpace(in.ClientTag),
	}, nil
}

// instrumentAllowed: jika whitelist kosong → izinkan semua (dev); jika diisi → harus cocok.
func instrumentAllowed(cfg Config, inst string) bool {
	if len(cfg.WhitelistInstr) == 0 {
		return true
	}
	for _, w := range cfg.WhitelistInstr {
		if strings.EqualFold(w, inst) {
			return true
		}
	}
	return false
}
