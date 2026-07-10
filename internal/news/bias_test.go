package news

import "testing"

func TestSideOf(t *testing.T) {
	type tc struct {
		sym, ccy string
		want     Side
	}
	cases := []tc{
		// USD pada pasangan USD (regresi perilaku lama)
		{"EUR_USD", "USD", SideQuote}, {"GBP_USD", "USD", SideQuote}, {"AUD_USD", "USD", SideQuote},
		{"USD_JPY", "USD", SideBase}, {"USD_CAD", "USD", SideBase}, {"USD_CHF", "USD", SideBase},
		{"XAU_USD", "USD", SideGoldUSD}, {"XAG_USD", "USD", SideGoldUSD},
		{"DXY", "USD", SideDXYUSD},
		// currency NON-USD sebagai base/quote (fitur baru)
		{"EUR_USD", "EUR", SideBase}, {"GBP_USD", "GBP", SideBase},
		{"USD_JPY", "JPY", SideQuote}, {"USD_CHF", "CHF", SideQuote},
		{"EUR_GBP", "EUR", SideBase}, {"EUR_GBP", "GBP", SideQuote},
		// currency tak terkait pair / gold non-USD / non-fiat → none
		{"EUR_USD", "JPY", SideNone}, {"XAU_USD", "EUR", SideNone},
		{"DXY", "EUR", SideNone}, {"BTC_USD", "USD", SideNone},
		{"EUR_USD", "BTC", SideNone}, {"", "USD", SideNone},
		// toleran format & spasi/casing
		{"eur/usd", "eur", SideBase}, {"GBP_USD", " gbp ", SideBase},
	}
	for _, c := range cases {
		if got := SideOf(c.sym, c.ccy); got != c.want {
			t.Errorf("SideOf(%q,%q) = %v; want %v", c.sym, c.ccy, got, c.want)
		}
	}
}

func TestBiasFrom(t *testing.T) {
	type tc struct {
		lean USDLean
		side Side
		want Bias
	}
	cases := []tc{
		// base menguat → pair naik; melemah → turun
		{LeanHawkish, SideBase, BiasBullish}, {LeanDovish, SideBase, BiasBearish},
		// quote menguat → pair turun; melemah → naik
		{LeanHawkish, SideQuote, BiasBearish}, {LeanDovish, SideQuote, BiasBullish},
		// gold inverse USD
		{LeanHawkish, SideGoldUSD, BiasBearish}, {LeanDovish, SideGoldUSD, BiasBullish},
		// DXY searah USD
		{LeanHawkish, SideDXYUSD, BiasBullish}, {LeanDovish, SideDXYUSD, BiasBearish},
		// neutral / none → neutral
		{LeanNeutral, SideBase, BiasNeutral}, {LeanNeutral, SideGoldUSD, BiasNeutral},
		{LeanHawkish, SideNone, BiasNeutral}, {LeanDovish, SideNone, BiasNeutral},
	}
	for _, c := range cases {
		if got := BiasFrom(c.lean, c.side); got != c.want {
			t.Errorf("BiasFrom(%v,%v) = %v; want %v", c.lean, c.side, got, c.want)
		}
	}
}

func TestPlaybookFor(t *testing.T) {
	cases := []struct {
		lean     USDLean
		side     Side
		bias     Bias
		ccy, sym string
		want     string
	}{
		{LeanHawkish, SideBase, BiasBullish, "GBP", "GBP_USD", "Strong GBP data → GBP up → bullish GBP/USD."},
		{LeanDovish, SideQuote, BiasBullish, "JPY", "USD_JPY", "Soft JPY data → JPY down → bullish USD/JPY."},
		{LeanHawkish, SideGoldUSD, BiasBearish, "USD", "XAU_USD", "Strong USD data → USD up → bearish XAU/USD."},
		{LeanNeutral, SideBase, BiasNeutral, "EUR", "EUR_USD", "Small surprise → limited impact; EUR/USD likely technical-driven."},
		{LeanHawkish, SideNone, BiasNeutral, "JPY", "EUR_USD", "No directional read for EUR/USD."},
	}
	for _, c := range cases {
		if got := PlaybookFor(c.lean, c.side, c.bias, c.ccy, c.sym); got != c.want {
			t.Errorf("PlaybookFor(%v,%v,%v,%q,%q) = %q; want %q", c.lean, c.side, c.bias, c.ccy, c.sym, got, c.want)
		}
	}
}

func TestPreScenarioFor(t *testing.T) {
	cases := []struct {
		side     Side
		ccy, sym string
		want     string
	}{
		{SideBase, "GBP", "GBP_USD", "Above forecast → GBP up → bullish GBP/USD; below → bearish GBP/USD."},
		{SideGoldUSD, "USD", "XAU_USD", "Above forecast → USD up → bearish XAU/USD; below → bullish XAU/USD."},
		{SideNone, "JPY", "EUR_USD", "No directional read for EUR/USD."},
	}
	for _, c := range cases {
		if got := PreScenarioFor(c.side, c.ccy, c.sym); got != c.want {
			t.Errorf("PreScenarioFor(%v,%q,%q) = %q; want %q", c.side, c.ccy, c.sym, got, c.want)
		}
	}
}

func TestBiasString(t *testing.T) {
	if BiasBearish.String() != "bearish" || BiasBullish.String() != "bullish" || BiasNeutral.String() != "neutral" {
		t.Error("Bias.String mismatch")
	}
}

func TestPrettySymbol(t *testing.T) {
	cases := map[string]string{
		"XAU_USD":   "XAU/USD",
		"DXY":       "DXY",
		"eur_usd":   "EUR/USD",
		"GBP_USD":   "GBP/USD",
		"USD_JPY":   "USD/JPY",
		"  XAG_USD": "XAG/USD",
	}
	for input, want := range cases {
		if got := PrettySymbol(input); got != want {
			t.Errorf("PrettySymbol(%q) = %q; want %q", input, got, want)
		}
	}
}
