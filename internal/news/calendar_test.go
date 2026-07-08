package news

import "testing"

const sampleFeed = `[
  {"title":"CPI m/m","country":"USD","date":"2026-07-10T12:30:00+00:00","impact":"High","forecast":"0.3%","previous":"0.2%","actual":"0.4%"},
  {"title":"German Factory Orders m/m","country":"EUR","date":"2026-07-06T06:00:00+00:00","impact":"Low","forecast":"1.1%","previous":"-3.8%","actual":""},
  {"title":"Non-Farm Employment Change","country":"USD","date":"2026-07-11T12:30:00+00:00","impact":"High","forecast":"180K","previous":"200K","actual":""}
]`

func TestParseCalendar(t *testing.T) {
	ev, err := ParseCalendar([]byte(sampleFeed))
	if err != nil {
		t.Fatalf("ParseCalendar error: %v", err)
	}
	if len(ev) != 3 {
		t.Fatalf("want 3 events, got %d", len(ev))
	}
	if ev[0].Title != "CPI m/m" || ev[0].Country != "USD" || ev[0].Actual != "0.4%" {
		t.Fatalf("unexpected first event: %+v", ev[0])
	}
	if !ev[0].Released() {
		t.Fatalf("CPI should be released (actual filled)")
	}
	if ev[2].Released() {
		t.Fatalf("NFP should not be released (actual empty)")
	}
}

func TestParseCalendarAllBadDates(t *testing.T) {
	_, err := ParseCalendar([]byte(`[{"title":"x","country":"USD","date":"not-a-date","impact":"High"}]`))
	if err == nil {
		t.Fatalf("expected error when all dates fail to parse")
	}
}

func TestFilterUSDHighImpact(t *testing.T) {
	ev, _ := ParseCalendar([]byte(sampleFeed))
	f := FilterUSDHighImpact(ev)
	if len(f) != 2 {
		t.Fatalf("want 2 USD/High events, got %d", len(f))
	}
	for _, e := range f {
		if e.Country != "USD" || e.Impact != "High" {
			t.Fatalf("filter leaked: %+v", e)
		}
	}
}

const sampleFeedMixed = `[
  {"title":"CPI m/m","country":"USD","date":"2026-07-10T12:30:00+00:00","impact":"High","forecast":"0.3%","previous":"0.2%","actual":"0.4%"},
  {"title":"ISM Services PMI","country":"USD","date":"2026-07-08T14:00:00+00:00","impact":"Medium","forecast":"53.1","previous":"52.8","actual":""},
  {"title":"German Factory Orders m/m","country":"EUR","date":"2026-07-06T06:00:00+00:00","impact":"Medium","forecast":"1.1%","previous":"-3.8%","actual":""},
  {"title":"Non-Farm Employment Change","country":"USD","date":"2026-07-11T12:30:00+00:00","impact":"High","forecast":"180K","previous":"200K","actual":""}
]`

func TestFilterUSDImpact(t *testing.T) {
	ev, _ := ParseCalendar([]byte(sampleFeedMixed))

	high := FilterUSDImpact(ev, "High")
	if len(high) != 2 {
		t.Fatalf("High-only: want 2, got %d", len(high))
	}

	both := FilterUSDImpact(ev, "High", "Medium")
	if len(both) != 3 {
		t.Fatalf("High+Medium: want 3 USD events, got %d", len(both))
	}
	for _, e := range both {
		if e.Country != "USD" {
			t.Fatalf("filter leaked non-USD: %+v", e)
		}
		if e.Impact != "High" && e.Impact != "Medium" {
			t.Fatalf("filter leaked impact %q", e.Impact)
		}
	}
}

func TestRelevantCurrencies(t *testing.T) {
	cases := map[string][]string{
		"EUR_USD": {"EUR", "USD"},
		"GBP_USD": {"GBP", "USD"},
		"USD_JPY": {"USD", "JPY"},
		"XAU_USD": {"USD"},
		"XAG_USD": {"USD"},
		"DXY":     {"USD"},
		"eur_usd": {"EUR", "USD"},
	}
	for sym, want := range cases {
		got := RelevantCurrencies(sym)
		if len(got) != len(want) {
			t.Fatalf("%s: want %v, got %v", sym, want, got)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("%s: want %v, got %v", sym, want, got)
			}
		}
	}
}

func TestFilterEvents(t *testing.T) {
	ev, _ := ParseCalendar([]byte(sampleFeedMixed)) // dari TestFilterUSDImpact (calendar_test.go)
	// sampleFeedMixed: USD/High(CPI), USD/Medium(ISM), EUR/Medium(GFO), USD/High(NFP)
	got := FilterEvents(ev, []string{"USD", "EUR"}, "High", "Medium")
	if len(got) != 4 {
		t.Fatalf("USD+EUR High+Medium: want 4, got %d", len(got))
	}
	onlyUSD := FilterEvents(ev, []string{"USD"}, "High")
	if len(onlyUSD) != 2 {
		t.Fatalf("USD High: want 2, got %d", len(onlyUSD))
	}
	for _, e := range FilterEvents(ev, []string{"EUR"}, "High", "Medium") {
		if e.Country != "EUR" {
			t.Fatalf("leaked non-EUR: %+v", e)
		}
	}
}
