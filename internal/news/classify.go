package news

import (
	"math"
	"strconv"
	"strings"
	"time"
)

// Kind = jenis indikator (menentukan arah pemetaan surprise → tekanan USD).
type Kind int

const (
	KindOther Kind = iota
	KindInflation
	KindJobs
)

// KindOf menebak jenis indikator dari judul event.
func KindOf(title string) Kind {
	t := strings.ToUpper(title)
	switch {
	case strings.Contains(t, "CPI"), strings.Contains(t, "PPI"),
		strings.Contains(t, "PCE"), strings.Contains(t, "PRICE INDEX"):
		return KindInflation
	case strings.Contains(t, "NON-FARM"), strings.Contains(t, "NONFARM"),
		strings.Contains(t, "NFP"), strings.Contains(t, "PAYROLL"):
		return KindJobs
	}
	return KindOther
}

// Surprise = hasil rilis relatif forecast.
type Surprise int

const (
	SurpriseUnknown Surprise = iota
	SurpriseInline
	SurpriseAbove
	SurpriseBelow
)

// String = label ringkas untuk JSON/UI.
func (s Surprise) String() string {
	switch s {
	case SurpriseAbove:
		return "above"
	case SurpriseBelow:
		return "below"
	case SurpriseInline:
		return "inline"
	default:
		return "unknown"
	}
}

// ParseNumber mengubah nilai feed ("0.3%","85K","-92K","<0.1%") jadi float.
func ParseNumber(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false
	}
	s = strings.TrimLeft(s, "<>~≈ ")
	s = strings.ReplaceAll(s, ",", "")
	mult := 1.0
	switch {
	case strings.HasSuffix(s, "%"):
		s = strings.TrimSuffix(s, "%")
	case strings.HasSuffix(s, "K"), strings.HasSuffix(s, "k"):
		s, mult = s[:len(s)-1], 1e3
	case strings.HasSuffix(s, "M"), strings.HasSuffix(s, "m"):
		s, mult = s[:len(s)-1], 1e6
	case strings.HasSuffix(s, "B"), strings.HasSuffix(s, "b"):
		s, mult = s[:len(s)-1], 1e9
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0, false
	}
	return v * mult, true
}

// classifySurprise membandingkan actual vs forecast satu Event.
func classifySurprise(e Event) Surprise {
	a, okA := ParseNumber(e.Actual)
	f, okF := ParseNumber(e.Forecast)
	if !okA || !okF {
		return SurpriseUnknown
	}
	const eps = 1e-9
	switch {
	case math.Abs(a-f) <= eps:
		return SurpriseInline
	case a > f:
		return SurpriseAbove
	default:
		return SurpriseBelow
	}
}

// Release = sekelompok Event satu indikator pada satu timestamp.
type Release struct {
	Name   string
	Kind   Kind
	Time   time.Time
	Events []Event
}

func (r Release) Released() bool {
	for _, e := range r.Events {
		if !e.Released() {
			return false
		}
	}
	return len(r.Events) > 0
}

func (r Release) AnyReleased() bool {
	for _, e := range r.Events {
		if e.Released() {
			return true
		}
	}
	return false
}

// Headline mengembalikan event utama (bukan "core", utamakan "m/m").
func (r Release) Headline() (Event, bool) {
	var mm, any Event
	var okMM, okAny bool
	for _, e := range r.Events {
		t := strings.ToLower(e.Title)
		if strings.Contains(t, "core") {
			continue
		}
		if !okAny {
			any, okAny = e, true
		}
		if strings.Contains(t, "m/m") {
			mm, okMM = e, true
		}
	}
	if okMM {
		return mm, true
	}
	if okAny {
		return any, true
	}
	if len(r.Events) > 0 {
		return r.Events[0], true
	}
	return Event{}, false
}

// WithActual = salinan Release dengan Actual tiap event diisi dari map (untuk test/preview).
func (r Release) WithActual(actuals map[string]string) Release {
	out := r
	out.Events = make([]Event, len(r.Events))
	copy(out.Events, r.Events)
	for i := range out.Events {
		if a, ok := actuals[out.Events[i].Title]; ok {
			out.Events[i].Actual = a
		}
	}
	return out
}

// GroupReleases mengelompokkan event per indikator + timestamp.
func GroupReleases(events []Event, nameOf func(string) string) []Release {
	if nameOf == nil {
		nameOf = DefaultName
	}
	type key struct {
		name string
		t    time.Time
	}
	idx := map[key]int{}
	var out []Release
	for _, e := range events {
		name := nameOf(e.Title)
		if name == "" {
			continue
		}
		k := key{name, e.Time}
		if i, ok := idx[k]; ok {
			out[i].Events = append(out[i].Events, e)
			continue
		}
		idx[k] = len(out)
		out = append(out, Release{Name: name, Kind: KindOf(e.Title), Time: e.Time, Events: []Event{e}})
	}
	return out
}

// DefaultName memetakan judul → label indikator yang dipantau ("" = diabaikan).
func DefaultName(title string) string {
	t := strings.ToUpper(title)
	switch {
	case strings.Contains(t, "PPI"):
		return "PPI"
	case strings.Contains(t, "CPI"):
		return "CPI"
	case strings.Contains(t, "NON-FARM"), strings.Contains(t, "NONFARM"),
		strings.Contains(t, "NFP"), strings.Contains(t, "PAYROLL"):
		return "NFP"
	}
	return ""
}
