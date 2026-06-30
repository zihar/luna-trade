// DXY (U.S. Dollar Index) sintetis. OANDA tidak menyediakan instrumen DXY, jadi
// kita hitung sendiri dari 6 pasangan komponen pakai rumus & bobot ICE:
//
//	DXY = 50.14348112 × EURUSD^-0.576 × USDJPY^0.136 × GBPUSD^-0.119
//	                  × USDCAD^0.091 × USDSEK^0.042 × USDCHF^0.036
//
// Endpoint /api/candles?instrument=DXY... dilayani di sini: ambil 6 seri candle
// dengan granularity/count/to/from yang sama, selaraskan per-timestamp, lalu
// keluarkan JSON bentuk OANDA (candles[].mid.o/h/l/c) supaya FE memperlakukannya
// identik dengan instrumen biasa.
package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"sync"
)

const dxyConst = 50.14348112

// Komponen DXY. exp = eksponen bobot ICE. Karena DXY = const·Π price^exp, tiap
// faktor monoton terhadap harga: exp>0 → DXY naik saat harga naik (pakai High
// komponen untuk High DXY); exp<0 → kebalikannya (pakai Low untuk High DXY).
var dxyComps = []struct {
	inst string
	exp  float64
}{
	{"EUR_USD", -0.576},
	{"USD_JPY", 0.136},
	{"GBP_USD", -0.119},
	{"USD_CAD", 0.091},
	{"USD_SEK", 0.042},
	{"USD_CHF", 0.036},
}

const dxyInstrument = Instrument("DXY")

// isDXYComponent: true bila instrumen termasuk salah satu komponen DXY.
func isDXYComponent(inst Instrument) bool {
	for _, c := range dxyComps {
		if Instrument(c.inst) == inst {
			return true
		}
	}
	return false
}

// synthDXYTick menghitung tick DXY dari mid 6 komponen pada snapshot `last`.
// ok=false bila ada komponen yang belum punya harga (DXY belum bisa dihitung).
func synthDXYTick(last map[Instrument]Tick) (Tick, bool) {
	val := dxyConst
	var latest string
	for _, c := range dxyComps {
		t, ok := last[Instrument(c.inst)]
		if !ok {
			return Tick{}, false
		}
		mid := (t.Bid + t.Ask) / 2
		if mid <= 0 {
			return Tick{}, false
		}
		val *= math.Pow(mid, c.exp)
		if t.Time > latest {
			latest = t.Time
		}
	}
	// DXY = indeks (tak ada spread nyata) → bid=ask=nilai.
	return Tick{Instrument: dxyInstrument, Bid: val, Ask: val, Time: latest}, true
}

type oandaCandle struct {
	Time string `json:"time"`
	Mid  struct {
		O string `json:"o"`
		H string `json:"h"`
		L string `json:"l"`
		C string `json:"c"`
	} `json:"mid"`
	Volume   int  `json:"volume"`
	Complete bool `json:"complete"`
}

type oandaCandles struct {
	Instrument  string        `json:"instrument"`
	Granularity string        `json:"granularity"`
	Candles     []oandaCandle `json:"candles"`
}

// fetchOandaCandles mengambil satu seri candle dari OANDA. p sudah berisi
// granularity/price/count/to/from (tanpa instrument).
func fetchOandaCandles(token, inst string, p url.Values) (*oandaCandles, error) {
	target := host() + "/v3/instruments/" + url.PathEscape(inst) + "/candles?" + p.Encode()
	req, _ := http.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept-Datetime-Format", "RFC3339")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("OANDA %s → HTTP %d", inst, resp.StatusCode)
	}
	var out oandaCandles
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

type ohlc struct {
	o, h, l, c float64
	complete   bool
}

// handleDXYCandles melayani /api/candles untuk DXY sintetis. p = query OANDA
// (granularity/price/count/to/from) yang sudah dibangun candlesHandler.
func handleDXYCandles(w http.ResponseWriter, token string, gran string, p url.Values) {
	// Ambil 6 komponen paralel.
	type res struct {
		idx    int
		series map[string]ohlc // key = timestamp RFC3339
		order  []string        // urutan timestamp dari komponen pertama
		err    error
	}
	results := make([]res, len(dxyComps))
	var wg sync.WaitGroup
	for i, comp := range dxyComps {
		wg.Add(1)
		go func(i int, inst string) {
			defer wg.Done()
			cs, err := fetchOandaCandles(token, inst, p)
			if err != nil {
				results[i] = res{idx: i, err: err}
				return
			}
			m := make(map[string]ohlc, len(cs.Candles))
			order := make([]string, 0, len(cs.Candles))
			for _, c := range cs.Candles {
				o, _ := strconv.ParseFloat(c.Mid.O, 64)
				h, _ := strconv.ParseFloat(c.Mid.H, 64)
				l, _ := strconv.ParseFloat(c.Mid.L, 64)
				cl, _ := strconv.ParseFloat(c.Mid.C, 64)
				m[c.Time] = ohlc{o: o, h: h, l: l, c: cl, complete: c.Complete}
				order = append(order, c.Time)
			}
			results[i] = res{idx: i, series: m, order: order}
		}(i, comp.inst)
	}
	wg.Wait()

	for _, r := range results {
		if r.err != nil {
			writeErr(w, http.StatusBadGateway, "DXY: gagal ambil "+dxyComps[r.idx].inst+": "+r.err.Error())
			return
		}
	}

	// Timestamp acuan = urutan komponen pertama (EUR_USD); emit hanya yang ada di
	// SEMUA komponen agar tidak ada candle pincang.
	ref := results[0]
	out := oandaCandles{Instrument: "DXY", Granularity: gran, Candles: make([]oandaCandle, 0, len(ref.order))}
	for _, ts := range ref.order {
		bars := make([]ohlc, len(dxyComps))
		ok := true
		for i := range dxyComps {
			b, found := results[i].series[ts]
			if !found {
				ok = false
				break
			}
			bars[i] = b
		}
		if !ok {
			continue
		}
		// Hitung O/H/L/C DXY. H/L pakai harga komponen yang memaksimalkan/
		// meminimalkan DXY sesuai tanda eksponen.
		dO, dH, dL, dC := dxyConst, dxyConst, dxyConst, dxyConst
		complete := true
		for i, comp := range dxyComps {
			b := bars[i]
			hiPrice, loPrice := b.h, b.l
			if comp.exp < 0 { // faktor turun saat harga naik → tukar
				hiPrice, loPrice = b.l, b.h
			}
			dO *= math.Pow(b.o, comp.exp)
			dC *= math.Pow(b.c, comp.exp)
			dH *= math.Pow(hiPrice, comp.exp)
			dL *= math.Pow(loPrice, comp.exp)
			if !b.complete {
				complete = false
			}
		}
		var c oandaCandle
		c.Time = ts
		c.Mid.O = strconv.FormatFloat(dO, 'f', 3, 64)
		c.Mid.H = strconv.FormatFloat(dH, 'f', 3, 64)
		c.Mid.L = strconv.FormatFloat(dL, 'f', 3, 64)
		c.Mid.C = strconv.FormatFloat(dC, 'f', 3, 64)
		c.Volume = 0
		c.Complete = complete
		out.Candles = append(out.Candles, c)
	}

	writeJSON(w, http.StatusOK, out)
}
