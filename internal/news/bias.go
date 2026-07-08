package news

import "strings"

// Role = hubungan instrumen dengan USD (menentukan arah bias dari tekanan USD).
type Role int

const (
	RoleUnknown  Role = iota
	RoleQuoteUSD      // USD quote, base fiat asing: EUR_USD, GBP_USD, AUD_USD, NZD_USD
	RoleBaseUSD       // USD base: USD_JPY, USD_CAD, USD_CHF
	RoleGold          // logam mulia (inverse USD/yield): XAU_USD, XAG_USD
	RoleDXY           // indeks USD
)

// fiat = mata uang fiat yang dikenali (untuk membedakan dari kripto).
var fiat = map[string]bool{
	"USD": true, "EUR": true, "GBP": true, "JPY": true, "CHF": true,
	"CAD": true, "AUD": true, "NZD": true,
}

// InstrumentRole memetakan simbol ("BASE_QUOTE" atau "DXY") → Role. Kripto &
// cross tanpa USD → RoleUnknown.
func InstrumentRole(symbol string) Role {
	s := strings.ToUpper(strings.TrimSpace(symbol))
	s = strings.ReplaceAll(s, "/", "_")
	if s == "DXY" {
		return RoleDXY
	}
	parts := strings.SplitN(s, "_", 2)
	if len(parts) != 2 {
		return RoleUnknown
	}
	base, quote := parts[0], parts[1]
	if base == "XAU" || base == "XAG" {
		return RoleGold
	}
	switch {
	case quote == "USD" && fiat[base]:
		return RoleQuoteUSD
	case base == "USD" && fiat[quote]:
		return RoleBaseUSD
	}
	return RoleUnknown
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

// InstrumentBias menurunkan bias instrumen dari tekanan USD (Lapis 2).
func InstrumentBias(lean USDLean, role Role) Bias {
	if lean == LeanNeutral || role == RoleUnknown {
		return BiasNeutral
	}
	usdUp := lean == LeanHawkish
	var bullishWhenUSDUp bool
	switch role {
	case RoleBaseUSD, RoleDXY:
		bullishWhenUSDUp = true
	case RoleQuoteUSD, RoleGold:
		bullishWhenUSDUp = false
	default:
		return BiasNeutral
	}
	if usdUp == bullishWhenUSDUp {
		return BiasBullish
	}
	return BiasBearish
}

// PrettySymbol "XAU_USD" → "XAU/USD" (DXY tetap).
func PrettySymbol(symbol string) string {
	s := strings.ToUpper(strings.TrimSpace(symbol))
	return strings.ReplaceAll(s, "_", "/")
}

// Playbook menyusun narasi singkat (EN) pasca-rilis.
func Playbook(lean USDLean, role Role, bias Bias, symbol string) string {
	sym := PrettySymbol(symbol)
	if role == RoleUnknown {
		return "No direct USD linkage for " + sym + "."
	}
	switch lean {
	case LeanHawkish:
		return "Strong data → hawkish Fed → USD up → " + bias.String() + " " + sym + "."
	case LeanDovish:
		return "Soft data → room for cuts → USD down → " + bias.String() + " " + sym + "."
	default:
		return "Small surprise → limited impact; " + sym + " likely technical-driven."
	}
}

// PreScenario menyusun skenario kalau-maka (EN) untuk rilis yang BELUM keluar.
func PreScenario(role Role, symbol string) string {
	sym := PrettySymbol(symbol)
	if role == RoleUnknown {
		return "No direct USD linkage for " + sym + "."
	}
	up := InstrumentBias(LeanHawkish, role)
	down := InstrumentBias(LeanDovish, role)
	return "Above forecast → USD up → " + up.String() + " " + sym +
		"; below → " + down.String() + " " + sym + "."
}
