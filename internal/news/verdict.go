package news

import "strings"

// USDLean = arah tekanan ke USD dari sebuah surprise (Lapis 1, instrument-agnostic).
type USDLean int

const (
	LeanNeutral USDLean = iota
	LeanHawkish         // data kuat → Fed hawkish → USD menguat
	LeanDovish          // data lemah → USD melemah
)

// String = label untuk JSON/UI.
func (l USDLean) String() string {
	switch l {
	case LeanHawkish:
		return "hawkish"
	case LeanDovish:
		return "dovish"
	default:
		return "neutral"
	}
}

// RegimeHawkishOnStrong: asumsi rezim (2026) — data kuat = hawkish = USD↑.
// Dibalik bila rezim berubah; ditampilkan terang-terangan di UI.
const RegimeHawkishOnStrong = true

// usdLeanFor memetakan (jenis indikator, surprise) → tekanan USD + label (EN).
func usdLeanFor(kind Kind, s Surprise) (lean USDLean, label string) {
	strong, weak := LeanHawkish, LeanDovish
	if !RegimeHawkishOnStrong {
		strong, weak = LeanDovish, LeanHawkish
	}
	switch kind {
	case KindInflation:
		switch s {
		case SurpriseAbove:
			return strong, "hot (above forecast)"
		case SurpriseBelow:
			return weak, "soft (below forecast)"
		case SurpriseInline:
			return LeanNeutral, "in line with forecast"
		}
	case KindJobs:
		switch s {
		case SurpriseAbove:
			return strong, "beat (above forecast)"
		case SurpriseBelow:
			return weak, "miss (below forecast)"
		case SurpriseInline:
			return LeanNeutral, "in line with forecast"
		}
	}
	return LeanNeutral, "unclassified"
}

// Verdict = ringkasan klasifikasi satu Release (instrument-agnostic).
type Verdict struct {
	Surprise Surprise
	Lean     USDLean
	Label    string
	Tilt     USDLean // condong tipis dari tiebreaker core m/m (LeanNeutral = tak ada)
	Tiebreak string
}

// Classify mengevaluasi Release → Verdict berdasar event headline + tiebreaker core.
func (r Release) Classify() Verdict {
	h, ok := r.Headline()
	if !ok {
		return Verdict{}
	}
	s := classifySurprise(h)
	lean, label := usdLeanFor(r.Kind, s)
	v := Verdict{Surprise: s, Lean: lean, Label: label}
	if r.Kind == KindInflation && s == SurpriseInline {
		if c, ok := r.coreMoM(); ok {
			strong, weak := LeanHawkish, LeanDovish
			if !RegimeHawkishOnStrong {
				strong, weak = LeanDovish, LeanHawkish
			}
			switch classifySurprise(c) {
			case SurpriseAbove:
				v.Tilt, v.Tiebreak = strong, "core m/m above forecast (slightly hot) — Fed's key gauge"
			case SurpriseBelow:
				v.Tilt, v.Tiebreak = weak, "core m/m below forecast (slightly soft) — Fed's key gauge"
			}
		}
	}
	return v
}

// coreMoM mencari event "core … m/m" (gauge inflasi inti).
func (r Release) coreMoM() (Event, bool) {
	for _, e := range r.Events {
		t := strings.ToLower(e.Title)
		if strings.Contains(t, "core") && strings.Contains(t, "m/m") {
			return e, true
		}
	}
	return Event{}, false
}
