package news

import "strings"

// fiat = mata uang fiat yang dikenali (untuk membedakan dari kripto).
var fiat = map[string]bool{
	"USD": true, "EUR": true, "GBP": true, "JPY": true, "CHF": true,
	"CAD": true, "AUD": true, "NZD": true,
}

// Side = peran currency SEBUAH EVENT terhadap instrumen (menggeneralisasi Role yang
// USD-only): currency event bisa di sisi base/quote pasangan, atau khusus USD utk gold/DXY.
type Side int

const (
	SideNone    Side = iota
	SideBase         // currency event = base pasangan (base↑ → pair↑)
	SideQuote        // currency event = quote pasangan (quote↑ → pair↓)
	SideGoldUSD      // event USD pada logam (USD↑ → gold↓)
	SideDXYUSD       // event USD pada indeks DXY (USD↑ → DXY↑)
)

// SideOf menentukan peran `ccy` (currency event, mis. "GBP"/"USD") pada `symbol`.
// Gold hanya bereaksi ke event USD; currency non-USD di gold / di luar pasangan / non-fiat → SideNone.
func SideOf(symbol, ccy string) Side {
	s := strings.ToUpper(strings.TrimSpace(symbol))
	s = strings.ReplaceAll(s, "/", "_")
	c := strings.ToUpper(strings.TrimSpace(ccy))
	if !fiat[c] {
		return SideNone
	}
	if s == "DXY" {
		if c == "USD" {
			return SideDXYUSD
		}
		return SideNone
	}
	parts := strings.SplitN(s, "_", 2)
	if len(parts) != 2 {
		return SideNone
	}
	base, quote := parts[0], parts[1]
	if base == "XAU" || base == "XAG" {
		if c == "USD" {
			return SideGoldUSD
		}
		return SideNone
	}
	switch {
	case c == base && fiat[base] && fiat[quote]:
		return SideBase
	case c == quote && fiat[base] && fiat[quote]:
		return SideQuote
	}
	return SideNone
}

// Bias = arah dampak ke instrumen.
type Bias int

const (
	BiasNeutral Bias = iota
	BiasBearish
	BiasBullish
)

func (b Bias) String() string {
	switch b {
	case BiasBearish:
		return "bearish"
	case BiasBullish:
		return "bullish"
	default:
		return "neutral"
	}
}

// BiasFrom menurunkan bias instrumen dari kekuatan currency event (lean) + sisi-nya (Lapis 2,
// generalisasi lintas-currency). lean netral / SideNone → netral.
func BiasFrom(lean USDLean, side Side) Bias {
	if lean == LeanNeutral || side == SideNone {
		return BiasNeutral
	}
	strong := lean == LeanHawkish // currency event menguat
	var bullishWhenStrong bool
	switch side {
	case SideBase, SideDXYUSD:
		bullishWhenStrong = true
	case SideQuote, SideGoldUSD:
		bullishWhenStrong = false
	default:
		return BiasNeutral
	}
	if strong == bullishWhenStrong {
		return BiasBullish
	}
	return BiasBearish
}

// PrettySymbol "XAU_USD" → "XAU/USD" (DXY tetap).
func PrettySymbol(symbol string) string {
	s := strings.ToUpper(strings.TrimSpace(symbol))
	return strings.ReplaceAll(s, "_", "/")
}

// PlaybookFor menyusun narasi pasca-rilis (EN), currency-aware (menyebut currency event).
func PlaybookFor(lean USDLean, side Side, bias Bias, ccy, symbol string) string {
	sym := PrettySymbol(symbol)
	if side == SideNone {
		return "No directional read for " + sym + "."
	}
	c := strings.ToUpper(strings.TrimSpace(ccy))
	switch lean {
	case LeanHawkish:
		return "Strong " + c + " data → " + c + " up → " + bias.String() + " " + sym + "."
	case LeanDovish:
		return "Soft " + c + " data → " + c + " down → " + bias.String() + " " + sym + "."
	default:
		return "Small surprise → limited impact; " + sym + " likely technical-driven."
	}
}

// PreScenarioFor menyusun skenario kalau-maka (EN) untuk rilis yang BELUM keluar, currency-aware.
func PreScenarioFor(side Side, ccy, symbol string) string {
	sym := PrettySymbol(symbol)
	if side == SideNone {
		return "No directional read for " + sym + "."
	}
	c := strings.ToUpper(strings.TrimSpace(ccy))
	up := BiasFrom(LeanHawkish, side)
	down := BiasFrom(LeanDovish, side)
	return "Above forecast → " + c + " up → " + up.String() + " " + sym +
		"; below → " + down.String() + " " + sym + "."
}
