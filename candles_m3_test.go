package main

import "testing"

func m1(t, o, h, l, c string, complete bool) oandaCandle {
	x := oandaCandle{Time: t, Volume: 1, Complete: complete}
	x.Mid.O, x.Mid.H, x.Mid.L, x.Mid.C = o, h, l, c
	return x
}

func TestAggregateM3(t *testing.T) {
	in := []oandaCandle{
		m1("2026-01-05T10:00:00.000000000Z", "1.0", "1.5", "0.9", "1.2", true),
		m1("2026-01-05T10:01:00.000000000Z", "1.2", "2.0", "1.1", "1.8", true),
		m1("2026-01-05T10:02:00.000000000Z", "1.8", "1.9", "0.5", "1.0", true),
		m1("2026-01-05T10:03:00.000000000Z", "1.0", "1.1", "0.9", "1.05", true),
		m1("2026-01-05T10:04:00.000000000Z", "1.05", "1.2", "1.0", "1.1", false), // forming
	}
	out := aggregateM3(in, 100)
	if len(out) != 2 {
		t.Fatalf("want 2 bucket, got %d", len(out))
	}
	b := out[0]
	if b.Mid.O != "1.0" || b.Mid.H != "2" || b.Mid.L != "0.5" || b.Mid.C != "1.0" || b.Volume != 3 || !b.Complete {
		t.Fatalf("bucket 1 salah: %+v", b)
	}
	if out[1].Complete {
		t.Fatalf("bucket forming tak boleh complete")
	}
}

func TestAggregateM3DropsTruncatedHead(t *testing.T) {
	in := []oandaCandle{
		m1("2026-01-05T10:01:00.000000000Z", "1", "1", "1", "1", true), // terpotong
		m1("2026-01-05T10:02:00.000000000Z", "1", "1", "1", "1", true),
		m1("2026-01-05T10:03:00.000000000Z", "2", "2", "2", "2", true),
		m1("2026-01-05T10:04:00.000000000Z", "2", "2", "2", "2", true),
		m1("2026-01-05T10:05:00.000000000Z", "2", "2", "2", "2", true),
	}
	out := aggregateM3(in, 5) // len == requested → terpotong
	if len(out) != 1 || out[0].Mid.O != "2" {
		t.Fatalf("bucket depan terpotong harus dibuang: %+v", out)
	}
}
