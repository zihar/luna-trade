package news

import "testing"

func TestInstrumentRole(t *testing.T) {
	cases := map[string]Role{
		"EUR_USD": RoleQuoteUSD, "GBP_USD": RoleQuoteUSD, "AUD_USD": RoleQuoteUSD, "NZD_USD": RoleQuoteUSD,
		"USD_JPY": RoleBaseUSD, "USD_CAD": RoleBaseUSD, "USD_CHF": RoleBaseUSD,
		"XAU_USD": RoleGold, "XAG_USD": RoleGold,
		"DXY":     RoleDXY,
		"EUR_JPY": RoleUnknown, "BTC_USD": RoleUnknown, "": RoleUnknown,
	}
	for sym, want := range cases {
		if got := InstrumentRole(sym); got != want {
			t.Errorf("InstrumentRole(%q) = %v; want %v", sym, got, want)
		}
	}
}

func TestInstrumentBias(t *testing.T) {
	// USD hawkish (data kuat, USD↑)
	if InstrumentBias(LeanHawkish, RoleQuoteUSD) != BiasBearish {
		t.Error("hawkish + EUR/USD → bearish")
	}
	if InstrumentBias(LeanHawkish, RoleBaseUSD) != BiasBullish {
		t.Error("hawkish + USD/JPY → bullish")
	}
	if InstrumentBias(LeanHawkish, RoleGold) != BiasBearish {
		t.Error("hawkish + gold → bearish")
	}
	if InstrumentBias(LeanHawkish, RoleDXY) != BiasBullish {
		t.Error("hawkish + DXY → bullish")
	}
	// USD dovish (data lemah, USD↓) — kebalikan
	if InstrumentBias(LeanDovish, RoleQuoteUSD) != BiasBullish {
		t.Error("dovish + EUR/USD → bullish")
	}
	if InstrumentBias(LeanDovish, RoleGold) != BiasBullish {
		t.Error("dovish + gold → bullish")
	}
	// neutral / unknown → neutral
	if InstrumentBias(LeanNeutral, RoleGold) != BiasNeutral {
		t.Error("neutral lean → neutral")
	}
	if InstrumentBias(LeanHawkish, RoleUnknown) != BiasNeutral {
		t.Error("unknown role → neutral")
	}
}

func TestBiasString(t *testing.T) {
	if BiasBearish.String() != "bearish" || BiasBullish.String() != "bullish" || BiasNeutral.String() != "neutral" {
		t.Error("Bias.String mismatch")
	}
}

func TestPrettySymbol(t *testing.T) {
	cases := map[string]string{
		"XAU_USD":  "XAU/USD",
		"DXY":      "DXY",
		"eur_usd":  "EUR/USD",
		"GBP_USD":  "GBP/USD",
		"USD_JPY":  "USD/JPY",
		"  XAG_USD": "XAG/USD",
	}
	for input, want := range cases {
		if got := PrettySymbol(input); got != want {
			t.Errorf("PrettySymbol(%q) = %q; want %q", input, got, want)
		}
	}
}

func TestPlaybook(t *testing.T) {
	// RoleUnknown: "No direct USD linkage for ..."
	got := Playbook(LeanHawkish, RoleUnknown, BiasBearish, "BTC_USD")
	want := "No direct USD linkage for BTC/USD."
	if got != want {
		t.Errorf("Playbook(LeanHawkish, RoleUnknown, ...) = %q; want %q", got, want)
	}

	// RoleGold + LeanHawkish + BiasBearish
	got = Playbook(LeanHawkish, RoleGold, BiasBearish, "XAU_USD")
	want = "Strong data → hawkish Fed → USD up → bearish XAU/USD."
	if got != want {
		t.Errorf("Playbook(LeanHawkish, RoleGold, BiasBearish, ...) = %q; want %q", got, want)
	}

	// LeanDovish case
	got = Playbook(LeanDovish, RoleQuoteUSD, BiasBullish, "EUR_USD")
	want = "Soft data → room for cuts → USD down → bullish EUR/USD."
	if got != want {
		t.Errorf("Playbook(LeanDovish, RoleQuoteUSD, BiasBullish, ...) = %q; want %q", got, want)
	}

	// LeanNeutral case (default)
	got = Playbook(LeanNeutral, RoleBaseUSD, BiasNeutral, "USD_JPY")
	want = "Small surprise → limited impact; USD/JPY likely technical-driven."
	if got != want {
		t.Errorf("Playbook(LeanNeutral, ...) = %q; want %q", got, want)
	}
}

func TestPreScenario(t *testing.T) {
	// RoleUnknown case
	got := PreScenario(RoleUnknown, "BTC_USD")
	want := "No direct USD linkage for BTC/USD."
	if got != want {
		t.Errorf("PreScenario(RoleUnknown, ...) = %q; want %q", got, want)
	}

	// RoleQuoteUSD (EUR_USD): hawkish → bearish, dovish → bullish
	got = PreScenario(RoleQuoteUSD, "EUR_USD")
	want = "Above forecast → USD up → bearish EUR/USD; below → bullish EUR/USD."
	if got != want {
		t.Errorf("PreScenario(RoleQuoteUSD, EUR_USD) = %q; want %q", got, want)
	}

	// RoleGold (hawkish → bearish, dovish → bullish)
	got = PreScenario(RoleGold, "XAU_USD")
	want = "Above forecast → USD up → bearish XAU/USD; below → bullish XAU/USD."
	if got != want {
		t.Errorf("PreScenario(RoleGold, XAU_USD) = %q; want %q", got, want)
	}

	// RoleBaseUSD (hawkish → bullish, dovish → bearish)
	got = PreScenario(RoleBaseUSD, "USD_JPY")
	want = "Above forecast → USD up → bullish USD/JPY; below → bearish USD/JPY."
	if got != want {
		t.Errorf("PreScenario(RoleBaseUSD, USD_JPY) = %q; want %q", got, want)
	}
}
