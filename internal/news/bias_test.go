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
