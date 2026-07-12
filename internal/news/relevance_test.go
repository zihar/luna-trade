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

func TestRelevanceForETHNoWordFalsePositive(t *testing.T) {
	m := RelevanceFor("ETH_USD")
	// real ethereum headline → relevan
	if !m.matches("Ethereum upgrade goes live", "") {
		t.Fatal("ethereum headline should match ETH_USD")
	}
	// kata umum yang MENGANDUNG substring 'ether' → JANGAN cocok
	if m.matches("Traders debate whether the Fed will cut rates", "") {
		t.Fatal("'whether' must not match ETH_USD")
	}
	if m.matches("Markets rally together as risk appetite returns", "") {
		t.Fatal("'together' must not match ETH_USD")
	}
}

func TestRelevanceForUSDTreasuryNoCorporateFP(t *testing.T) {
	// "Bitcoin treasury" (korporat) JANGAN kejeblos ke instrumen USD/gold
	gold := RelevanceFor("XAU_USD")
	if gold.matches("Empery Digital shares rise after selling Bitcoin treasury to fund AI data center", "") {
		t.Fatal("'Bitcoin treasury' must not match XAU_USD via bare 'treasury'")
	}
	// sinyal makro US Treasury yang asli TETAP cocok
	eur := RelevanceFor("EUR_USD")
	if !eur.matches("US Treasury yields climb as dollar firms", "") {
		t.Fatal("'Treasury yields' + 'dollar' should still match a USD-side instrument")
	}
	if !eur.matches("Demand for Treasuries wanes ahead of auction", "") {
		t.Fatal("'Treasuries' should match a USD-side instrument")
	}
}
