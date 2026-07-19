package main

import "testing"

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
