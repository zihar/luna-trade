// Package news menarik kalender ekonomi (Forex Factory weekly JSON feed, gratis
// tanpa API key) lalu mengklasifikasi "surprise" tiap rilis high-impact dan
// memetakannya ke tekanan USD → bias per-instrumen. Std-lib only. READ-ONLY.
//
// Sumber: https://nfs.faireconomy.media/ff_calendar_thisweek.json — mirror
// publik kalender Forex Factory. Karena mirror tak-resmi, FetchCalendar
// mengembalikan error jelas bila feed berubah bentuk/down.
package news

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// CalendarURL = mirror publik kalender mingguan Forex Factory (JSON, tanpa key).
const CalendarURL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"

// Event = satu baris kalender. Forecast/Previous/Actual disimpan MENTAH.
type Event struct {
	Title    string
	Country  string
	Impact   string
	Time     time.Time
	Forecast string
	Previous string
	Actual   string // "" = belum rilis
}

// Released = true bila feed sudah mengisi kolom Actual.
func (e Event) Released() bool { return strings.TrimSpace(e.Actual) != "" }

type rawEvent struct {
	Title    string `json:"title"`
	Country  string `json:"country"`
	Date     string `json:"date"`
	Impact   string `json:"impact"`
	Forecast string `json:"forecast"`
	Previous string `json:"previous"`
	Actual   string `json:"actual"`
}

// FetchCalendarRaw menarik body mentah feed mingguan. client nil = default 20s.
func FetchCalendarRaw(client *http.Client) ([]byte, error) {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	req, err := http.NewRequest(http.MethodGet, CalendarURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "luna-trade-news/1.0 (+https://lunatrade.domudame.com)")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("kalender feed HTTP %d: %s", resp.StatusCode, snippet(body))
	}
	return body, nil
}

// FetchCalendar menarik & mem-parse feed mingguan (tanpa cache).
func FetchCalendar(client *http.Client) ([]Event, error) {
	body, err := FetchCalendarRaw(client)
	if err != nil {
		return nil, err
	}
	return ParseCalendar(body)
}

// ParseCalendar mem-parse body JSON feed → []Event (dipisah supaya bisa diuji
// tanpa jaringan). Tanggal gagal-parse → event di-skip; bila SEMUA gagal → error.
func ParseCalendar(body []byte) ([]Event, error) {
	var raw []rawEvent
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("parse kalender JSON: %w (snippet: %s)", err, snippet(body))
	}
	out := make([]Event, 0, len(raw))
	for _, r := range raw {
		t, err := time.Parse(time.RFC3339, r.Date)
		if err != nil {
			continue
		}
		out = append(out, Event{
			Title:    strings.TrimSpace(r.Title),
			Country:  strings.TrimSpace(r.Country),
			Impact:   strings.TrimSpace(r.Impact),
			Time:     t.UTC(),
			Forecast: strings.TrimSpace(r.Forecast),
			Previous: strings.TrimSpace(r.Previous),
			Actual:   strings.TrimSpace(r.Actual),
		})
	}
	if len(raw) > 0 && len(out) == 0 {
		return nil, fmt.Errorf("kalender: %d event tapi semua tanggalnya gagal di-parse (format feed berubah?)", len(raw))
	}
	return out, nil
}

// FilterUSDImpact menyaring event USD dengan salah satu impact yang diminta
// (case-insensitive). Contoh: FilterUSDImpact(ev, "High", "Medium").
func FilterUSDImpact(events []Event, impacts ...string) []Event {
	var out []Event
	for _, e := range events {
		if !strings.EqualFold(e.Country, "USD") {
			continue
		}
		for _, imp := range impacts {
			if strings.EqualFold(e.Impact, imp) {
				out = append(out, e)
				break
			}
		}
	}
	return out
}

// FilterUSDHighImpact menyaring event USD ber-impact High (case-insensitive).
func FilterUSDHighImpact(events []Event) []Event {
	return FilterUSDImpact(events, "High")
}

// fiatCodes = mata uang yang punya kalender ekonomi di feed & dipakai instrumen Luna.
var fiatCodes = map[string]bool{
	"USD": true, "EUR": true, "GBP": true, "JPY": true,
	"CHF": true, "CAD": true, "AUD": true, "NZD": true,
}

// RelevantCurrencies mengembalikan mata uang fiat yang event-nya relevan untuk instrumen:
// kedua sisi pasangan FX (mis. "GBP_USD" → ["GBP","USD"]). Kode non-fiat (XAU/XAG/DXY dst)
// di-drop; bila tak ada yang cocok, fallback ["USD"].
func RelevantCurrencies(symbol string) []string {
	seen := map[string]bool{}
	var out []string
	// Terima bentuk "EUR/USD" maupun "EUR_USD" (senada SideOf di bias.go).
	norm := strings.ReplaceAll(strings.ToUpper(strings.TrimSpace(symbol)), "/", "_")
	for _, part := range strings.Split(norm, "_") {
		if fiatCodes[part] && !seen[part] {
			seen[part] = true
			out = append(out, part)
		}
	}
	if len(out) == 0 {
		return []string{"USD"}
	}
	return out
}

// FilterEvents menyaring event yang Country-nya ada di currencies DAN Impact-nya salah satu
// di impacts (keduanya case-insensitive).
func FilterEvents(events []Event, currencies []string, impacts ...string) []Event {
	var out []Event
	for _, e := range events {
		if containsFold(currencies, e.Country) && containsFold(impacts, e.Impact) {
			out = append(out, e)
		}
	}
	return out
}

func containsFold(list []string, s string) bool {
	for _, x := range list {
		if strings.EqualFold(x, s) {
			return true
		}
	}
	return false
}

// snippet memotong body untuk pesan error.
func snippet(b []byte) string {
	const n = 180
	s := strings.TrimSpace(string(b))
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
