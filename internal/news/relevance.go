package news

import (
	"regexp"
	"strings"
)

// Matcher menentukan apakah sebuah berita relevan untuk instrumen tertentu.
// Dua tier:
//   - include = substring lowercase (default). Cocok bila muncul di mana pun.
//   - word    = token yang dicek sebagai KATA UTUH (word-boundary), untuk token
//     pendek yang rawan false-positive sebagai substring (mis. "dow"→download,
//     "boe"→Boeing, "franc"→France, "eth"→method/whether). Ini "escape hatch"
//     yang disebut spec §5.2 ("word-boundary … bila test menunjukkan perlu").
//
// Relevan bila ADA satu keyword (tier mana pun) yang cocok di judul+ringkasan.
type Matcher struct {
	include []string
	word    []string
}

// wordRe = regex word-boundary terprakompilasi per keyword `word` (dibangun sekali
// di init dari currencyWordKeywords + assetWordKeywords).
var wordRe = map[string]*regexp.Regexp{}

func init() {
	compile := func(m map[string][]string) {
		for _, kws := range m {
			for _, kw := range kws {
				if _, ok := wordRe[kw]; !ok {
					wordRe[kw] = regexp.MustCompile(`\b` + regexp.QuoteMeta(kw) + `\b`)
				}
			}
		}
	}
	compile(currencyWordKeywords)
	compile(assetWordKeywords)
}

// matches (internal) cek judul+ringkasan tanpa bergantung tipe Headline (Task 2).
func (m Matcher) matches(title, summary string) bool {
	hay := strings.ToLower(title + " " + summary)
	for _, kw := range m.include {
		if kw != "" && strings.Contains(hay, kw) {
			return true
		}
	}
	for _, kw := range m.word {
		if re := wordRe[kw]; re != nil && re.MatchString(hay) {
			return true
		}
	}
	return false
}

// currencyKeywords = kata kunci berita SUBSTRING per mata uang fiat (lowercase).
// Token pendek yang rawan false-positive sebagai substring dipindah ke
// currencyWordKeywords (dicek word-boundary), bukan dibuang.
var currencyKeywords = map[string][]string{
	"USD": {"dollar", "greenback", "fed", "fomc", "treasury yield", "treasuries"},
	"EUR": {"euro", "ecb", "eurozone"},
	"GBP": {"pound", "sterling", "bank of england"},
	"JPY": {"yen", "boj", "bank of japan"},
	"CHF": {"swiss franc", "snb"},
	"CAD": {"canadian dollar", "loonie", "bank of canada"},
	"AUD": {"aussie", "australian dollar", "rba"},
	"NZD": {"kiwi", "new zealand dollar", "rbnz"},
}

// currencyWordKeywords = token pendek per fiat, dicek KATA UTUH (word-boundary) →
// aman dari false-positive substring. Sinkron spec §5.2. Catatan: bare "treasury"
// SENGAJA TIDAK di sini — "Bitcoin treasury" (korporat) itu kata utuh legit, jadi
// word-boundary tak menolong; USD tetap pakai "treasury yield"/"treasuries".
var currencyWordKeywords = map[string][]string{
	"USD": {"dxy"},   // "DXY firms" ✓ (indeks dolar)
	"GBP": {"boe"},   // "BoE holds" ✓ tapi "Boeing" ✗
	"CHF": {"franc"}, // "Swiss franc" ✓ tapi "France" ✗
}

// assetKeywords = kata kunci berita SUBSTRING per aset non-fiat (kode base ala IPK_META).
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
	"FTSE":  {"ftse", "uk 100"},
	"CAC":   {"cac 40"},
	"STOXX": {"euro stoxx", "stoxx 50"},
	"NKY":   {"nikkei"},
	"ASX":   {"asx 200", "australia 200"},
	"HSI":   {"hang seng"},
}

// assetWordKeywords = token pendek per aset, dicek KATA UTUH (word-boundary). Sinkron
// spec §5.2: ETH → +eth/ether, DJI → +dow. "$ETH surges"/"Dow closes" ✓ tapi
// "method"/"whether"/"download" ✗.
var assetWordKeywords = map[string][]string{
	"ETH": {"eth", "ether"},
	"DJI": {"dow"},
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
	seenInc, seenWord := map[string]bool{}, map[string]bool{}
	var include, word []string
	add := func(kws []string) {
		for _, kw := range kws {
			if !seenInc[kw] {
				seenInc[kw] = true
				include = append(include, kw)
			}
		}
	}
	addWord := func(kws []string) {
		for _, kw := range kws {
			if !seenWord[kw] {
				seenWord[kw] = true
				word = append(word, kw)
			}
		}
	}
	for _, code := range instrumentAssets[norm] {
		add(assetKeywords[code])
		addWord(assetWordKeywords[code])
	}
	if !cryptoInstruments[norm] {
		for _, ccy := range RelevantCurrencies(norm) {
			add(currencyKeywords[ccy])
			addWord(currencyWordKeywords[ccy])
		}
	}
	return Matcher{include: include, word: word}
}

// Matches = wrapper publik: relevan bila salah satu keyword muncul di Title+Summary.
func (m Matcher) Matches(h Headline) bool { return m.matches(h.Title, h.Summary) }
