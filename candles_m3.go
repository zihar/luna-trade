// M3 (3 menit) tidak ada di OANDA (adanya M1, M2, M4, M5, …), jadi dibuat di sini dengan menggabungkan
// candle M1. Dipasang sebagai pembungkus candlesHandler → seluruh pemanggil (muat awal, live-refresh,
// multi-chart, DXY) otomatis dapat M3 tanpa perubahan di sisi FE selain daftar TF.
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"time"
)

const m3Span = 3 * time.Minute

// withM3 mencegat granularity=M3: minta M1 sebanyak ~3× lalu gabungkan per 3 menit.
func withM3(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("granularity") != "M3" {
			next(w, r)
			return
		}
		want := 5000
		if c, err := strconv.Atoi(q.Get("count")); err == nil && c > 0 {
			want = c
		}
		ask := want*3 + 2
		if ask > 5000 { // batas OANDA per request
			ask = 5000
		}
		q.Set("granularity", "M1")
		q.Set("count", strconv.Itoa(ask))
		r2 := r.Clone(r.Context())
		r2.URL.RawQuery = q.Encode()

		rec := httptest.NewRecorder()
		next(rec, r2)
		if rec.Code != http.StatusOK {
			w.Header().Set("Content-Type", rec.Header().Get("Content-Type"))
			w.WriteHeader(rec.Code)
			w.Write(rec.Body.Bytes())
			return
		}
		var in oandaCandles
		if err := json.Unmarshal(rec.Body.Bytes(), &in); err != nil {
			http.Error(w, "respons M1 tak terbaca", http.StatusBadGateway)
			return
		}
		out := aggregateM3(in.Candles, ask)
		if len(out) > want {
			out = out[len(out)-want:]
		}
		in.Granularity = "M3"
		in.Candles = out
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(in)
	}
}

// aggregateM3 menggabungkan candle M1 (urut waktu) ke bucket 3 menit yang berjangkar di kelipatan
// 3 menit epoch (sejajar batas jam). requested = jumlah M1 yang diminta: bila hasilnya penuh, M1
// pertama bisa terpotong di tengah bucket → bucket depan itu dibuang (OHLC-nya tak utuh).
func aggregateM3(m1 []oandaCandle, requested int) []oandaCandle {
	var out []oandaCandle
	var curStart time.Time
	var curLast time.Time
	var curLastComplete bool
	var cur *oandaCandle
	var hi, lo float64
	flush := func() {
		if cur == nil {
			return
		}
		cur.Mid.H = strconv.FormatFloat(hi, 'f', -1, 64)
		cur.Mid.L = strconv.FormatFloat(lo, 'f', -1, 64)
		// utuh bila M1 terakhir complete DAN menutup ujung bucket
		cur.Complete = curLastComplete && !curLast.Add(time.Minute).Before(curStart.Add(m3Span))
		out = append(out, *cur)
		cur = nil
	}
	truncated := len(m1) >= requested
	var skip time.Time // bucket depan yang terpotong → seluruh M1-nya diabaikan
	for i, c := range m1 {
		t, err := time.Parse(time.RFC3339, c.Time)
		if err != nil {
			continue
		}
		start := t.Truncate(m3Span)
		if i == 0 && truncated && !t.Equal(start) {
			skip = start
		}
		if !skip.IsZero() && start.Equal(skip) {
			continue
		}
		if cur == nil || !start.Equal(curStart) {
			flush()
			curStart = start
			n := oandaCandle{Time: start.UTC().Format("2006-01-02T15:04:05.000000000Z")}
			n.Mid.O = c.Mid.O
			cur = &n
			hi, lo = m3F(c.Mid.H), m3F(c.Mid.L)
		} else {
			if v := m3F(c.Mid.H); v > hi {
				hi = v
			}
			if v := m3F(c.Mid.L); v < lo {
				lo = v
			}
		}
		cur.Mid.C = c.Mid.C
		cur.Volume += c.Volume
		curLast, curLastComplete = t, c.Complete
	}
	flush()
	return out
}

func m3F(s string) float64 { f, _ := strconv.ParseFloat(s, 64); return f }
