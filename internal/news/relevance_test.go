package news

import "testing"

func TestRelevanceForGold(t *testing.T) {
	m := RelevanceFor("XAU_USD")
	// gold headline → relevan
	if !m.matches("Gold slips as dollar firms ahead of Fed", "") {
		t.Fatal("gold headline should match XAU_USD")
	}
	// berita crypto → TIDAK relevan utk gold
	if m.matches("Bitcoin surges past resistance", "") {
		t.Fatal("bitcoin headline should NOT match XAU_USD")
	}
}

func TestRelevanceForForexBothSides(t *testing.T) {
	m := RelevanceFor("GBP_USD")
	if !m.matches("Sterling rallies on hot UK CPI", "") {
		t.Fatal("GBP headline should match GBP_USD")
	}
	if !m.matches("Dollar firms after FOMC minutes", "") {
		t.Fatal("USD headline should match GBP_USD")
	}
	if m.matches("Euro dips as ECB holds", "") {
		t.Fatal("EUR-only headline should NOT match GBP_USD")
	}
}

func TestRelevanceForCryptoNoMacroUSD(t *testing.T) {
	m := RelevanceFor("BTC_USD")
	if !m.matches("Bitcoin ETF inflows accelerate", "") {
		t.Fatal("bitcoin headline should match BTC_USD")
	}
	// crypto = aset saja, TIDAK ikut makro USD → "dollar firms" bukan berita BTC
	if m.matches("Dollar firms as yields climb", "") {
		t.Fatal("macro USD headline should NOT match crypto")
	}
}

func TestRelevanceNoShortTokenFalsePositive(t *testing.T) {
	// "download" jangan cocok Dow (US30), "Boeing" jangan cocok BoE (GBP)
	if RelevanceFor("US30_USD").matches("Download the new trading app", "") {
		t.Fatal("'download' must not match Dow (US30)")
	}
	if RelevanceFor("GBP_USD").matches("Boeing shares climb on orders", "") {
		t.Fatal("'Boeing' must not match Bank of England (GBP)")
	}
}
