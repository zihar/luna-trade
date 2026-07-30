// Kalimat error SL/TP dipin di sini karena ia dicermin PERSIS oleh
// validateSLTPReplay (js/sizing-pnl.js) supaya pesan di Bar Replay dan Live sama.
// Kalau kalimat di sini berubah, ubah juga cermin di frontend.
package main

import "testing"

func f(v float64) *float64 { return &v }

func TestSLTPError(t *testing.T) {
	cases := []struct {
		name     string
		dir      string
		sl, tp   *float64
		bid, ask float64
		want     string
	}{
		{"short SL di dalam spread", "short", f(1.1000), nil, 1.0999, 1.1001,
			"Stop Loss is inside the spread — place it above the Ask price."},
		{"short TP di dalam spread", "short", nil, f(1.1002), 1.0999, 1.1001,
			"Take Profit is inside the spread — place it below the Ask price."},
		{"long SL di dalam spread", "long", f(1.1000), nil, 1.0999, 1.1001,
			"Stop Loss is inside the spread — place it below the Bid price."},
		{"long TP di dalam spread", "long", nil, f(1.0998), 1.0999, 1.1001,
			"Take Profit is inside the spread — place it above the Bid price."},
		{"short valid", "short", f(1.1100), f(1.0900), 1.0999, 1.1001, ""},
		{"long valid", "long", f(1.0900), f(1.1100), 1.0999, 1.1001, ""},
		{"nil keduanya", "long", nil, nil, 1.0999, 1.1001, ""},
		{"harga belum ada → jangan tolak", "long", f(9), f(9), 0, 0, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := sltpError(c.dir, c.sl, c.tp, c.bid, c.ask)
			got := ""
			if err != nil {
				got = err.Error()
			}
			if got != c.want {
				t.Fatalf("sltpError = %q, mau %q", got, c.want)
			}
		})
	}
}
