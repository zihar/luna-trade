// Lapisan backend-agnostic: interface Connector + model data ternormalisasi.
//
// Tujuan: seluruh handler API server bicara ke interface ini, bukan ke satu
// broker tertentu. OANDA jadi implementasi pertama (oanda.go); TradeLocker &
// kelak MT5 tinggal mengimplementasi interface yang sama tanpa mengubah api.go.
package main

import (
	"context"
	"encoding/json"
	"log"
)

// Side = arah eksekusi.
type Side string

const (
	Buy  Side = "buy"
	Sell Side = "sell"
)

// OrderType = jenis order.
type OrderType string

const (
	Market OrderType = "market"
	Limit  OrderType = "limit"
	Stop   OrderType = "stop"
)

// Instrument = simbol kanonik internal (pakai bentuk OANDA "EUR_USD").
// Tiap connector memetakan ke simbol broker-nya sendiri.
type Instrument string

// Account = ringkasan akun ternormalisasi (mata uang akun diasumsikan USD).
type Account struct {
	ID                string  `json:"id"`
	Currency          string  `json:"currency"`
	Balance           float64 `json:"balance"`
	Equity            float64 `json:"equity"` // NAV
	UnrealizedPL      float64 `json:"unrealizedPl"`
	MarginUsed        float64 `json:"marginUsed"`
	MarginAvailable   float64 `json:"marginAvailable"`
	OpenPositionCount int     `json:"openPositionCount"`
}

// Position = posisi net per instrumen (units signed: + long, - short).
type Position struct {
	Instrument   Instrument `json:"instrument"`
	Units        float64    `json:"units"`
	AvgPrice     float64    `json:"avgPrice"`
	UnrealizedPL float64    `json:"unrealizedPl"`
}

// Trade = trade granular broker (OANDA "trade"; TradeLocker "position").
type Trade struct {
	ID           string     `json:"id"`
	Instrument   Instrument `json:"instrument"`
	Units        float64    `json:"units"` // signed
	Price        float64    `json:"price"`
	SL           *float64   `json:"sl,omitempty"`
	TP           *float64   `json:"tp,omitempty"`
	UnrealizedPL float64    `json:"unrealizedPl"`
	OpenTime     string     `json:"openTime"`
}

// OrderRequest = permintaan order ternormalisasi (sudah tervalidasi server).
type OrderRequest struct {
	Instrument Instrument
	Side       Side
	Type       OrderType
	Units      float64  // selalu positif; Side menentukan arah
	Price      *float64 // wajib untuk limit/stop
	SL         *float64 // bracket; nil = tanpa SL
	TP         *float64
	TrailDist  *float64 // trailing distance (jarak harga absolut); nil = tidak
	ClientTag  string   // idempotency / korelasi audit
}

// OrderResult = hasil eksekusi order.
type OrderResult struct {
	BrokerOrderID string          `json:"brokerOrderId"`
	BrokerTradeID string          `json:"brokerTradeId,omitempty"`
	FillPrice     *float64        `json:"fillPrice,omitempty"`
	FilledUnits   float64         `json:"filledUnits"`
	Status        string          `json:"status"` // FILLED | PENDING | REJECTED | CANCELLED
	Raw           json.RawMessage `json:"-"`       // disimpan ke order_audit
}

// Tick = update harga bid/ask untuk satu instrumen.
type Tick struct {
	Instrument Instrument `json:"instrument"`
	Bid        float64    `json:"bid"`
	Ask        float64    `json:"ask"`
	Time       string     `json:"time"`
}

// Connector = kontrak backend-agnostik. Semua method context-aware
// (untuk cancel stream / timeout request).
type Connector interface {
	Name() string
	AccountSummary(ctx context.Context) (Account, error)
	Positions(ctx context.Context) ([]Position, error)
	Trades(ctx context.Context) ([]Trade, error)
	PlaceOrder(ctx context.Context, req OrderRequest) (OrderResult, error)
	ClosePosition(ctx context.Context, inst Instrument) (OrderResult, error)
	// CloseTrade menutup trade by-ID; units<=0 berarti tutup penuh.
	CloseTrade(ctx context.Context, tradeID string, units float64) (OrderResult, error)
	// PriceStream menulis Tick ke ch sampai ctx dibatalkan; reconnect internal.
	PriceStream(ctx context.Context, insts []Instrument, ch chan<- Tick) error
}

// buildConnector membuat connector untuk broker aktif dari konfigurasi.
// TradeLocker menyusul (Fase 8); sementara fallback ke OANDA.
func buildConnector(c Config) Connector {
	switch c.Broker {
	case "oanda":
		return NewOANDAConnector(c.Creds)
	default:
		log.Printf("BROKER=%q belum didukung, pakai oanda", c.Broker)
		return NewOANDAConnector(c.Creds)
	}
}
