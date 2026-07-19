// Package stocks: sumber candle saham (IDX + US) via Yahoo, untuk charting/analisa
// saja (non-tradeable). Mengikuti pola dxy.go: intersep di candlesHandler, emit
// bentuk JSON OANDA. Sumbu live (Finnhub) sengaja TIDAK diimplementasi — cukup
// bar historis; seam TickSource bisa ditambah kelak tanpa mengubah StockSource.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// isNonTradeable: instrumen chart-only (saham & DXY sintetis) yang tak boleh
// dieksekusi sebagai order. Dipakai handlePaperOrder (defense-in-depth).
func isNonTradeable(inst string) bool {
	return inst == "DXY" || inst == "USD_DXY" || strings.HasPrefix(inst, "STOCK:")
}

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

// yahooChartResp = subset respons Yahoo v8/finance/chart yang kita pakai.
// Array OHLC/volume/adjclose berisi null pada hari non-trading → pakai pointer
// agar bisa dibedakan dari 0.
type yahooChartResp struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Currency string `json:"currency"`
				Symbol   string `json:"symbol"`
			} `json:"meta"`
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Open   []*float64 `json:"open"`
					High   []*float64 `json:"high"`
					Low    []*float64 `json:"low"`
					Close  []*float64 `json:"close"`
					Volume []*float64 `json:"volume"`
				} `json:"quote"`
				Adjclose []struct {
					Adjclose []*float64 `json:"adjclose"`
				} `json:"adjclose"`
			} `json:"indicators"`
		} `json:"result"`
		Error interface{} `json:"error"`
	} `json:"chart"`
}

// mapGran memetakan granularity FE ke (interval, range) Yahoo. v1 fokus Daily;
// intraday didukung sejauh batas historis Yahoo.
func mapGran(gran string) (interval, rng string) {
	switch gran {
	case "W":
		return "1wk", "max"
	case "M", "MN":
		return "1mo", "max"
	case "H1":
		return "60m", "730d"
	case "M15":
		return "15m", "60d"
	case "M5":
		return "5m", "60d"
	default: // D dan lainnya
		return "1d", "10y"
	}
}

// convertYahoo mengubah respons Yahoo → bentuk oandaCandles. Harga di-adjust
// split/dividen via rasio adjclose/close; bar dengan nilai null dilewati.
func convertYahoo(raw *yahooChartResp, count int) (*oandaCandles, error) {
	if raw == nil || len(raw.Chart.Result) == 0 {
		return nil, fmt.Errorf("yahoo: empty result")
	}
	r := raw.Chart.Result[0]
	if len(r.Indicators.Quote) == 0 {
		return nil, fmt.Errorf("yahoo: no quote series")
	}
	q := r.Indicators.Quote[0]
	var adj []*float64
	if len(r.Indicators.Adjclose) > 0 {
		adj = r.Indicators.Adjclose[0].Adjclose
	}
	out := &oandaCandles{Instrument: r.Meta.Symbol, Candles: make([]oandaCandle, 0, len(r.Timestamp))}
	for i, ts := range r.Timestamp {
		if i >= len(q.Open) || i >= len(q.High) || i >= len(q.Low) || i >= len(q.Close) {
			break
		}
		if q.Open[i] == nil || q.High[i] == nil || q.Low[i] == nil || q.Close[i] == nil {
			continue // hari non-trading
		}
		o, h, l, c := *q.Open[i], *q.High[i], *q.Low[i], *q.Close[i]
		if adj != nil && i < len(adj) && adj[i] != nil && c != 0 {
			f := *adj[i] / c
			o, h, l, c = o*f, h*f, l*f, c*f
		}
		var vol int
		if i < len(q.Volume) && q.Volume[i] != nil {
			vol = int(*q.Volume[i])
		}
		var cd oandaCandle
		cd.Time = time.Unix(ts, 0).UTC().Format(time.RFC3339)
		cd.Mid.O = strconv.FormatFloat(o, 'f', -1, 64)
		cd.Mid.H = strconv.FormatFloat(h, 'f', -1, 64)
		cd.Mid.L = strconv.FormatFloat(l, 'f', -1, 64)
		cd.Mid.C = strconv.FormatFloat(c, 'f', -1, 64)
		cd.Volume = vol
		cd.Complete = true
		out.Candles = append(out.Candles, cd)
	}
	if count > 0 && len(out.Candles) > count {
		out.Candles = out.Candles[len(out.Candles)-count:]
	}
	return out, nil
}

// StockSource = sumber candle saham (swappable). Kini: yahooSource. Kelak bisa
// diganti stooqSource/twelveSource tanpa menyentuh candlesHandler.
type StockSource interface {
	Candles(sym, gran string, count int) (*oandaCandles, error)
}

var stockSrc StockSource = yahooSource{}

type yahooSource struct{}

func (yahooSource) Candles(sym, gran string, count int) (*oandaCandles, error) {
	interval, rng := mapGran(gran)
	u := "https://query1.finance.yahoo.com/v8/finance/chart/" + url.PathEscape(sym) +
		"?interval=" + interval + "&range=" + rng
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", "Mozilla/5.0") // endpoint v8 butuh UA; tanpa cookie/crumb
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo %s → HTTP %d", sym, resp.StatusCode)
	}
	var raw yahooChartResp
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, err
	}
	if raw.Chart.Error != nil {
		return nil, fmt.Errorf("yahoo %s: %v", sym, raw.Chart.Error)
	}
	oc, err := convertYahoo(&raw, count)
	if err != nil {
		return nil, err
	}
	oc.Granularity = gran
	return oc, nil
}

// handleStockCandles melayani /api/candles untuk simbol STOCK:*. Hasil di-cache
// 5 menit (data EOD/delayed) → menekan hit ke Yahoo & menghindari rate-limit.
func handleStockCandles(w http.ResponseWriter, inst, gran, countStr string) {
	sym := strings.TrimPrefix(inst, "STOCK:")
	count, _ := strconv.Atoi(countStr)
	if count <= 0 {
		count = 5000
	}
	key := "STOCK:" + sym + "|" + gran + "|" + strconv.Itoa(count)
	loader := func() ([]byte, int, error) {
		oc, err := stockSrc.Candles(sym, gran, count)
		if err != nil {
			return nil, 0, err
		}
		b, err := json.Marshal(oc)
		if err != nil {
			return nil, 0, err
		}
		return b, http.StatusOK, nil
	}
	body, status, err := candles.fetch(key, 5*time.Minute, loader)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}
