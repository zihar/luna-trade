// Package stocks: sumber candle saham (IDX + US) via Yahoo, untuk charting/analisa
// saja (non-tradeable). Mengikuti pola dxy.go: intersep di candlesHandler, emit
// bentuk JSON OANDA. Sumbu live (Finnhub) sengaja TIDAK diimplementasi — cukup
// bar historis; seam TickSource bisa ditambah kelak tanpa mengubah StockSource.
package main

import "strings"

// resolveSource memilih sumber candle berdasar simbol instrumen.
func resolveSource(inst string) string {
	if inst == "DXY" || inst == "USD_DXY" {
		return "dxy"
	}
	if strings.HasPrefix(inst, "STOCK:") {
		return "stock"
	}
	return "oanda"
}
