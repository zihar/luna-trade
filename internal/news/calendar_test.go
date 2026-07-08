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
