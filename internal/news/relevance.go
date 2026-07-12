package news

import "strings"

// Matcher menentukan apakah sebuah berita relevan untuk instrumen tertentu.
// include = daftar substring lowercase; ADA satu yang cocok di judul+ringkasan → relevan.
type Matcher struct {
	include []string
}

// matches (internal) cek judul+ringkasan tanpa bergantung tipe Headline (Task 2).
func (m Matcher) matches(title, summary string) bool {
	hay := strings.ToLower(title + " " + summary)
	for _, kw := range m.include {
		if kw != "" && strings.Contains(hay, kw) {
			return true
		}
	}
	return false
}

// currencyKeywords = kata kunci berita per mata uang fiat (lowercase). Token pendek
// yang rawan false-positive (mis. "boe"→Boeing, "franc"→France) sengaja dihindari.
var currencyKeywords = map[string][]string{
	"USD": {"dollar", "greenback", "fed", "fomc", "treasury"},
	"EUR": {"euro", "ecb", "eurozone"},
	"GBP": {"pound", "sterling", "bank of england"},
	"JPY": {"yen", "boj", "bank of japan"},
	"CHF": {"swiss franc", "snb"},
	"CAD": {"canadian dollar", "loonie", "bank of canada"},
	"AUD": {"aussie", "australian dollar", "rba"},
	"NZD": {"kiwi", "new zealand dollar", "rbnz"},
}

// assetKeywords = kata kunci berita per aset non-fiat (kode base ala IPK_META).
// Token pendek rawan (mis. "dow"→download, "eth"→method) dihindari.
var assetKeywords = map[string][]string{
	"XAU":   {"gold", "bullion", "xau"},
	"XAG":   {"silver", "xag"},
	"BTC":   {"bitcoin", "btc"},
	"ETH":   {"ethereum"},
	"LTC":   {"litecoin", "ltc"},
	"BCH":   {"bitcoin cash", "bch"},
	"SPX":   {"s&p 500", "s&p500", "spx"},
	"NAS":   {"nasdaq", "nas100"},
	"DJI":   {"dow jones"},
	"RUT":   {"russell 2000"},
	"DAX":   {"dax", "germany 40"},
	"FTSE":  {"ftse"},
	"CAC":   {"cac 40"},
	"STOXX": {"euro stoxx", "stoxx 50"},
	"NKY":   {"nikkei"},
	"ASX":   {"asx 200", "australia 200"},
	"HSI":   {"hang seng"},
}

// instrumentAssets memetakan simbol instrumen non-forex → kode aset (utk assetKeywords).
// Forex murni tak ada di sini (ditangani RelevantCurrencies).
var instrumentAssets = map[string][]string{
	"XAU_USD": {"XAU"}, "XAG_USD": {"XAG"}, "DXY": {},
	"SPX500_USD": {"SPX"}, "NAS100_USD": {"NAS"}, "US30_USD": {"DJI"}, "US2000_USD": {"RUT"},
	"DE30_EUR": {"DAX"}, "UK100_GBP": {"FTSE"}, "FR40_EUR": {"CAC"}, "EU50_EUR": {"STOXX"},
	"JP225_USD": {"NKY"}, "AU200_AUD": {"ASX"}, "HK33_HKD": {"HSI"},
	"BTC_USD": {"BTC"}, "ETH_USD": {"ETH"}, "LTC_USD": {"LTC"}, "BCH_USD": {"BCH"},
}

// cryptoInstruments = instrumen crypto (relevansi = aset saja, TIDAK ikut makro USD).
var cryptoInstruments = map[string]bool{
	"BTC_USD": true, "ETH_USD": true, "LTC_USD": true, "BCH_USD": true,
}

// RelevanceFor membangun Matcher untuk instrumen (mis. "XAU_USD"):
//   - aset non-fiat (gold/indeks/crypto) → assetKeywords
//   - mata uang fiat relevan (kedua sisi pasangan; metal/DXY → USD) → currencyKeywords,
//     KECUALI crypto (aset saja).
func RelevanceFor(instrument string) Matcher {
	norm := strings.ReplaceAll(strings.ToUpper(strings.TrimSpace(instrument)), "/", "_")
	seen := map[string]bool{}
	var include []string
	add := func(kws []string) {
		for _, kw := range kws {
			if !seen[kw] {
				seen[kw] = true
				include = append(include, kw)
			}
		}
	}
	for _, code := range instrumentAssets[norm] {
		add(assetKeywords[code])
	}
	if !cryptoInstruments[norm] {
		for _, ccy := range RelevantCurrencies(norm) {
			add(currencyKeywords[ccy])
		}
	}
	return Matcher{include: include}
}
