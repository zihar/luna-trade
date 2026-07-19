package main

import (
	"encoding/json"
	"os"
	"testing"
)

func TestResolveSource(t *testing.T) {
	cases := map[string]string{
		"DXY":           "dxy",
		"USD_DXY":       "dxy",
		"STOCK:BBCA.JK": "stock",
		"STOCK:AAPL":    "stock",
		"EUR_USD":       "oanda",
		"XAU_USD":       "oanda",
	}
	for inst, want := range cases {
		if got := resolveSource(inst); got != want {
			t.Errorf("resolveSource(%q) = %q, want %q", inst, got, want)
		}
	}
}

func TestMapGran(t *testing.T) {
	cases := map[string][2]string{
		"D":   {"1d", "10y"},
		"W":   {"1wk", "max"},
		"MN":  {"1mo", "max"},
		"H1":  {"60m", "730d"},
		"M15": {"15m", "60d"},
		"M5":  {"5m", "60d"},
		"H4":  {"1d", "10y"}, // fallback ke daily
	}
	for gran, want := range cases {
		i, r := mapGran(gran)
		if i != want[0] || r != want[1] {
			t.Errorf("mapGran(%q) = (%q,%q), want (%q,%q)", gran, i, r, want[0], want[1])
		}
	}
}

func TestConvertYahoo_AdjustedSkipNull(t *testing.T) {
	b, err := os.ReadFile("testdata/yahoo_bbca.json")
	if err != nil {
		t.Fatal(err)
	}
	var raw yahooChartResp
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	oc, err := convertYahoo(&raw, 5000)
	if err != nil {
		t.Fatal(err)
	}
	if len(oc.Candles) != 2 { // bar null dilewati
		t.Fatalf("len candles = %d, want 2", len(oc.Candles))
	}
	c0 := oc.Candles[0]
	if c0.Time != "2024-01-02T00:00:00Z" {
		t.Errorf("time = %q, want 2024-01-02T00:00:00Z", c0.Time)
	}
	if c0.Mid.O != "4750" { // 9500 * (4775/9550=0.5)
		t.Errorf("adjusted open = %q, want 4750", c0.Mid.O)
	}
	if c0.Mid.C != "4775" {
		t.Errorf("adjusted close = %q, want 4775", c0.Mid.C)
	}
	if c0.Volume != 1000000 {
		t.Errorf("volume = %d, want 1000000", c0.Volume)
	}
	if !c0.Complete {
		t.Errorf("complete = false, want true")
	}
}
